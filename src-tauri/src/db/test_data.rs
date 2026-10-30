//! Synthetic rows for development databases. Each column gets a generator
//! inferred from its type and name (emails, names, dates, valid foreign keys
//! sampled from the referenced table…); the user can override any of them.
//! Never runs on PROD or read-only connections.

use std::collections::HashMap;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::backend::DatabaseBackend;
use super::error::PyroError;
use super::introspect::introspector;
use super::models::{ColumnMetadata, ConnectionConfig};

pub const MAX_ROWS: u32 = 100_000;
const ROWS_PER_INSERT: usize = 200;
const STATEMENTS_PER_TRANSACTION: usize = 25;
const FK_SAMPLE: usize = 1000;
const PREVIEW_ROWS: usize = 5;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Generator {
    /// Column omitted: its default or AUTO_INCREMENT applies.
    Skip,
    Null,
    /// Consecutive integers (primary keys without AUTO_INCREMENT).
    Sequence {
        start: i64,
    },
    Integer {
        min: i64,
        max: i64,
    },
    Decimal {
        min: f64,
        max: f64,
        scale: u32,
    },
    Boolean,
    Text {
        max_len: u32,
    },
    FirstName,
    LastName,
    FullName,
    Email,
    Phone,
    City,
    Country,
    Company,
    Url,
    Uuid,
    Date,
    DateTime,
    Time,
    Year,
    Json,
    OneOf {
        values: Vec<String>,
    },
    /// Random existing value of `table.column`.
    ForeignKey {
        table: String,
        column: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnPlan {
    pub column: String,
    pub column_type: String,
    pub is_nullable: bool,
    pub generator: Generator,
}

#[derive(Debug, Clone, Serialize)]
pub struct TestDataPlan {
    pub columns: Vec<ColumnPlan>,
    pub preview: Vec<Vec<Value>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TestDataRequest {
    pub database: String,
    pub table: String,
    pub rows: u32,
    pub columns: Vec<ColumnPlan>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TestDataSummary {
    pub inserted: u64,
    pub elapsed_ms: u64,
}

/// Rejects connections where synthetic data must never be written.
pub fn ensure_allowed(config: &ConnectionConfig) -> Result<(), PyroError> {
    if config.read_only {
        return Err(PyroError::ReadOnlyConnection(
            "La conexión es de solo lectura: no se generan datos de prueba.".into(),
        ));
    }
    let env = config.environment.as_deref().unwrap_or_default();
    if env.eq_ignore_ascii_case("production") || env.eq_ignore_ascii_case("prod") {
        return Err(PyroError::InvalidOperation(
            "El generador de datos de prueba está bloqueado en conexiones de producción.".into(),
        ));
    }
    Ok(())
}

// ─── Random values ──────────────────────────────────────────────────────────

/// xorshift64*: fast and good enough for fake data (not for anything secret).
struct Rng(u64);

impl Rng {
    fn new() -> Self {
        let mut seed = [0u8; 8];
        let _ = getrandom::fill(&mut seed);
        Self(u64::from_le_bytes(seed) | 1)
    }

    #[cfg(test)]
    fn seeded(seed: u64) -> Self {
        Self(seed | 1)
    }

    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    fn range(&mut self, min: i64, max: i64) -> i64 {
        if max <= min {
            return min;
        }
        let span = (max as i128 - min as i128 + 1) as u128;
        (min as i128 + (self.next() as u128 % span) as i128) as i64
    }

    fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[self.next() as usize % items.len()]
    }
}

const FIRST_NAMES: &[&str] = &[
    "Ana", "Luis", "María", "Carlos", "Lucía", "Javier", "Sofía", "Diego", "Elena", "Pablo",
    "Valeria", "Andrés", "Camila", "Jorge", "Isabel", "Miguel", "Paula", "Raúl", "Laura", "Tomás",
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
];
const CITIES: &[&str] = &[
    "Madrid",
    "Barcelona",
    "Sevilla",
    "Valencia",
    "Bilbao",
    "Ciudad de México",
    "Guadalajara",
    "Monterrey",
    "Bogotá",
    "Medellín",
    "Lima",
    "Santiago",
    "Buenos Aires",
    "Montevideo",
    "Quito",
];
const COUNTRIES: &[&str] = &[
    "España",
    "México",
    "Colombia",
    "Perú",
    "Chile",
    "Argentina",
    "Uruguay",
    "Ecuador",
];
const COMPANIES: &[&str] = &[
    "Acme", "Globex", "Initech", "Umbrella", "Soylent", "Hooli", "Vandelay", "Stark",
];
const COMPANY_SUFFIX: &[&str] = &["S.A.", "S.L.", "S.A. de C.V.", "Ltda.", "Group"];
const WORDS: &[&str] = &[
    "lorem", "ipsum", "dolor", "sit", "amet", "datos", "prueba", "cliente", "pedido", "valor",
    "rápido", "nuevo", "estado", "registro", "ejemplo", "sistema", "informe", "zona", "nota",
];
const DOMAINS: &[&str] = &["example.com", "example.org", "test.local", "correo.test"];

fn ascii_slug(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            'á' | 'Á' => 'a',
            'é' | 'É' => 'e',
            'í' | 'Í' => 'i',
            'ó' | 'Ó' => 'o',
            'ú' | 'Ú' | 'ü' => 'u',
            'ñ' | 'Ñ' => 'n',
            other => other.to_ascii_lowercase(),
        })
        .filter(char::is_ascii_alphanumeric)
        .collect()
}

/// Values for one column, with state for sequences and foreign key samples.
struct ColumnSource {
    generator: Generator,
    is_nullable: bool,
    next_sequence: i64,
    fk_values: Vec<Value>,
}

impl ColumnSource {
    fn value(&mut self, rng: &mut Rng, row: u64) -> Value {
        // Nullable columns get an occasional NULL so the data looks real.
        let maybe_null = self.is_nullable
            && !matches!(
                self.generator,
                Generator::Sequence { .. } | Generator::ForeignKey { .. } | Generator::Null
            );
        if maybe_null && rng.next() % 20 == 0 {
            return Value::Null;
        }
        let year = || 2015 + (row % 10) as i64;
        match &self.generator {
            Generator::Skip | Generator::Null => Value::Null,
            Generator::Sequence { .. } => {
                let v = self.next_sequence;
                self.next_sequence += 1;
                v.into()
            }
            Generator::Integer { min, max } => rng.range(*min, *max).into(),
            Generator::Decimal { min, max, scale } => {
                let factor = 10f64.powi(*scale as i32);
                let lo = (min * factor) as i64;
                let hi = (max * factor) as i64;
                let raw = rng.range(lo, hi) as f64 / factor;
                Value::String(format!("{raw:.prec$}", prec = *scale as usize))
            }
            Generator::Boolean => (rng.next() % 2).into(),
            Generator::Text { max_len } => {
                let count = rng.range(1, 8) as usize;
                let words: Vec<&str> = (0..count).map(|_| *rng.pick(WORDS)).collect();
                let joined = words.join(" ");
                Value::String(joined.chars().take((*max_len).max(1) as usize).collect())
            }
            Generator::FirstName => Value::String(rng.pick(FIRST_NAMES).to_string()),
            Generator::LastName => Value::String(rng.pick(LAST_NAMES).to_string()),
            Generator::FullName => Value::String(format!(
                "{} {}",
                rng.pick(FIRST_NAMES),
                rng.pick(LAST_NAMES)
            )),
            Generator::Email => Value::String(format!(
                "{}.{}{}@{}",
                ascii_slug(rng.pick(FIRST_NAMES)),
                ascii_slug(rng.pick(LAST_NAMES)),
                row + 1,
                rng.pick(DOMAINS)
            )),
            Generator::Phone => Value::String(format!(
                "+34 6{:02} {:03} {:03}",
                rng.range(0, 99),
                rng.range(0, 999),
                rng.range(0, 999)
            )),
            Generator::City => Value::String(rng.pick(CITIES).to_string()),
            Generator::Country => Value::String(rng.pick(COUNTRIES).to_string()),
            Generator::Company => Value::String(format!(
                "{} {}",
                rng.pick(COMPANIES),
                rng.pick(COMPANY_SUFFIX)
            )),
            Generator::Url => Value::String(format!(
                "https://{}.{}/{}",
                rng.pick(WORDS),
                rng.pick(DOMAINS),
                rng.range(1, 9999)
            )),
            Generator::Uuid => {
                let (a, b) = (rng.next(), rng.next());
                let h = format!("{a:016x}{b:016x}");
                Value::String(format!(
                    "{}-{}-4{}-{}-{}",
                    &h[0..8],
                    &h[8..12],
                    &h[13..16],
                    &h[16..20],
                    &h[20..32]
                ))
            }
            Generator::Date => Value::String(format!(
                "{}-{:02}-{:02}",
                year(),
                rng.range(1, 12),
                rng.range(1, 28)
            )),
            Generator::DateTime => Value::String(format!(
                "{}-{:02}-{:02} {:02}:{:02}:{:02}",
                year(),
                rng.range(1, 12),
                rng.range(1, 28),
                rng.range(0, 23),
                rng.range(0, 59),
                rng.range(0, 59)
            )),
            Generator::Time => Value::String(format!(
                "{:02}:{:02}:{:02}",
                rng.range(0, 23),
                rng.range(0, 59),
                rng.range(0, 59)
            )),
            Generator::Year => rng.range(2000, 2030).into(),
            Generator::Json => Value::String(format!(
                "{{\"etiqueta\":\"{}\",\"valor\":{}}}",
                rng.pick(WORDS),
                rng.range(0, 1000)
            )),
            Generator::OneOf { values } => {
                if values.is_empty() {
                    Value::Null
                } else {
                    Value::String(rng.pick(values).clone())
                }
            }
            Generator::ForeignKey { .. } => {
                if self.fk_values.is_empty() {
                    Value::Null
                } else {
                    rng.pick(&self.fk_values).clone()
                }
            }
        }
    }
}

// ─── Inference ──────────────────────────────────────────────────────────────

/// `varchar(50)` → 50; `enum('a','b')` → ["a", "b"].
fn type_args(column_type: &str) -> Option<&str> {
    let start = column_type.find('(')?;
    let end = column_type.rfind(')')?;
    (end > start).then(|| &column_type[start + 1..end])
}

fn enum_values(column_type: &str) -> Vec<String> {
    type_args(column_type)
        .map(|args| {
            args.split(',')
                .map(|v| v.trim().trim_matches('\'').replace("''", "'"))
                .filter(|v| !v.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn int_range(data_type: &str, column_type: &str) -> (i64, i64) {
    let unsigned = column_type.contains("unsigned");
    match data_type {
        "tinyint" => (if unsigned { 0 } else { 1 }, 100),
        "smallint" => (1, 10_000),
        _ => (1, 100_000),
    }
}

pub fn infer_generator(
    column: &ColumnMetadata,
    fk: Option<(&str, &str)>,
    next_key: i64,
) -> Generator {
    let name = column.name.to_lowercase();
    let data_type = column.data_type.to_lowercase();
    let column_type = column.column_type.to_lowercase();
    let is_pk = column.column_key.eq_ignore_ascii_case("PRI");
    let has = |words: &[&str]| words.iter().any(|w| name.contains(w));
    let is_text = ["char", "text", "clob"]
        .iter()
        .any(|t| data_type.contains(t));
    let is_int = data_type.contains("int");

    if column.extra.to_lowercase().contains("auto_increment")
        || column.extra.to_lowercase().contains("generated")
    {
        return Generator::Skip;
    }
    if let Some((table, col)) = fk {
        return Generator::ForeignKey {
            table: table.to_string(),
            column: col.to_string(),
        };
    }
    if is_pk && is_int {
        return Generator::Sequence { start: next_key };
    }
    if data_type == "enum" || data_type == "set" {
        return Generator::OneOf {
            values: enum_values(&column.column_type),
        };
    }
    if is_text {
        let max_len = type_args(&column_type)
            .and_then(|a| a.trim().parse::<u32>().ok())
            .unwrap_or(255);
        if has(&["uuid", "guid"]) || (is_pk && max_len >= 36) {
            return Generator::Uuid;
        }
        let by_name = if has(&["email", "correo", "mail"]) {
            Some(Generator::Email)
        } else if has(&["apellido", "last_name", "lastname", "surname"]) {
            Some(Generator::LastName)
        } else if has(&["nombre_completo", "full_name", "fullname"]) {
            Some(Generator::FullName)
        } else if has(&["first_name", "firstname", "nombre", "name"]) && !has(&["user"]) {
            Some(if has(&["first"]) {
                Generator::FirstName
            } else {
                Generator::FullName
            })
        } else if has(&["telefono", "teléfono", "phone", "movil", "celular", "tel"]) {
            Some(Generator::Phone)
        } else if has(&["ciudad", "city", "localidad", "municipio"]) {
            Some(Generator::City)
        } else if has(&["pais", "país", "country"]) {
            Some(Generator::Country)
        } else if has(&["empresa", "company", "compania", "compañia", "razon_social"]) {
            Some(Generator::Company)
        } else if has(&["url", "web", "sitio", "website"]) {
            Some(Generator::Url)
        } else {
            None
        };
        return match by_name {
            // Never produce values longer than the column.
            Some(g) if max_len >= 30 || matches!(g, Generator::FirstName | Generator::LastName) => {
                g
            }
            _ => Generator::Text { max_len },
        };
    }
    if data_type.contains("bool") || column_type.starts_with("tinyint(1)") || data_type == "bit" {
        return Generator::Boolean;
    }
    if is_int {
        let (min, max) = int_range(&data_type, &column_type);
        return Generator::Integer { min, max };
    }
    if ["decimal", "numeric", "float", "double", "real"]
        .iter()
        .any(|t| data_type.contains(t))
    {
        let scale = type_args(&column_type)
            .and_then(|a| a.split(',').nth(1))
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(2);
        let max = if has(&["precio", "price", "importe", "amount", "total"]) {
            5_000.0
        } else {
            1_000.0
        };
        return Generator::Decimal {
            min: 0.0,
            max,
            scale,
        };
    }
    if data_type.contains("datetime") || data_type.contains("timestamp") {
        return Generator::DateTime;
    }
    if data_type.contains("date") {
        return Generator::Date;
    }
    if data_type.contains("time") {
        return Generator::Time;
    }
    if data_type == "year" {
        return Generator::Year;
    }
    if data_type == "json" {
        return Generator::Json;
    }
    if column.is_nullable || column.column_default.is_some() {
        return Generator::Skip;
    }
    Generator::Text { max_len: 16 }
}

// ─── Plan & execution ───────────────────────────────────────────────────────

async fn next_key_value(
    backend: &dyn DatabaseBackend,
    database: &str,
    table_ref: &str,
    column: &str,
) -> Result<i64, PyroError> {
    let dialect = backend.engine().dialect();
    let sql = format!(
        "SELECT MAX({}) FROM {table_ref}",
        dialect.quote_identifier(column)?
    );
    let rows = backend.execute_query(&sql, Some(database)).await?.rows;
    let max = rows
        .first()
        .and_then(|r| r.first())
        .and_then(|v| {
            v.as_i64()
                .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
        })
        .unwrap_or(0);
    Ok(max + 1)
}

pub async fn plan_test_data(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
) -> Result<TestDataPlan, PyroError> {
    let schema = introspector(backend);
    let columns = schema.table_columns(backend, database, table).await?;
    let fks = schema.foreign_keys(backend, database).await?;
    let fk_by_column: HashMap<String, (String, String)> = fks
        .get(table)
        .into_iter()
        .flatten()
        .map(|fk| {
            (
                fk.column_name.to_lowercase(),
                (fk.referenced_table.clone(), fk.referenced_column.clone()),
            )
        })
        .collect();
    let table_ref = backend
        .engine()
        .dialect()
        .qualify_table(Some(database), table)?;

    let mut plans = Vec::with_capacity(columns.len());
    for column in &columns {
        let fk = fk_by_column.get(&column.name.to_lowercase());
        let needs_key = fk.is_none()
            && column.column_key.eq_ignore_ascii_case("PRI")
            && column.data_type.to_lowercase().contains("int");
        let next_key = if needs_key {
            next_key_value(backend, database, &table_ref, &column.name).await?
        } else {
            1
        };
        plans.push(ColumnPlan {
            column: column.name.clone(),
            column_type: column.column_type.clone(),
            is_nullable: column.is_nullable,
            generator: infer_generator(column, fk.map(|(t, c)| (t.as_str(), c.as_str())), next_key),
        });
    }

    // Sequences in the preview start at the same number the real run will use.
    let mut sources = prepare_sources(backend, database, &plans).await?;
    let mut rng = Rng::new();
    let active: Vec<usize> = active_columns(&plans);
    let preview = (0..PREVIEW_ROWS as u64)
        .map(|row| {
            active
                .iter()
                .map(|&i| sources[i].value(&mut rng, row))
                .collect()
        })
        .collect();
    Ok(TestDataPlan {
        columns: plans,
        preview,
    })
}

fn active_columns(plans: &[ColumnPlan]) -> Vec<usize> {
    plans
        .iter()
        .enumerate()
        .filter(|(_, p)| p.generator != Generator::Skip)
        .map(|(i, _)| i)
        .collect()
}

async fn prepare_sources(
    backend: &dyn DatabaseBackend,
    database: &str,
    plans: &[ColumnPlan],
) -> Result<Vec<ColumnSource>, PyroError> {
    let dialect = backend.engine().dialect();
    let mut sources = Vec::with_capacity(plans.len());
    for plan in plans {
        let mut source = ColumnSource {
            generator: plan.generator.clone(),
            is_nullable: plan.is_nullable,
            next_sequence: 0,
            fk_values: Vec::new(),
        };
        match &plan.generator {
            Generator::Sequence { start } => source.next_sequence = *start,
            Generator::ForeignKey { table, column } => {
                let col = dialect.quote_identifier(column)?;
                let sql = format!(
                    "SELECT DISTINCT {col} FROM {} WHERE {col} IS NOT NULL LIMIT {FK_SAMPLE}",
                    dialect.qualify_table(Some(database), table)?
                );
                source.fk_values = backend
                    .execute_query(&sql, Some(database))
                    .await?
                    .rows
                    .into_iter()
                    .filter_map(|r| r.into_iter().next())
                    .collect();
                if source.fk_values.is_empty() && !plan.is_nullable {
                    return Err(PyroError::InvalidOperation(format!(
                        "'{table}' no tiene filas: genere primero datos ahí para rellenar '{}'.",
                        plan.column
                    )));
                }
            }
            _ => {}
        }
        sources.push(source);
    }
    Ok(sources)
}

fn literal(dialect: &dyn super::dialect::Dialect, value: &Value) -> String {
    match value {
        Value::Null => "NULL".into(),
        Value::Bool(flag) => if *flag { "1" } else { "0" }.into(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => dialect.string_literal(s),
        other => dialect.string_literal(&other.to_string()),
    }
}

pub async fn generate_test_data(
    backend: &dyn DatabaseBackend,
    request: &TestDataRequest,
) -> Result<TestDataSummary, PyroError> {
    if request.rows == 0 || request.rows > MAX_ROWS {
        return Err(PyroError::InvalidOperation(format!(
            "El número de filas debe estar entre 1 y {MAX_ROWS}."
        )));
    }
    let started = Instant::now();
    let dialect = backend.engine().dialect();
    let table_ref = dialect.qualify_table(Some(&request.database), &request.table)?;
    let active = active_columns(&request.columns);
    if active.is_empty() {
        return Err(PyroError::InvalidOperation(
            "No hay columnas que rellenar: todas usan su valor por defecto.".into(),
        ));
    }
    let column_list = active
        .iter()
        .map(|&i| dialect.quote_identifier(&request.columns[i].column))
        .collect::<Result<Vec<_>, _>>()?
        .join(", ");
    let mut sources = prepare_sources(backend, &request.database, &request.columns).await?;
    let mut rng = Rng::new();

    let mut statements = Vec::with_capacity(STATEMENTS_PER_TRANSACTION);
    let mut row = 0u64;
    let mut inserted = 0u64;
    while row < request.rows as u64 {
        let batch_end = (row + ROWS_PER_INSERT as u64).min(request.rows as u64);
        let tuples: Vec<String> = (row..batch_end)
            .map(|r| {
                let values: Vec<String> = active
                    .iter()
                    .map(|&i| literal(dialect, &sources[i].value(&mut rng, r)))
                    .collect();
                format!("({})", values.join(", "))
            })
            .collect();
        statements.push(format!(
            "INSERT INTO {table_ref} ({column_list}) VALUES {};",
            tuples.join(", ")
        ));
        row = batch_end;
        if statements.len() == STATEMENTS_PER_TRANSACTION || row == request.rows as u64 {
            backend
                .execute_transaction(&statements, Some(&request.database))
                .await?;
            statements.clear();
            inserted = row;
        }
    }
    Ok(TestDataSummary {
        inserted,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::sqlite::tests::TempDatabase;

    fn column(name: &str, data_type: &str, column_type: &str) -> ColumnMetadata {
        ColumnMetadata {
            name: name.into(),
            ordinal_position: 1,
            column_default: None,
            is_nullable: false,
            data_type: data_type.into(),
            column_type: column_type.into(),
            column_key: String::new(),
            extra: String::new(),
            comment: String::new(),
            collation: None,
            character_set: None,
        }
    }

    #[test]
    fn infers_generators_from_type_and_name() {
        let infer = |c: ColumnMetadata| infer_generator(&c, None, 1);
        assert_eq!(
            infer(column("correo", "varchar", "varchar(120)")),
            Generator::Email
        );
        assert_eq!(
            infer(column("apellido", "varchar", "varchar(60)")),
            Generator::LastName
        );
        assert_eq!(
            infer(column("estado", "enum", "enum('activo','baja')")),
            Generator::OneOf {
                values: vec!["activo".into(), "baja".into()]
            }
        );
        assert_eq!(
            infer(column("activo", "tinyint", "tinyint(1)")),
            Generator::Boolean
        );
        assert_eq!(
            infer(column("precio", "decimal", "decimal(10,2)")),
            Generator::Decimal {
                min: 0.0,
                max: 5_000.0,
                scale: 2
            }
        );
        assert_eq!(
            infer(column("alta", "datetime", "datetime")),
            Generator::DateTime
        );
        // Short columns never get values that could overflow them.
        assert_eq!(
            infer(column("email", "varchar", "varchar(10)")),
            Generator::Text { max_len: 10 }
        );
        let mut id = column("id", "int", "int(11)");
        id.extra = "auto_increment".into();
        assert_eq!(infer(id), Generator::Skip);
        assert_eq!(
            infer_generator(
                &column("cliente_id", "int", "int"),
                Some(("cliente", "id")),
                1
            ),
            Generator::ForeignKey {
                table: "cliente".into(),
                column: "id".into()
            }
        );
    }

    #[test]
    fn values_respect_their_generator() {
        let mut rng = Rng::seeded(7);
        let mut source = ColumnSource {
            generator: Generator::Text { max_len: 5 },
            is_nullable: false,
            next_sequence: 0,
            fk_values: vec![],
        };
        for row in 0..50 {
            assert!(
                source
                    .value(&mut rng, row)
                    .as_str()
                    .unwrap()
                    .chars()
                    .count()
                    <= 5
            );
        }
        source.generator = Generator::Integer { min: 3, max: 4 };
        for row in 0..50 {
            let v = source.value(&mut rng, row).as_i64().unwrap();
            assert!((3..=4).contains(&v));
        }
    }

    #[test]
    fn blocks_production_and_read_only() {
        let mut config: ConnectionConfig =
            serde_json::from_value(serde_json::json!({"host": "h", "port": 1, "user": "u"}))
                .unwrap();
        assert!(ensure_allowed(&config).is_ok());
        config.environment = Some("production".into());
        assert!(ensure_allowed(&config).is_err());
        config.environment = Some("local".into());
        config.read_only = true;
        assert!(ensure_allowed(&config).is_err());
    }

    #[tokio::test]
    async fn fills_a_table_with_valid_foreign_keys() {
        let db = TempDatabase::with_schema(
            "CREATE TABLE cliente (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, email TEXT);
             CREATE TABLE pedido (id INTEGER PRIMARY KEY, cliente_id INTEGER NOT NULL REFERENCES cliente(id), total REAL);",
        )
        .await;

        let plan = plan_test_data(&db.backend, "main", "cliente")
            .await
            .unwrap();
        assert_eq!(plan.preview.len(), PREVIEW_ROWS);
        let summary = generate_test_data(
            &db.backend,
            &TestDataRequest {
                database: "main".into(),
                table: "cliente".into(),
                rows: 450,
                columns: plan.columns,
            },
        )
        .await
        .unwrap();
        assert_eq!(summary.inserted, 450);

        let plan = plan_test_data(&db.backend, "main", "pedido").await.unwrap();
        generate_test_data(
            &db.backend,
            &TestDataRequest {
                database: "main".into(),
                table: "pedido".into(),
                rows: 300,
                columns: plan.columns,
            },
        )
        .await
        .unwrap();

        let orphans = db
            .rows("SELECT COUNT(*) FROM pedido WHERE cliente_id NOT IN (SELECT id FROM cliente)")
            .await;
        assert_eq!(orphans[0][0], serde_json::json!(0));
        assert_eq!(
            db.rows("SELECT COUNT(*) FROM pedido").await[0][0],
            serde_json::json!(300)
        );
    }
}
