//! Data masking for exports (Roadmap V3 · Fase 3).
//!
//! A [`MaskingRequest`] lists per-column rules (`table.column → strategy`). The
//! [`Masker`] applies them row by row while a SQL dump or a CSV/Excel export streams
//! to disk, so tables are never loaded whole in memory.
//!
//! Every strategy is a deterministic function of `HMAC-SHA256(seed, strategy ‖ value)`:
//! the same input always yields the same output inside one export, in every table.
//! That keeps joins working, and [`Masker::propagate_foreign_keys`] makes both sides
//! of each foreign key use the same strategy so parent and child values still match.
//!
//! The seed is never part of a profile file and never reaches the frontend: it is
//! random per export, or — when the profile asks for stable output across exports —
//! kept encrypted in the Vault under `seed_credential_id`.

use super::backend::{ExportCell, RowStream, RowStreamItem};
use super::error::PyroError;
use super::models::ForeignKeyMetadata;
use chrono::{Duration, NaiveDate};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

/// Default range for [`MaskingStrategy::DateShift`] (± days).
pub const DEFAULT_SHIFT_DAYS: u32 = 30;
const MAX_SHIFT_DAYS: u32 = 3650;
const MAX_RULES: usize = 5_000;
const MAX_FIXED_LEN: usize = 1_000;
const SEED_LEN: usize = 32;

const FIRST_NAMES: &[&str] = &[
    "Ana", "Luis", "María", "Carlos", "Lucía", "Javier", "Sofía", "Diego", "Elena", "Pablo",
    "Valeria", "Andrés", "Camila", "Jorge", "Isabel", "Miguel", "Paula", "Raúl", "Laura", "Tomás",
    "Daniela", "Fernando", "Gabriela", "Héctor", "Ximena", "Rodrigo", "Natalia", "Emilio",
    "Renata", "Óscar", "Mariana", "Iván",
];
const LAST_NAMES: &[&str] = &[
    "García",
    "Martínez",
    "López",
    "Sánchez",
    "Pérez",
    "Gómez",
    "Ruiz",
    "Hernández",
    "Díaz",
    "Moreno",
    "Álvarez",
    "Romero",
    "Torres",
    "Navarro",
    "Ramírez",
    "Castro",
    "Vargas",
    "Ortiz",
    "Flores",
    "Mendoza",
    "Cruz",
    "Reyes",
    "Morales",
    "Jiménez",
    "Aguilar",
    "Rojas",
    "Medina",
    "Silva",
    "Herrera",
    "Domínguez",
];

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum MaskingStrategy {
    /// Value exported unchanged.
    Keep,
    /// Realistic "Nombre Apellido" from a localized catalog.
    FullName,
    FirstName,
    LastName,
    /// `j***e@dominio.com`: first and last character of the local part, domain kept.
    EmailPartial,
    /// `user_1a2b3c4d5e6f@test.local`: unique synthetic alias.
    EmailSynthetic,
    /// Same format (separators, length), digits replaced by pseudo-random digits.
    PhoneDigits,
    /// Same format, digits → `0` and letters → `X`.
    DigitsZero,
    /// Date moved a pseudo-random number of days within ± `shift_days`.
    DateShift,
    /// `**** **** **** 1234`: only the last four digits survive.
    CardMask,
    /// Truncated salted SHA-256 (16 hex characters), irreversible.
    Hash,
    /// Constant text (`fixed_value`).
    Fixed,
    /// SQL `NULL` / empty cell.
    Null,
}

impl MaskingStrategy {
    pub const ALL: [MaskingStrategy; 13] = [
        Self::Keep,
        Self::FullName,
        Self::FirstName,
        Self::LastName,
        Self::EmailPartial,
        Self::EmailSynthetic,
        Self::PhoneDigits,
        Self::DigitsZero,
        Self::DateShift,
        Self::CardMask,
        Self::Hash,
        Self::Fixed,
        Self::Null,
    ];

    fn tag(self) -> &'static str {
        match self {
            Self::Keep => "keep",
            Self::FullName => "full_name",
            Self::FirstName => "first_name",
            Self::LastName => "last_name",
            Self::EmailPartial => "email_partial",
            Self::EmailSynthetic => "email_synthetic",
            Self::PhoneDigits => "phone_digits",
            Self::DigitsZero => "digits_zero",
            Self::DateShift => "date_shift",
            Self::CardMask => "card_mask",
            Self::Hash => "hash",
            Self::Fixed => "fixed",
            Self::Null => "null",
        }
    }

    /// Distinct inputs keep distinct outputs (practically), so the column can stay a
    /// primary/foreign key and keep unique indexes valid.
    pub fn is_key_safe(self) -> bool {
        matches!(self, Self::Keep | Self::Hash | Self::EmailSynthetic)
    }
}

/// Strategy catalog entry for the UI (`get_masking_presets`).
#[derive(Debug, Clone, Serialize)]
pub struct MaskingPreset {
    pub strategy: MaskingStrategy,
    pub label: &'static str,
    pub description: &'static str,
    pub example: &'static str,
    /// Safe for primary/foreign keys and unique indexes.
    pub key_safe: bool,
}

pub fn presets() -> Vec<MaskingPreset> {
    use MaskingStrategy as S;
    let entry = |strategy, label, description, example| MaskingPreset {
        strategy,
        label,
        description,
        example,
        key_safe: MaskingStrategy::is_key_safe(strategy),
    };
    vec![
        entry(S::Keep, "Conservar", "Exporta el valor sin cambios.", "—"),
        entry(S::FullName, "Nombre completo", "Nombre y apellido realistas de un catálogo.", "Lucía Torres"),
        entry(S::FirstName, "Nombre", "Nombre de pila realista de un catálogo.", "Javier"),
        entry(S::LastName, "Apellido", "Apellido realista de un catálogo.", "Navarro"),
        entry(S::EmailPartial, "Correo parcial", "Conserva el dominio y oculta el usuario. Puede repetir valores: no lo use en columnas únicas.", "j***e@dominio.com"),
        entry(S::EmailSynthetic, "Correo sintético", "Alias único y determinista; respeta índices únicos.", "user_1a2b3c4d5e6f@test.local"),
        entry(S::PhoneDigits, "Dígitos permutados", "Mantiene el formato (longitud y separadores) con dígitos distintos.", "+52 (55) 8193-0274"),
        entry(S::DigitsZero, "Ceros fijos", "Mantiene el formato; dígitos a 0 y letras a X.", "00000000X"),
        entry(S::DateShift, "Desplazar fecha", "Mueve la fecha unos días (±30 por defecto) para conservar la distribución.", "1987-04-02 → 1987-04-19"),
        entry(S::CardMask, "Máscara de tarjeta", "Solo conserva los últimos cuatro dígitos.", "**** **** **** 1234"),
        entry(S::Hash, "Hash irreversible", "SHA-256 con semilla, truncado a 16 caracteres. Válido para claves.", "9f86d081884c7d65"),
        entry(S::Fixed, "Valor fijo", "Sustituye todos los valores por un texto constante.", "REDACTADO"),
        entry(S::Null, "Vaciar (NULL)", "Exporta NULL o una celda vacía.", "NULL"),
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MaskingRule {
    pub table: String,
    pub column: String,
    pub strategy: MaskingStrategy,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shift_days: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fixed_value: Option<String>,
}

/// Masking options sent with an export.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaskingRequest {
    #[serde(default)]
    pub profile_name: Option<String>,
    #[serde(default)]
    pub rules: Vec<MaskingRule>,
    /// Vault entry holding a stable seed (created on first use). Without it the
    /// seed is random for this export only.
    #[serde(default)]
    pub seed_credential_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ResolvedRule {
    pub strategy: MaskingStrategy,
    shift_days: u32,
    /// Character limit of the target column (`varchar(n)`), set by `column_plan`,
    /// so masked text never overflows it when the dump is restored.
    max_len: Option<usize>,
}

#[derive(Debug, Clone)]
pub struct Masker {
    key: [u8; SEED_LEN],
    /// (table, column) lowercased → rule.
    rules: HashMap<(String, String), ResolvedRule>,
    fixed_values: HashMap<(String, String), String>,
    pub profile_name: Option<String>,
    /// Human-readable adjustments made to keep the data consistent.
    pub notes: Vec<String>,
}

fn key_of(table: &str, column: &str) -> (String, String) {
    (table.trim().to_lowercase(), column.trim().to_lowercase())
}

/// Seed for one export: from the Vault when the profile wants stable output
/// (generated and stored on first use), otherwise fresh random bytes.
pub fn resolve_seed(req: &MaskingRequest) -> Result<[u8; SEED_LEN], PyroError> {
    let Some(cred_id) = req
        .seed_credential_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
    else {
        return random_seed();
    };
    if let Ok(stored) = super::credentials::get_credential(cred_id) {
        if let Some(seed) = decode_hex_seed(&stored) {
            return Ok(seed);
        }
    }
    let seed = random_seed()?;
    super::credentials::save_credential(cred_id, &hex(&seed))?;
    Ok(seed)
}

fn random_seed() -> Result<[u8; SEED_LEN], PyroError> {
    let mut seed = [0u8; SEED_LEN];
    getrandom::fill(&mut seed).map_err(|e| {
        PyroError::InvalidOperation(format!(
            "No se pudo generar la semilla de enmascaramiento: {e}"
        ))
    })?;
    Ok(seed)
}

fn decode_hex_seed(text: &str) -> Option<[u8; SEED_LEN]> {
    let text = text.trim();
    if text.len() != SEED_LEN * 2 {
        return None;
    }
    let mut out = [0u8; SEED_LEN];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(text.get(i * 2..i * 2 + 2)?, 16).ok()?;
    }
    Some(out)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn hmac_sha256(key: &[u8; SEED_LEN], parts: &[&[u8]]) -> [u8; 32] {
    const BLOCK: usize = 64;
    let mut padded = [0u8; BLOCK];
    padded[..SEED_LEN].copy_from_slice(key);
    let mut inner = Sha256::new();
    inner.update(padded.map(|b| b ^ 0x36));
    for part in parts {
        inner.update(part);
    }
    let inner_hash = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(padded.map(|b| b ^ 0x5c));
    outer.update(inner_hash);
    outer.finalize().into()
}

fn is_numeric_type(data_type: &str) -> bool {
    let t = data_type.trim().to_lowercase();
    let base = t.split(['(', ' ']).next().unwrap_or("");
    matches!(
        base,
        "tinyint"
            | "smallint"
            | "mediumint"
            | "int"
            | "integer"
            | "bigint"
            | "decimal"
            | "numeric"
            | "float"
            | "double"
            | "real"
            | "bit"
            | "year"
    )
}

impl Masker {
    /// Validates the rules and builds a masker with the given seed.
    pub fn new(req: &MaskingRequest, seed: [u8; SEED_LEN]) -> Result<Self, PyroError> {
        if req.rules.len() > MAX_RULES {
            return Err(PyroError::InvalidOperation(
                "El perfil de enmascaramiento tiene demasiadas reglas.".into(),
            ));
        }
        let mut rules = HashMap::new();
        let mut fixed_values = HashMap::new();
        for rule in &req.rules {
            if rule.table.trim().is_empty() || rule.column.trim().is_empty() {
                return Err(PyroError::InvalidOperation(
                    "Cada regla de enmascaramiento necesita tabla y columna.".into(),
                ));
            }
            if rule.strategy == MaskingStrategy::Keep {
                continue;
            }
            let shift_days = rule.shift_days.unwrap_or(DEFAULT_SHIFT_DAYS);
            if rule.strategy == MaskingStrategy::DateShift
                && !(1..=MAX_SHIFT_DAYS).contains(&shift_days)
            {
                return Err(PyroError::InvalidOperation(format!(
                    "El desplazamiento de fechas de {}.{} debe estar entre 1 y {MAX_SHIFT_DAYS} días.",
                    rule.table, rule.column
                )));
            }
            let key = key_of(&rule.table, &rule.column);
            if rule.strategy == MaskingStrategy::Fixed {
                let value = rule.fixed_value.clone().unwrap_or_default();
                if value.len() > MAX_FIXED_LEN {
                    return Err(PyroError::InvalidOperation(format!(
                        "El valor fijo de {}.{} es demasiado largo.",
                        rule.table, rule.column
                    )));
                }
                fixed_values.insert(key.clone(), value);
            }
            rules.insert(
                key,
                ResolvedRule {
                    strategy: rule.strategy,
                    shift_days,
                    max_len: None,
                },
            );
        }
        Ok(Self {
            key: seed,
            rules,
            fixed_values,
            profile_name: req.profile_name.clone(),
            notes: Vec::new(),
        })
    }

    pub fn is_empty(&self) -> bool {
        self.rules.is_empty()
    }

    pub fn rule_count(&self) -> usize {
        self.rules.len()
    }

    pub fn has_rules_for(&self, table: &str) -> bool {
        let t = table.trim().to_lowercase();
        self.rules.keys().any(|(rt, _)| *rt == t)
    }

    /// Makes both sides of every foreign key use the same strategy, so masked child
    /// values still match their masked parents. A strategy that could merge distinct
    /// values (names, partial email…) is upgraded to `Hash` on key columns.
    pub fn propagate_foreign_keys(&mut self, fks: &HashMap<String, Vec<ForeignKeyMetadata>>) {
        let pairs: Vec<((String, String), (String, String))> = fks
            .iter()
            .flat_map(|(table, list)| {
                list.iter().map(move |fk| {
                    (
                        key_of(table, &fk.column_name),
                        key_of(&fk.referenced_table, &fk.referenced_column),
                    )
                })
            })
            .collect();
        // Chains (a → b → c) settle in a few passes.
        for _ in 0..8 {
            let mut changed = false;
            for (child, parent) in &pairs {
                let (c, p) = (
                    self.rules.get(child).copied(),
                    self.rules.get(parent).copied(),
                );
                let chosen = match (c, p) {
                    (None, None) => continue,
                    (Some(c), Some(p)) if c == p && c.strategy.is_key_safe() => continue,
                    (_, Some(p)) => p,
                    (Some(c), None) => c,
                };
                let chosen = if chosen.strategy.is_key_safe() {
                    chosen
                } else {
                    ResolvedRule {
                        strategy: MaskingStrategy::Hash,
                        shift_days: chosen.shift_days,
                        max_len: None,
                    }
                };
                for side in [child, parent] {
                    if self.rules.get(side) != Some(&chosen) {
                        self.rules.insert(side.clone(), chosen);
                        changed = true;
                    }
                }
                let note = format!(
                    "{}.{} ↔ {}.{}: clave foránea enmascarada con «{}» en ambos lados.",
                    child.0,
                    child.1,
                    parent.0,
                    parent.1,
                    chosen.strategy.tag()
                );
                if !self.notes.contains(&note) {
                    self.notes.push(note);
                }
            }
            if !changed {
                break;
            }
        }
    }

    /// Rule per column (by position) for one table. Primary-key columns only accept
    /// key-safe strategies; numeric keys are surrogate ids, not PII, and are kept.
    pub fn column_plan(
        &mut self,
        table: &str,
        columns: &[(String, String)],
        pk_columns: &[String],
    ) -> Vec<Option<ResolvedRule>> {
        let is_pk = |name: &str| {
            pk_columns.iter().any(|pk| {
                pk.trim_matches(|ch| ch == '`' || ch == '"')
                    .eq_ignore_ascii_case(name)
            })
        };
        let mut plan = Vec::with_capacity(columns.len());
        for (name, data_type) in columns {
            let key = key_of(table, name);
            let Some(mut rule) = self.rules.get(&key).copied() else {
                plan.push(None);
                continue;
            };
            // Binary data is exported as hex: only outputs that stay valid hex fit.
            if data_type == "binary"
                && !matches!(rule.strategy, MaskingStrategy::Hash | MaskingStrategy::Null)
            {
                rule.strategy = MaskingStrategy::Hash;
                self.notes.push(format!(
                    "{table}.{name}: columna binaria, se usa hash irreversible."
                ));
            }
            if is_pk(name) {
                if is_numeric_type(data_type) {
                    self.notes.push(format!(
                        "{table}.{name}: clave primaria numérica, se conserva (no es dato personal)."
                    ));
                    plan.push(None);
                    continue;
                }
                if !rule.strategy.is_key_safe() {
                    rule.strategy = MaskingStrategy::Hash;
                    self.notes.push(format!(
                        "{table}.{name}: clave primaria, se usa hash irreversible para mantenerla única."
                    ));
                }
            }
            rule.max_len = char_limit(data_type);
            plan.push(Some(rule));
        }
        plan
    }

    /// Masks a value from the SQL dump pipeline.
    pub fn mask_json(
        &self,
        table: &str,
        column: &str,
        rule: ResolvedRule,
        value: &serde_json::Value,
    ) -> serde_json::Value {
        use serde_json::Value;
        let text = match value {
            Value::Null => return Value::Null,
            Value::String(s) => s.clone(),
            Value::Number(n) => n.to_string(),
            Value::Bool(b) => b.to_string(),
            other => other.to_string(),
        };
        match self.mask_text(table, column, rule, &text) {
            Some(masked) => Value::String(masked),
            None => Value::Null,
        }
    }

    /// Masks a value from the CSV/Excel pipeline.
    pub fn mask_cell(
        &self,
        table: &str,
        column: &str,
        rule: ResolvedRule,
        cell: ExportCell,
    ) -> ExportCell {
        let text = match &cell {
            ExportCell::Blank => return ExportCell::Blank,
            ExportCell::Bool(b) => b.to_string(),
            ExportCell::Number(n) => {
                if n.fract() == 0.0 && n.abs() < 1e15 {
                    format!("{}", *n as i64)
                } else {
                    n.to_string()
                }
            }
            ExportCell::Text { value, .. } => value.clone(),
        };
        match self.mask_text(table, column, rule, &text) {
            Some(value) => ExportCell::Text {
                value,
                autosize: true,
            },
            None => ExportCell::Blank,
        }
    }

    fn digest(&self, strategy: MaskingStrategy, value: &str) -> [u8; 32] {
        hmac_sha256(
            &self.key,
            &[strategy.tag().as_bytes(), b"\0", value.as_bytes()],
        )
    }

    /// `None` means NULL.
    pub fn mask_text(
        &self,
        table: &str,
        column: &str,
        rule: ResolvedRule,
        value: &str,
    ) -> Option<String> {
        use MaskingStrategy as S;
        let h = self.digest(rule.strategy, value);
        let pick = |list: &[&'static str], i: usize| {
            let n = u16::from_be_bytes([h[i], h[i + 1]]) as usize;
            list[n % list.len()]
        };
        let masked = match rule.strategy {
            S::Keep => value.to_string(),
            S::Null => return None,
            S::Fixed => self
                .fixed_values
                .get(&key_of(table, column))
                .cloned()
                .unwrap_or_default(),
            S::FullName => format!("{} {}", pick(FIRST_NAMES, 0), pick(LAST_NAMES, 2)),
            S::FirstName => pick(FIRST_NAMES, 0).to_string(),
            S::LastName => pick(LAST_NAMES, 2).to_string(),
            S::Hash => hex(&h[..8]),
            S::EmailSynthetic => format!("user_{}@test.local", hex(&h[..6])),
            S::EmailPartial => match value.rsplit_once('@') {
                Some((local, domain)) if !local.is_empty() => {
                    let chars: Vec<char> = local.chars().collect();
                    let first = chars[0];
                    let last = chars[chars.len() - 1];
                    if chars.len() <= 2 {
                        format!("{first}***@{domain}")
                    } else {
                        format!("{first}***{last}@{domain}")
                    }
                }
                _ => format!("{}***", hex(&h[..3])),
            },
            S::PhoneDigits => {
                let mut stream = DigitStream::new(self, value);
                value
                    .chars()
                    .map(|c| {
                        if c.is_ascii_digit() {
                            stream.next_digit()
                        } else {
                            c
                        }
                    })
                    .collect()
            }
            S::DigitsZero => value
                .chars()
                .map(|c| {
                    if c.is_ascii_digit() {
                        '0'
                    } else if c.is_alphabetic() {
                        'X'
                    } else {
                        c
                    }
                })
                .collect(),
            S::CardMask => {
                let digits: Vec<char> = value.chars().filter(char::is_ascii_digit).collect();
                if digits.len() >= 8 {
                    let last4: String = digits[digits.len() - 4..].iter().collect();
                    format!("**** **** **** {last4}")
                } else {
                    "****".to_string()
                }
            }
            S::DateShift => shift_date(value, &h, rule.shift_days)?,
        };
        Some(match rule.max_len {
            Some(limit) if masked.chars().count() > limit => masked.chars().take(limit).collect(),
            _ => masked,
        })
    }
}

/// Masks the cells of a CSV/Excel row stream for one table. `plan[i]` is the rule
/// for the i-th column of `names` (the stream's column order).
pub fn mask_row_stream(
    rows: RowStream,
    masker: Masker,
    table: String,
    names: Vec<String>,
    plan: Vec<Option<ResolvedRule>>,
) -> RowStream {
    rows.map(move |item| {
        item.map(|item| match item {
            RowStreamItem::Row(cells) => RowStreamItem::Row(
                cells
                    .into_iter()
                    .enumerate()
                    .map(
                        |(i, cell)| match (plan.get(i).copied().flatten(), names.get(i)) {
                            (Some(rule), Some(name)) => masker.mask_cell(&table, name, rule, cell),
                            _ => cell,
                        },
                    )
                    .collect(),
            ),
            columns => columns,
        })
    })
    .boxed()
}

/// Deterministic digits for one value, extended with a counter when long.
struct DigitStream<'a> {
    masker: &'a Masker,
    value: &'a str,
    block: [u8; 32],
    pos: usize,
    counter: u32,
}

impl<'a> DigitStream<'a> {
    fn new(masker: &'a Masker, value: &'a str) -> Self {
        Self {
            masker,
            value,
            block: masker.digest(MaskingStrategy::PhoneDigits, value),
            pos: 0,
            counter: 0,
        }
    }

    fn next_digit(&mut self) -> char {
        if self.pos == self.block.len() {
            self.counter += 1;
            self.block = hmac_sha256(
                &self.masker.key,
                &[
                    b"phone_digits\0",
                    self.value.as_bytes(),
                    &self.counter.to_be_bytes(),
                ],
            );
            self.pos = 0;
        }
        let d = self.block[self.pos] % 10;
        self.pos += 1;
        char::from(b'0' + d)
    }
}

/// Character limit declared by a `char(n)` / `varchar(n)` column type.
fn char_limit(column_type: &str) -> Option<usize> {
    let t = column_type.trim().to_lowercase();
    let (base, rest) = t.split_once('(')?;
    if !matches!(
        base.trim(),
        "char" | "varchar" | "nchar" | "nvarchar" | "character" | "character varying"
    ) {
        return None;
    }
    rest.split(')').next()?.trim().parse().ok()
}

/// Moves the leading `YYYY-MM-DD` by a deterministic offset in `[-days, +days]`
/// (never 0); the rest (time, zone) is kept. Zero dates (`0000-00-00`, "no date")
/// are kept; any other unparseable value becomes NULL (`None`) so the original
/// never leaks and a DATE column still accepts the row.
fn shift_date(value: &str, h: &[u8; 32], days: u32) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.starts_with("0000-00-00") {
        return Some(trimmed.to_string());
    }
    let date = trimmed
        .get(..10)
        .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())?;
    let span = u64::from(days) * 2;
    let n = u64::from_be_bytes([h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]]) % span;
    // Map [0, 2d) to [-d, -1] ∪ [1, d].
    let offset = if n < u64::from(days) {
        -(n as i64) - 1
    } else {
        (n - u64::from(days)) as i64 + 1
    };
    Some(match date.checked_add_signed(Duration::days(offset)) {
        Some(shifted) => format!("{}{}", shifted.format("%Y-%m-%d"), &trimmed[10..]),
        None => trimmed.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(table: &str, column: &str, strategy: MaskingStrategy) -> MaskingRule {
        MaskingRule {
            table: table.into(),
            column: column.into(),
            strategy,
            shift_days: None,
            fixed_value: None,
        }
    }

    fn masker(rules: Vec<MaskingRule>, seed: u8) -> Masker {
        Masker::new(
            &MaskingRequest {
                rules,
                ..Default::default()
            },
            [seed; SEED_LEN],
        )
        .unwrap()
    }

    fn resolved(strategy: MaskingStrategy) -> ResolvedRule {
        ResolvedRule {
            strategy,
            shift_days: DEFAULT_SHIFT_DAYS,
            max_len: None,
        }
    }

    #[test]
    fn hmac_matches_rfc4231_test_case_1() {
        // RFC 4231 §4.2: key = 20 × 0x0b; HMAC zero-pads keys, so 32 bytes with a
        // zero tail is the same key.
        let mut key = [0u8; 32];
        key[..20].fill(0x0b);
        assert_eq!(
            hex(&hmac_sha256(&key, &[b"Hi ", b"There"])),
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
        );
    }

    #[test]
    fn strategies_produce_expected_shapes() {
        let m = masker(vec![], 7);
        let t = |s, v: &str| m.mask_text("t", "c", resolved(s), v);
        use MaskingStrategy as S;
        assert_eq!(
            t(S::EmailPartial, "juanpe@dominio.com").unwrap(),
            "j***e@dominio.com"
        );
        assert!(t(S::EmailSynthetic, "a@b.c")
            .unwrap()
            .ends_with("@test.local"));
        let phone = t(S::PhoneDigits, "+52 (55) 1234-5678").unwrap();
        assert_eq!(phone.len(), "+52 (55) 1234-5678".len());
        assert_eq!(&phone[..1], "+");
        assert_eq!(&phone[3..5], " (");
        assert_eq!(t(S::DigitsZero, "12345678-Z").unwrap(), "00000000-X");
        assert_eq!(
            t(S::CardMask, "4111 1111 1111 1234").unwrap(),
            "**** **** **** 1234"
        );
        assert_eq!(t(S::Hash, "secreto").unwrap().len(), 16);
        assert_eq!(t(S::Null, "x"), None);
        let name = t(S::FullName, "Carlos García").unwrap();
        assert!(name.contains(' '));
    }

    #[test]
    fn date_shift_stays_within_range_and_keeps_time() {
        let m = masker(vec![], 3);
        let original = NaiveDate::from_ymd_opt(1990, 6, 15).unwrap();
        for i in 0..200 {
            let value = format!("1990-06-15 10:20:{:02}", i % 60);
            let out = m
                .mask_text(
                    "p",
                    &format!("c{i}"),
                    resolved(MaskingStrategy::DateShift),
                    &value,
                )
                .unwrap();
            let shifted = NaiveDate::parse_from_str(&out[..10], "%Y-%m-%d").unwrap();
            let diff = (shifted - original).num_days().abs();
            assert!((1..=30).contains(&diff), "{out}");
            assert!(out.ends_with(&value[10..]));
        }
    }

    #[test]
    fn same_value_same_output_and_seed_changes_everything() {
        let a = masker(vec![], 1);
        let b = masker(vec![], 2);
        let r = resolved(MaskingStrategy::Hash);
        assert_eq!(
            a.mask_text("x", "y", r, "ana@x.com"),
            a.mask_text("z", "w", r, "ana@x.com")
        );
        assert_ne!(
            a.mask_text("x", "y", r, "ana@x.com"),
            b.mask_text("x", "y", r, "ana@x.com")
        );
    }

    #[test]
    fn hash_is_not_reversible_from_profile_data() {
        // Without the seed, hashing the original value does not reproduce the output.
        let m = masker(vec![], 9);
        let out = m
            .mask_text("t", "c", resolved(MaskingStrategy::Hash), "ana@x.com")
            .unwrap();
        let plain = hex(&Sha256::digest(b"ana@x.com")[..8]);
        assert_ne!(out, plain);
        assert!(!out.contains("ana"));
    }

    #[test]
    fn foreign_keys_get_the_same_key_safe_strategy() {
        let mut m = masker(
            vec![
                rule("clientes", "email", MaskingStrategy::EmailPartial),
                rule("pedidos", "cliente_email", MaskingStrategy::FullName),
            ],
            5,
        );
        let mut fks = HashMap::new();
        fks.insert(
            "pedidos".to_string(),
            vec![ForeignKeyMetadata {
                name: "fk_pedido_cliente".into(),
                column_name: "cliente_email".into(),
                referenced_table: "clientes".into(),
                referenced_column: "email".into(),
                update_rule: "CASCADE".into(),
                delete_rule: "RESTRICT".into(),
            }],
        );
        m.propagate_foreign_keys(&fks);
        let parent = m.column_plan("clientes", &[("email".into(), "varchar".into())], &[]);
        let child = m.column_plan(
            "pedidos",
            &[("cliente_email".into(), "varchar".into())],
            &[],
        );
        assert_eq!(parent[0].unwrap().strategy, MaskingStrategy::Hash);
        assert_eq!(parent, child);
        let p = m.mask_text("clientes", "email", parent[0].unwrap(), "ana@x.com");
        let c = m.mask_text("pedidos", "cliente_email", child[0].unwrap(), "ana@x.com");
        assert_eq!(p, c, "parent and child values must still join");
        assert!(!m.notes.is_empty());
    }

    #[test]
    fn foreign_key_child_inherits_parent_rule() {
        let mut m = masker(
            vec![rule("clientes", "codigo", MaskingStrategy::EmailSynthetic)],
            5,
        );
        let mut fks = HashMap::new();
        fks.insert(
            "facturas".to_string(),
            vec![ForeignKeyMetadata {
                name: "fk".into(),
                column_name: "cliente_codigo".into(),
                referenced_table: "clientes".into(),
                referenced_column: "codigo".into(),
                update_rule: String::new(),
                delete_rule: String::new(),
            }],
        );
        m.propagate_foreign_keys(&fks);
        let child = m.column_plan(
            "facturas",
            &[("cliente_codigo".into(), "varchar".into())],
            &[],
        );
        assert_eq!(child[0].unwrap().strategy, MaskingStrategy::EmailSynthetic);
    }

    #[test]
    fn primary_keys_stay_valid() {
        let mut m = masker(
            vec![
                rule("t", "id", MaskingStrategy::PhoneDigits),
                rule("t", "rfc", MaskingStrategy::DigitsZero),
            ],
            1,
        );
        let plan = m.column_plan(
            "t",
            &[
                ("id".into(), "int".into()),
                ("rfc".into(), "varchar(13)".into()),
            ],
            &["id".into(), "rfc".into()],
        );
        assert_eq!(plan[0], None, "numeric surrogate keys are kept");
        assert_eq!(plan[1].unwrap().strategy, MaskingStrategy::Hash);
    }

    #[test]
    fn validates_rules() {
        let mut bad = rule("t", "d", MaskingStrategy::DateShift);
        bad.shift_days = Some(0);
        assert!(Masker::new(
            &MaskingRequest {
                rules: vec![bad],
                ..Default::default()
            },
            [0; SEED_LEN]
        )
        .is_err());
        assert!(Masker::new(
            &MaskingRequest {
                rules: vec![rule("", "c", MaskingStrategy::Hash)],
                ..Default::default()
            },
            [0; SEED_LEN]
        )
        .is_err());
        let keep_only = masker(vec![rule("t", "c", MaskingStrategy::Keep)], 0);
        assert!(keep_only.is_empty());
    }

    #[test]
    fn masks_json_and_cells_preserving_nulls() {
        let m = masker(vec![], 4);
        let r = resolved(MaskingStrategy::Hash);
        assert_eq!(
            m.mask_json("t", "c", r, &serde_json::Value::Null),
            serde_json::Value::Null
        );
        assert!(m
            .mask_json("t", "c", r, &serde_json::json!(5512345678u64))
            .is_string());
        assert!(matches!(
            m.mask_cell("t", "c", r, ExportCell::Blank),
            ExportCell::Blank
        ));
        assert!(matches!(
            m.mask_cell(
                "t",
                "c",
                resolved(MaskingStrategy::Null),
                ExportCell::Number(3.0)
            ),
            ExportCell::Blank
        ));
    }

    #[test]
    fn masked_text_fits_the_column_and_bad_dates_become_null() {
        let mut m = masker(
            vec![
                rule("t", "codigo", MaskingStrategy::Hash),
                rule("t", "nombre", MaskingStrategy::FullName),
            ],
            6,
        );
        let plan = m.column_plan(
            "t",
            &[
                ("codigo".into(), "varchar(10)".into()),
                ("nombre".into(), "VARCHAR(5)".into()),
            ],
            &[],
        );
        let code = m
            .mask_text("t", "codigo", plan[0].unwrap(), "ABC-123")
            .unwrap();
        assert_eq!(code.chars().count(), 10);
        let name = m
            .mask_text("t", "nombre", plan[1].unwrap(), "Carlos García")
            .unwrap();
        assert!(name.chars().count() <= 5);
        assert_eq!(char_limit("text"), None);
        assert_eq!(char_limit("int(11)"), None);

        let shift = resolved(MaskingStrategy::DateShift);
        assert_eq!(m.mask_text("t", "f", shift, "15/06/1990"), None);
        assert_eq!(
            m.mask_text("t", "f", shift, "0000-00-00 00:00:00")
                .as_deref(),
            Some("0000-00-00 00:00:00")
        );
    }

    #[test]
    fn seed_hex_round_trip() {
        let seed = [0xabu8; SEED_LEN];
        assert_eq!(decode_hex_seed(&hex(&seed)), Some(seed));
        assert_eq!(decode_hex_seed("zz"), None);
    }
}
