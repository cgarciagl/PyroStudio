//! Visual schema designer backend.
//!
//! The designer edits a [`DesignedSchema`] (tables, columns, primary keys and
//! foreign keys). This module compares it with the physical schema and builds
//! a reversible migration for MariaDB/MySQL:
//!
//! * `UP` creates tables in topological (dependency) order, alters columns,
//!   keys and foreign keys, and drops what the design no longer has.
//! * `DOWN` is the same diff computed in the opposite direction, so it is
//!   symmetric by construction.
//! * Circular table dependencies are rejected, and every change that can lose
//!   or truncate data produces a warning.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::LazyLock;

use regex::Regex;

use serde::{Deserialize, Serialize};

use super::backend::DatabaseBackend;
use super::dialect::{Dialect, MYSQL_DIALECT, SQLITE_DIALECT};
use super::engine::DbEngine;
use super::error::PyroError;
use super::introspect::introspector;
use super::models::MigrationStatement;
use super::safe_mode::DangerLevel;
use super::sql_utils::{quote_ident_mysql, sql_string_literal};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct DesignColumn {
    pub name: String,
    /// Name in the database when the design was loaded; differs from `name` on a rename.
    #[serde(default)]
    pub original_name: Option<String>,
    pub column_type: String,
    pub nullable: bool,
    pub primary_key: bool,
    pub auto_increment: bool,
    #[serde(default)]
    pub default_value: Option<String>,
    #[serde(default)]
    pub comment: String,
    /// `default_value` is an SQL expression (`uuid()`, `(datetime('now'))`), not a literal.
    #[serde(default)]
    pub default_is_expression: bool,
    /// MySQL `ON UPDATE` expression (`current_timestamp()`), kept on MODIFY.
    #[serde(default)]
    pub on_update: Option<String>,
    /// MySQL column collation, kept on MODIFY.
    #[serde(default)]
    pub collation: Option<String>,
    /// Generated (virtual/stored) column: its expression is not modeled, so it cannot be altered here.
    #[serde(default)]
    pub generated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DesignForeignKey {
    /// Constraint name; generated when empty.
    pub name: String,
    pub columns: Vec<String>,
    pub referenced_table: String,
    pub referenced_columns: Vec<String>,
    #[serde(default)]
    pub on_delete: String,
    #[serde(default)]
    pub on_update: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct DesignTable {
    pub name: String,
    /// Name in the database when the design was loaded; differs from `name` on a rename.
    #[serde(default)]
    pub original_name: Option<String>,
    pub columns: Vec<DesignColumn>,
    #[serde(default)]
    pub foreign_keys: Vec<DesignForeignKey>,
    /// SQLite: `CREATE INDEX` / `CREATE TRIGGER` statements re-created after a table rebuild.
    #[serde(default)]
    pub preserved_sql: Vec<String>,
    /// SQLite: why this table cannot be rebuilt without losing structure (CHECK, UNIQUE…).
    #[serde(default)]
    pub rebuild_blocker: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct DesignedSchema {
    pub tables: Vec<DesignTable>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SchemaMigration {
    pub up: Vec<MigrationStatement>,
    pub down: Vec<MigrationStatement>,
    pub up_sql: String,
    pub down_sql: String,
    pub warnings: Vec<String>,
    pub has_changes: bool,
}

const FK_ACTIONS: [&str; 5] = [
    "RESTRICT",
    "CASCADE",
    "SET NULL",
    "NO ACTION",
    "SET DEFAULT",
];

fn qi(engine: DbEngine, name: &str) -> String {
    match engine {
        DbEngine::Sqlite => format!("\"{}\"", name.replace('"', "\"\"")),
        _ => quote_ident_mysql(name),
    }
}

fn key(name: &str) -> String {
    name.trim().to_ascii_lowercase()
}

fn invalid(message: impl Into<String>) -> PyroError {
    PyroError::InvalidOperation(message.into())
}

// ---------------------------------------------------------------------------
// Loading the physical schema
// ---------------------------------------------------------------------------

fn is_timestamp_keyword(value: &str) -> bool {
    let upper = value.trim().to_ascii_uppercase();
    upper == "NOW()"
        || upper == "CURRENT_TIMESTAMP"
        || upper == "CURRENT_TIME"
        || upper == "CURRENT_DATE"
        || upper == "LOCALTIMESTAMP"
        || upper
            .strip_prefix("CURRENT_TIMESTAMP(")
            .or_else(|| upper.strip_prefix("NOW("))
            .and_then(|rest| rest.strip_suffix(')'))
            .is_some_and(|digits| digits.chars().all(|c| c.is_ascii_digit()))
}

/// Splits a reported default into the plain value and whether it is an expression.
///
/// * MariaDB quotes string literals (`'abc'`) and leaves expressions bare (`uuid()`).
/// * MySQL 8 leaves literals bare and flags expressions with `DEFAULT_GENERATED`.
/// * SQLite reports the default exactly as written in `CREATE TABLE`.
fn parse_default(engine: DbEngine, raw: Option<String>, extra: &str) -> (Option<String>, bool) {
    let Some(value) = raw else {
        return (None, false);
    };
    let trimmed = value.trim();
    if trimmed.eq_ignore_ascii_case("null") {
        return (None, false);
    }
    if trimmed.len() >= 2 && trimmed.starts_with('\'') && trimmed.ends_with('\'') {
        return (
            Some(trimmed[1..trimmed.len() - 1].replace("''", "'")),
            false,
        );
    }
    if trimmed.parse::<f64>().is_ok() {
        return (Some(trimmed.to_string()), false);
    }
    let is_expression = match engine {
        DbEngine::Sqlite => true,
        _ => {
            extra.to_ascii_lowercase().contains("default_generated")
                || is_timestamp_keyword(trimmed)
                || trimmed.ends_with(')')
        }
    };
    (
        Some(if is_expression {
            trimmed.to_string()
        } else {
            value
        }),
        is_expression,
    )
}

/// `ON UPDATE current_timestamp()` from a MySQL `EXTRA` value.
fn parse_on_update(extra: &str) -> Option<String> {
    let lower = extra.to_ascii_lowercase();
    let start = lower.find("on update ")? + "on update ".len();
    let expression: String = extra[start..]
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '(' | ')'))
        .collect();
    (!expression.is_empty()).then_some(expression)
}

fn is_generated_extra(extra: &str) -> bool {
    let lower = extra.to_ascii_lowercase();
    lower.contains("virtual") || lower.contains("stored") || lower.contains("persistent")
}

static SQLITE_REBUILD_BLOCKERS: LazyLock<Vec<(Regex, &'static str)>> = LazyLock::new(|| {
    [
        (r"(?i)\bCHECK\b", "restricciones CHECK"),
        (r"(?i)\bUNIQUE\b", "restricciones UNIQUE"),
        (r"(?i)\bCOLLATE\b", "intercalaciones (COLLATE)"),
        (r"(?i)\bGENERATED\b|\bAS\s*\(", "columnas generadas"),
        (r"(?i)\bWITHOUT\s+ROWID\b", "WITHOUT ROWID"),
    ]
    .into_iter()
    .map(|(pattern, label)| (Regex::new(pattern).expect("valid regex"), label))
    .collect()
});

/// Why recreating a SQLite table from the design model would drop part of its definition.
fn sqlite_rebuild_blocker(table_sql: &str) -> Option<String> {
    let found: Vec<&str> = SQLITE_REBUILD_BLOCKERS
        .iter()
        .filter(|(regex, _)| regex.is_match(table_sql))
        .map(|(_, label)| *label)
        .collect();
    (!found.is_empty()).then(|| found.join(", "))
}

struct SqliteTableExtras {
    table_sql: String,
    preserved_sql: Vec<String>,
}

/// `CREATE TABLE` text plus index and trigger definitions per table (lowercase key).
async fn sqlite_table_extras(
    backend: &dyn DatabaseBackend,
    database: &str,
) -> Result<HashMap<String, SqliteTableExtras>, PyroError> {
    let schema = if database.trim().is_empty() {
        "main"
    } else {
        database.trim()
    };
    let catalog = SQLITE_DIALECT.qualify_table(Some(schema), "sqlite_master")?;
    let sql = format!(
        "SELECT type, tbl_name, sql FROM {catalog} WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type DESC, name"
    );
    let text = |value: Option<&serde_json::Value>| match value {
        Some(serde_json::Value::String(text)) => text.clone(),
        _ => String::new(),
    };
    let mut extras: HashMap<String, SqliteTableExtras> = HashMap::new();
    for row in backend.execute_query(&sql, None).await?.rows {
        let kind = text(row.first());
        let table = key(&text(row.get(1)));
        let definition = text(row.get(2));
        let entry = extras.entry(table).or_insert_with(|| SqliteTableExtras {
            table_sql: String::new(),
            preserved_sql: Vec::new(),
        });
        match kind.as_str() {
            "table" => entry.table_sql = definition,
            "index" | "trigger" => entry.preserved_sql.push(definition),
            _ => {}
        }
    }
    Ok(extras)
}

/// Reads the physical schema of `database` as a design model (views excluded).
pub async fn fetch_design_schema(
    backend: &dyn DatabaseBackend,
    database: &str,
) -> Result<DesignedSchema, PyroError> {
    let engine = backend.engine();
    let schema = introspector(backend);
    let mut sqlite_extras = if engine == DbEngine::Sqlite {
        sqlite_table_extras(backend, database).await?
    } else {
        HashMap::new()
    };
    let mut tables = Vec::new();
    for meta in schema.list_tables(backend, database).await? {
        if meta.table_type.to_ascii_uppercase().contains("VIEW") {
            continue;
        }
        let extras = sqlite_extras.remove(&key(&meta.name));
        // SQLite reports every rowid alias as auto-increment; only AUTOINCREMENT is.
        let has_autoincrement = extras
            .as_ref()
            .is_none_or(|e| e.table_sql.to_ascii_uppercase().contains("AUTOINCREMENT"));
        let columns = schema
            .table_columns(backend, database, &meta.name)
            .await?
            .into_iter()
            .map(|c| {
                let (default_value, default_is_expression) =
                    parse_default(engine, c.column_default, &c.extra);
                let is_mysql = engine != DbEngine::Sqlite;
                DesignColumn {
                    primary_key: c.column_key.eq_ignore_ascii_case("PRI"),
                    auto_increment: c.extra.to_ascii_lowercase().contains("auto_increment")
                        && has_autoincrement,
                    default_value,
                    default_is_expression,
                    on_update: if is_mysql {
                        parse_on_update(&c.extra)
                    } else {
                        None
                    },
                    collation: if is_mysql {
                        c.collation.filter(|v| !v.is_empty())
                    } else {
                        None
                    },
                    generated: is_mysql && is_generated_extra(&c.extra),
                    original_name: Some(c.name.clone()),
                    name: c.name,
                    column_type: c.column_type,
                    nullable: c.is_nullable,
                    comment: c.comment,
                }
            })
            .collect();
        let (preserved_sql, rebuild_blocker) = match extras {
            Some(e) => (e.preserved_sql, sqlite_rebuild_blocker(&e.table_sql)),
            None => (Vec::new(), None),
        };
        tables.push(DesignTable {
            original_name: Some(meta.name.clone()),
            name: meta.name,
            columns,
            foreign_keys: Vec::new(),
            preserved_sql,
            rebuild_blocker,
        });
    }
    tables.sort_by(|a, b| a.name.cmp(&b.name));

    for (table, fks) in schema.foreign_keys(backend, database).await? {
        let Some(target) = tables.iter_mut().find(|t| t.name == table) else {
            continue;
        };
        for fk in fks {
            match target
                .foreign_keys
                .iter_mut()
                .find(|existing| existing.name == fk.name)
            {
                Some(existing) => {
                    existing.columns.push(fk.column_name);
                    existing.referenced_columns.push(fk.referenced_column);
                }
                None => target.foreign_keys.push(DesignForeignKey {
                    name: fk.name,
                    columns: vec![fk.column_name],
                    referenced_table: fk.referenced_table,
                    referenced_columns: vec![fk.referenced_column],
                    on_delete: fk.delete_rule,
                    on_update: fk.update_rule,
                }),
            }
        }
    }
    Ok(DesignedSchema { tables })
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/// A column type as SQL text: letters, digits, `_`, spaces, commas and parentheses,
/// plus quoted values (`enum('sí','no')`) that may hold any character but a backslash.
fn is_safe_column_type(column_type: &str) -> bool {
    let t = column_type.trim();
    if t.is_empty() || t.len() > 2000 {
        return false;
    }
    let mut in_quotes = false;
    for c in t.chars() {
        if in_quotes {
            match c {
                '\'' => in_quotes = false,
                '\\' => return false,
                _ => {}
            }
        } else {
            match c {
                '\'' => in_quotes = true,
                c if c.is_ascii_alphanumeric() || matches!(c, ' ' | ',' | '(' | ')' | '_') => {}
                _ => return false,
            }
        }
    }
    !in_quotes
}

/// Expressions are copied verbatim, so they must stay one SQL fragment.
fn is_safe_expression(expression: &str) -> bool {
    let e = expression.trim();
    !e.is_empty() && e.len() <= 500 && !e.contains(';') && !e.contains("--") && !e.contains("/*")
}

fn is_safe_word(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '(' | ')'))
}

/// MySQL identifiers are limited to 64 characters.
const MAX_IDENTIFIER: usize = 64;

/// `fk_<table>_<columns>`, shortened with a hash suffix and numbered until unused.
fn generated_fk_name(table: &str, columns: &[String], taken: &HashSet<String>) -> String {
    let base = format!("fk_{}_{}", table, columns.join("_"));
    let base = if base.chars().count() > MAX_IDENTIFIER {
        let hash = base
            .bytes()
            .fold(0u32, |h, b| h.wrapping_mul(31).wrapping_add(u32::from(b)));
        let prefix: String = base.chars().take(MAX_IDENTIFIER - 9).collect();
        format!("{prefix}_{hash:08x}")
    } else {
        base
    };
    let mut candidate = base.clone();
    let mut n = 2;
    while taken.contains(&key(&candidate)) {
        let suffix = format!("_{n}");
        let prefix: String = base.chars().take(MAX_IDENTIFIER - suffix.len()).collect();
        candidate = format!("{prefix}{suffix}");
        n += 1;
    }
    candidate
}

fn normalize_action(action: &str) -> Result<String, PyroError> {
    let upper = action.trim().to_ascii_uppercase();
    if upper.is_empty() {
        return Ok("RESTRICT".to_string());
    }
    if FK_ACTIONS.contains(&upper.as_str()) {
        Ok(upper)
    } else {
        Err(invalid(format!(
            "Acción de clave foránea no válida: {action}"
        )))
    }
}

/// Validates the design and fills generated names, so statements are always valid DDL.
fn normalize_design(design: &DesignedSchema) -> Result<DesignedSchema, PyroError> {
    let mut schema = design.clone();
    let mut table_names = HashSet::new();
    for table in &schema.tables {
        if table.name.trim().is_empty() {
            return Err(invalid("Hay una tabla sin nombre."));
        }
        if !table_names.insert(key(&table.name)) {
            return Err(invalid(format!("Tabla duplicada: `{}`.", table.name)));
        }
    }
    let snapshot = schema.clone();
    // Constraint names are unique per database in MySQL: keep the first use of a
    // name and rename later duplicates or empty names.
    let mut fk_names: HashSet<String> = HashSet::new();
    for table in &mut schema.tables {
        if table.columns.is_empty() {
            return Err(invalid(format!(
                "La tabla `{}` necesita al menos una columna.",
                table.name
            )));
        }
        let mut column_names = HashSet::new();
        let mut auto_increment = 0;
        for column in &table.columns {
            if column.name.trim().is_empty() {
                return Err(invalid(format!(
                    "La tabla `{}` tiene una columna sin nombre.",
                    table.name
                )));
            }
            if !column_names.insert(key(&column.name)) {
                return Err(invalid(format!(
                    "Columna duplicada `{}` en `{}`.",
                    column.name, table.name
                )));
            }
            if !is_safe_column_type(&column.column_type) {
                return Err(invalid(format!(
                    "Tipo de dato no válido para `{}.{}`.",
                    table.name, column.name
                )));
            }
            if column.default_is_expression
                && column
                    .default_value
                    .as_deref()
                    .is_some_and(|d| !is_safe_expression(d))
            {
                return Err(invalid(format!(
                    "Valor por defecto no válido para `{}.{}`.",
                    table.name, column.name
                )));
            }
            if column
                .on_update
                .as_deref()
                .is_some_and(|v| !is_safe_word(v))
                || column
                    .collation
                    .as_deref()
                    .is_some_and(|v| !is_safe_word(v))
            {
                return Err(invalid(format!(
                    "Atributos no válidos para `{}.{}`.",
                    table.name, column.name
                )));
            }
            if column.auto_increment {
                auto_increment += 1;
                if !column.primary_key {
                    return Err(invalid(format!(
                        "`{}.{}` es autoincremental y debe ser clave primaria.",
                        table.name, column.name
                    )));
                }
            }
        }
        if auto_increment > 1 {
            return Err(invalid(format!(
                "La tabla `{}` solo admite una columna autoincremental.",
                table.name
            )));
        }

        for fk in &mut table.foreign_keys {
            if fk.columns.is_empty() || fk.columns.len() != fk.referenced_columns.len() {
                return Err(invalid(format!(
                    "Clave foránea incompleta en `{}`.",
                    table.name
                )));
            }
            for column in &fk.columns {
                if !column_names.contains(&key(column)) {
                    return Err(invalid(format!(
                        "La clave foránea usa la columna inexistente `{}.{}`.",
                        table.name, column
                    )));
                }
            }
            let target = snapshot
                .tables
                .iter()
                .find(|t| key(&t.name) == key(&fk.referenced_table))
                .ok_or_else(|| {
                    invalid(format!(
                        "La clave foránea de `{}` apunta a la tabla inexistente `{}`.",
                        table.name, fk.referenced_table
                    ))
                })?;
            for column in &fk.referenced_columns {
                if !target.columns.iter().any(|c| key(&c.name) == key(column)) {
                    return Err(invalid(format!(
                        "La clave foránea apunta a la columna inexistente `{}.{}`.",
                        target.name, column
                    )));
                }
            }
            let name = fk.name.trim();
            if name.is_empty()
                || name.chars().count() > MAX_IDENTIFIER
                || fk_names.contains(&key(name))
            {
                fk.name = generated_fk_name(&table.name, &fk.columns, &fk_names);
            }
            fk_names.insert(key(&fk.name));
            fk.on_delete = normalize_action(&fk.on_delete)?;
            fk.on_update = normalize_action(&fk.on_update)?;
        }
    }
    Ok(schema)
}

// ---------------------------------------------------------------------------
// SQL fragments
// ---------------------------------------------------------------------------

fn default_sql(engine: DbEngine, value: &str, is_expression: bool) -> String {
    let trimmed = value.trim();
    if is_expression {
        let bare = is_timestamp_keyword(trimmed)
            || trimmed.starts_with('(')
            || matches!(
                trimmed.to_ascii_uppercase().as_str(),
                "NULL" | "TRUE" | "FALSE"
            );
        return if bare {
            trimmed.to_string()
        } else {
            format!("({trimmed})")
        };
    }
    if trimmed.eq_ignore_ascii_case("NULL")
        || is_timestamp_keyword(trimmed)
        || trimmed.parse::<f64>().is_ok()
    {
        trimmed.to_string()
    } else {
        match engine {
            DbEngine::Sqlite => sql_string_literal(&SQLITE_DIALECT, trimmed),
            _ => sql_string_literal(&MYSQL_DIALECT, trimmed),
        }
    }
}

fn column_sql(engine: DbEngine, column: &DesignColumn, with_auto_increment: bool) -> String {
    let collation = match (&column.collation, engine) {
        (Some(collation), DbEngine::MySql) => format!(" COLLATE {collation}"),
        _ => String::new(),
    };
    let mut sql = format!(
        "{} {}{} {}",
        qi(engine, &column.name),
        column.column_type.trim(),
        collation,
        if column.nullable { "NULL" } else { "NOT NULL" }
    );
    if with_auto_increment && column.auto_increment {
        if engine == DbEngine::Sqlite {
            sql.push_str(" PRIMARY KEY AUTOINCREMENT");
        } else {
            sql.push_str(" AUTO_INCREMENT");
        }
    } else if let Some(default) = &column.default_value {
        sql.push_str(&format!(
            " DEFAULT {}",
            default_sql(engine, default, column.default_is_expression)
        ));
    }
    if engine != DbEngine::Sqlite {
        if let Some(on_update) = &column.on_update {
            sql.push_str(&format!(" ON UPDATE {on_update}"));
        }
    }
    if engine != DbEngine::Sqlite && !column.comment.is_empty() {
        sql.push_str(&format!(
            " COMMENT {}",
            sql_string_literal(&MYSQL_DIALECT, &column.comment)
        ));
    }
    sql
}

fn name_list(engine: DbEngine, names: &[String]) -> String {
    names
        .iter()
        .map(|n| qi(engine, n))
        .collect::<Vec<_>>()
        .join(", ")
}

fn foreign_key_clause(engine: DbEngine, fk: &DesignForeignKey) -> String {
    let constraint_prefix = if fk.name.trim().is_empty() {
        String::new()
    } else {
        format!("CONSTRAINT {} ", qi(engine, &fk.name))
    };
    format!(
        "{}FOREIGN KEY ({}) REFERENCES {} ({}) ON DELETE {} ON UPDATE {}",
        constraint_prefix,
        name_list(engine, &fk.columns),
        qi(engine, &fk.referenced_table),
        name_list(engine, &fk.referenced_columns),
        fk.on_delete,
        fk.on_update
    )
}

fn primary_key_columns(table: &DesignTable) -> Vec<String> {
    table
        .columns
        .iter()
        .filter(|c| c.primary_key)
        .map(|c| c.name.clone())
        .collect()
}

fn create_table_sql_named(engine: DbEngine, table_name: &str, table: &DesignTable) -> String {
    let has_inline_pk = engine == DbEngine::Sqlite
        && table
            .columns
            .iter()
            .any(|c| c.primary_key && c.auto_increment);
    let mut lines: Vec<String> = table
        .columns
        .iter()
        .map(|c| format!("  {}", column_sql(engine, c, true)))
        .collect();
    let pk = primary_key_columns(table);
    if !pk.is_empty() && !has_inline_pk {
        lines.push(format!("  PRIMARY KEY ({})", name_list(engine, &pk)));
    }
    for fk in &table.foreign_keys {
        lines.push(format!("  {}", foreign_key_clause(engine, fk)));
    }
    if engine == DbEngine::Sqlite {
        format!(
            "CREATE TABLE {} (\n{}\n);",
            qi(engine, table_name),
            lines.join(",\n")
        )
    } else {
        format!(
            "CREATE TABLE {} (\n{}\n) ENGINE=InnoDB;",
            qi(engine, table_name),
            lines.join(",\n")
        )
    }
}

fn create_table_sql(engine: DbEngine, table: &DesignTable) -> String {
    create_table_sql_named(engine, &table.name, table)
}

fn statement(
    sql: String,
    description: String,
    danger_level: DangerLevel,
    is_destructive: bool,
    target: &str,
) -> MigrationStatement {
    MigrationStatement {
        sql,
        description,
        is_destructive,
        danger_level,
        target_object: target.to_string(),
    }
}

// ---------------------------------------------------------------------------
// Dependency ordering
// ---------------------------------------------------------------------------

/// Orders tables so each one comes after the tables its foreign keys reference.
/// Self references are ignored; a longer cycle is an error.
fn creation_order<'a>(tables: &[&'a DesignTable]) -> Result<Vec<&'a DesignTable>, PyroError> {
    let names: HashSet<String> = tables.iter().map(|t| key(&t.name)).collect();
    let mut remaining: Vec<&DesignTable> = tables.to_vec();
    remaining.sort_by_key(|t| key(&t.name));
    let mut done: HashSet<String> = HashSet::new();
    let mut ordered = Vec::with_capacity(remaining.len());

    while !remaining.is_empty() {
        let ready = remaining.iter().position(|table| {
            table.foreign_keys.iter().all(|fk| {
                let dependency = key(&fk.referenced_table);
                dependency == key(&table.name)
                    || !names.contains(&dependency)
                    || done.contains(&dependency)
            })
        });
        match ready {
            Some(index) => {
                let table = remaining.remove(index);
                done.insert(key(&table.name));
                ordered.push(table);
            }
            None => {
                let involved = remaining
                    .iter()
                    .map(|t| format!("`{}`", t.name))
                    .collect::<Vec<_>>()
                    .join(", ");
                return Err(invalid(format!(
                    "Dependencia circular entre tablas ({involved}): ninguna puede crearse antes que las demás."
                )));
            }
        }
    }
    Ok(ordered)
}

// ---------------------------------------------------------------------------
// Data-loss analysis
// ---------------------------------------------------------------------------

#[derive(Debug, PartialEq, Clone, Copy)]
enum TypeFamily {
    Integer,
    Fractional,
    Text,
    Temporal,
    Binary,
    Json,
    Other,
}

fn type_parts(column_type: &str) -> (String, Option<u32>) {
    let lower = column_type.trim().to_ascii_lowercase();
    let base = lower
        .split('(')
        .next()
        .unwrap_or("")
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_string();
    let length = lower
        .split_once('(')
        .and_then(|(_, rest)| rest.split(|c: char| !c.is_ascii_digit()).next())
        .and_then(|digits| digits.parse().ok());
    (base, length)
}

fn type_family(base: &str) -> TypeFamily {
    match base {
        "tinyint" | "smallint" | "mediumint" | "int" | "integer" | "bigint" | "bit" | "bool"
        | "boolean" => TypeFamily::Integer,
        "decimal" | "numeric" | "float" | "double" | "real" => TypeFamily::Fractional,
        "char" | "varchar" | "tinytext" | "text" | "mediumtext" | "longtext" | "enum" | "set" => {
            TypeFamily::Text
        }
        "date" | "datetime" | "timestamp" | "time" | "year" => TypeFamily::Temporal,
        "binary" | "varbinary" | "tinyblob" | "blob" | "mediumblob" | "longblob" => {
            TypeFamily::Binary
        }
        "json" => TypeFamily::Json,
        _ => TypeFamily::Other,
    }
}

fn integer_rank(base: &str) -> u8 {
    match base {
        "tinyint" | "bool" | "boolean" => 1,
        "smallint" => 2,
        "mediumint" => 3,
        "int" | "integer" => 4,
        "bigint" => 5,
        _ => 0,
    }
}

fn text_capacity(base: &str, length: Option<u32>) -> Option<u64> {
    match base {
        "char" | "varchar" => length.map(u64::from),
        "tinytext" => Some(255),
        "text" => Some(65_535),
        "mediumtext" => Some(16_777_215),
        "longtext" => Some(4_294_967_295),
        _ => None,
    }
}

/// Integer display widths (`int(11)`) carry no meaning, so they never count as a change.
fn normalized_type(column_type: &str) -> String {
    let (base, length) = type_parts(column_type);
    if type_family(&base) == TypeFamily::Integer && base != "bit" && base != "tinyint" {
        return base;
    }
    if base == "tinyint" && length != Some(1) {
        return base;
    }
    column_type
        .trim()
        .to_ascii_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Why changing `from` into `to` can lose, truncate or reject existing data.
fn data_loss_risks(from: &DesignColumn, to: &DesignColumn) -> Vec<String> {
    let mut risks = Vec::new();
    let (from_base, from_len) = type_parts(&from.column_type);
    let (to_base, to_len) = type_parts(&to.column_type);
    let from_family = type_family(&from_base);
    let to_family = type_family(&to_base);

    if normalized_type(&from.column_type) != normalized_type(&to.column_type) {
        if from_family == to_family {
            match from_family {
                TypeFamily::Integer if integer_rank(&to_base) < integer_rank(&from_base) => {
                    risks.push(format!(
                        "Reducir `{}` de {} a {} puede desbordar valores existentes.",
                        from.name, from_base, to_base
                    ));
                }
                TypeFamily::Text => {
                    if let (Some(old), Some(new)) = (
                        text_capacity(&from_base, from_len),
                        text_capacity(&to_base, to_len),
                    ) {
                        if new < old {
                            risks.push(format!(
                                "Reducir la capacidad de `{}` ({} → {}) puede truncar datos.",
                                from.name,
                                from.column_type.trim(),
                                to.column_type.trim()
                            ));
                        }
                    }
                }
                TypeFamily::Fractional if from_base != to_base || to_len < from_len => {
                    risks.push(format!(
                        "Cambiar `{}` de {} a {} puede perder precisión.",
                        from.name,
                        from.column_type.trim(),
                        to.column_type.trim()
                    ));
                }
                _ => {}
            }
        } else {
            let widening = matches!(
                (from_family, to_family),
                (TypeFamily::Integer, TypeFamily::Fractional)
                    | (
                        TypeFamily::Integer | TypeFamily::Fractional | TypeFamily::Temporal,
                        TypeFamily::Text
                    )
            );
            if !widening {
                risks.push(format!(
                    "Cambiar `{}` de {} a {} es incompatible y puede fallar o perder datos.",
                    from.name,
                    from.column_type.trim(),
                    to.column_type.trim()
                ));
            }
        }
    }
    if from.nullable && !to.nullable {
        risks.push(format!(
            "`{}` pasará a NOT NULL: fallará si existen filas con NULL.",
            from.name
        ));
    }
    risks
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

fn foreign_keys_equal(a: &DesignForeignKey, b: &DesignForeignKey) -> bool {
    let lower = |names: &[String]| names.iter().map(|n| key(n)).collect::<Vec<_>>();
    lower(&a.columns) == lower(&b.columns)
        && key(&a.referenced_table) == key(&b.referenced_table)
        && lower(&a.referenced_columns) == lower(&b.referenced_columns)
        && a.on_delete.trim().eq_ignore_ascii_case(b.on_delete.trim())
        && a.on_update.trim().eq_ignore_ascii_case(b.on_update.trim())
}

fn columns_equal(a: &DesignColumn, b: &DesignColumn) -> bool {
    normalized_type(&a.column_type) == normalized_type(&b.column_type)
        && a.nullable == b.nullable
        && a.auto_increment == b.auto_increment
        && a.default_value == b.default_value
        && a.default_is_expression == b.default_is_expression
        && a.comment == b.comment
        && a.on_update == b.on_update
        && a.collation.as_deref().map(key) == b.collation.as_deref().map(key)
}

fn key_set(names: &[String]) -> Vec<String> {
    let mut keys: Vec<String> = names.iter().map(|n| key(n)).collect();
    keys.sort();
    keys
}

/// Column, primary key and foreign key changes of one table present on both sides.
fn table_column_ops(
    engine: DbEngine,
    from: &DesignTable,
    to: &DesignTable,
    out: &mut Vec<MigrationStatement>,
    warnings: &mut Vec<String>,
) -> Result<(), PyroError> {
    let table = qi(engine, &to.name);
    let from_columns: HashMap<String, &DesignColumn> =
        from.columns.iter().map(|c| (key(&c.name), c)).collect();
    let to_columns: HashSet<String> = to.columns.iter().map(|c| key(&c.name)).collect();
    let from_pk = primary_key_columns(from);
    let to_pk = primary_key_columns(to);
    let pk_changes = key_set(&from_pk) != key_set(&to_pk);

    // A new auto-increment key on a keyless table is added in one statement so
    // MariaDB numbers the existing rows instead of failing on duplicate zeros.
    let inline_key = if from_pk.is_empty() && to_pk.len() == 1 {
        to.columns.iter().find(|c| {
            c.primary_key && c.auto_increment && !from_columns.contains_key(&key(&c.name))
        })
    } else {
        None
    };

    // 1. New columns (auto-increment is applied once the key exists).
    for (index, column) in to.columns.iter().enumerate() {
        if from_columns.contains_key(&key(&column.name)) {
            continue;
        }
        let position = if index == 0 {
            " FIRST".to_string()
        } else {
            format!(" AFTER {}", qi(engine, &to.columns[index - 1].name))
        };
        let is_inline_key = inline_key.is_some_and(|k| key(&k.name) == key(&column.name));
        let definition = column_sql(engine, column, is_inline_key);
        let suffix = if is_inline_key { " PRIMARY KEY" } else { "" };
        out.push(statement(
            format!("ALTER TABLE {table} ADD COLUMN {definition}{suffix}{position};"),
            format!("Agregar columna `{}` en `{}`", column.name, to.name),
            DangerLevel::Safe,
            false,
            &to.name,
        ));
    }

    // 2. Columns that lose auto-increment must do so before the key changes.
    let mut early: HashSet<String> = HashSet::new();
    if pk_changes {
        for column in &to.columns {
            if let Some(old) = from_columns.get(&key(&column.name)) {
                if old.auto_increment && !column.auto_increment {
                    early.insert(key(&column.name));
                    out.push(statement(
                        format!(
                            "ALTER TABLE {table} MODIFY COLUMN {};",
                            column_sql(engine, column, true)
                        ),
                        format!(
                            "Quitar autoincremento de `{}` en `{}`",
                            column.name, to.name
                        ),
                        DangerLevel::Medium,
                        false,
                        &to.name,
                    ));
                }
            }
        }
    }

    // 3. Primary key.
    if pk_changes && inline_key.is_none() {
        let sql = match (from_pk.is_empty(), to_pk.is_empty()) {
            (true, _) => format!(
                "ALTER TABLE {table} ADD PRIMARY KEY ({});",
                name_list(engine, &to_pk)
            ),
            (false, true) => format!("ALTER TABLE {table} DROP PRIMARY KEY;"),
            (false, false) => format!(
                "ALTER TABLE {table} DROP PRIMARY KEY, ADD PRIMARY KEY ({});",
                name_list(engine, &to_pk)
            ),
        };
        if from_pk.is_empty() {
            warnings.push(format!(
                "`{}` recibirá una clave primaria: fallará si hay valores duplicados o NULL.",
                to.name
            ));
        }
        out.push(statement(
            sql,
            format!("Cambiar la clave primaria de `{}`", to.name),
            DangerLevel::Medium,
            false,
            &to.name,
        ));
    }

    // 4. Modified columns (and new ones that still need auto-increment).
    for column in &to.columns {
        let column_key = key(&column.name);
        if early.contains(&column_key) {
            continue;
        }
        let changed = match from_columns.get(&column_key) {
            Some(old) if old.generated && !columns_equal(old, column) => {
                return Err(invalid(format!(
                    "`{}.{}` es una columna generada: modifícala desde el editor de estructura, no desde el diseñador.",
                    to.name, column.name
                )));
            }
            Some(old) => !columns_equal(old, column),
            None => {
                column.auto_increment && !inline_key.is_some_and(|k| key(&k.name) == column_key)
            }
        };
        if !changed {
            continue;
        }
        let risks = from_columns
            .get(&column_key)
            .map(|old| data_loss_risks(old, column))
            .unwrap_or_default();
        let risky = !risks.is_empty();
        for risk in risks {
            warnings.push(format!("{}: {}", to.name, risk));
        }
        out.push(statement(
            format!(
                "ALTER TABLE {table} MODIFY COLUMN {};",
                column_sql(engine, column, true)
            ),
            format!("Modificar columna `{}` en `{}`", column.name, to.name),
            if risky {
                DangerLevel::Critical
            } else {
                DangerLevel::Medium
            },
            risky,
            &to.name,
        ));
    }

    // 5. Dropped columns.
    for column in &from.columns {
        if to_columns.contains(&key(&column.name)) {
            continue;
        }
        warnings.push(format!(
            "Se eliminará la columna `{}.{}` junto con todos sus datos.",
            from.name, column.name
        ));
        out.push(statement(
            format!(
                "ALTER TABLE {table} DROP COLUMN {};",
                qi(engine, &column.name)
            ),
            format!(
                "Eliminar columna `{}` en `{}` (¡PÉRDIDA DE DATOS!)",
                column.name, from.name
            ),
            DangerLevel::Critical,
            true,
            &from.name,
        ));
    }
    Ok(())
}

/// Whether `sql` mentions identifier `name` as a whole word (quoted or bare).
fn mentions_identifier(sql: &str, name: &str) -> bool {
    let sql = sql.to_ascii_lowercase();
    let name = key(name);
    if name.is_empty() {
        return false;
    }
    let is_ident = |c: char| c.is_ascii_alphanumeric() || c == '_';
    sql.match_indices(&name).any(|(start, _)| {
        let before = sql[..start].chars().next_back();
        let after = sql[start + name.len()..].chars().next();
        !before.is_some_and(is_ident) && !after.is_some_and(is_ident)
    })
}

fn source_name(original: &Option<String>, name: &str) -> String {
    key(original.as_deref().unwrap_or(name))
}

/// Emits RENAME statements for tables and columns renamed in the design and
/// returns `from` with those names applied, so the rest of the diff sees no
/// drop + create (which would lose the data) for a plain rename.
fn apply_renames(
    engine: DbEngine,
    from: &DesignedSchema,
    to: &DesignedSchema,
) -> Result<(DesignedSchema, Vec<MigrationStatement>), PyroError> {
    let mut renamed = from.clone();
    let mut statements = Vec::new();

    for target in &to.tables {
        let source = source_name(&target.original_name, &target.name);
        if source == key(&target.name) {
            continue;
        }
        let Some(index) = renamed.tables.iter().position(|t| key(&t.name) == source) else {
            continue;
        };
        if renamed
            .tables
            .iter()
            .any(|t| key(&t.name) == key(&target.name))
        {
            return Err(invalid(format!(
                "No se puede renombrar a `{}`: ya existe una tabla con ese nombre.",
                target.name
            )));
        }
        let old_name = renamed.tables[index].name.clone();
        let sql = match engine {
            DbEngine::Sqlite => format!(
                "ALTER TABLE {} RENAME TO {};",
                qi(engine, &old_name),
                qi(engine, &target.name)
            ),
            _ => format!(
                "RENAME TABLE {} TO {};",
                qi(engine, &old_name),
                qi(engine, &target.name)
            ),
        };
        statements.push(statement(
            sql,
            format!("Renombrar tabla `{}` a `{}`", old_name, target.name),
            DangerLevel::Medium,
            false,
            &target.name,
        ));
        renamed.tables[index].name = target.name.clone();
        if !renamed.tables[index].preserved_sql.is_empty() {
            renamed.tables[index].rebuild_blocker.get_or_insert_with(|| {
                "sus índices o triggers usan el nombre anterior; aplica primero el renombre por separado"
                    .to_string()
            });
        }
        for table in &mut renamed.tables {
            for fk in &mut table.foreign_keys {
                if key(&fk.referenced_table) == source {
                    fk.referenced_table = target.name.clone();
                }
            }
        }
    }

    for target in &to.tables {
        let Some(index) = renamed
            .tables
            .iter()
            .position(|t| key(&t.name) == key(&target.name))
        else {
            continue;
        };
        for column in &target.columns {
            let source = source_name(&column.original_name, &column.name);
            if source == key(&column.name) {
                continue;
            }
            let table = &renamed.tables[index];
            let Some(col_index) = table.columns.iter().position(|c| key(&c.name) == source) else {
                continue;
            };
            if table
                .columns
                .iter()
                .any(|c| key(&c.name) == key(&column.name))
            {
                return Err(invalid(format!(
                    "No se puede renombrar a `{}.{}`: la columna ya existe.",
                    target.name, column.name
                )));
            }
            let old = table.columns[col_index].clone();
            if old.generated {
                return Err(invalid(format!(
                    "`{}.{}` es una columna generada: renómbrala desde el editor de estructura.",
                    target.name, old.name
                )));
            }
            let table_sql = qi(engine, &table.name);
            let sql = match engine {
                DbEngine::Sqlite => format!(
                    "ALTER TABLE {table_sql} RENAME COLUMN {} TO {};",
                    qi(engine, &old.name),
                    qi(engine, &column.name)
                ),
                // CHANGE keeps the old definition and works on every MariaDB/MySQL version.
                _ => {
                    let mut definition = old.clone();
                    definition.name = column.name.clone();
                    format!(
                        "ALTER TABLE {table_sql} CHANGE COLUMN {} {};",
                        qi(engine, &old.name),
                        column_sql(engine, &definition, true)
                    )
                }
            };
            statements.push(statement(
                sql,
                format!(
                    "Renombrar columna `{}` a `{}` en `{}`",
                    old.name, column.name, target.name
                ),
                DangerLevel::Medium,
                false,
                &target.name,
            ));
            let table_name = table.name.clone();
            let table = &mut renamed.tables[index];
            table.columns[col_index].name = column.name.clone();
            // SQLite updates its indexes and triggers on rename, but the saved
            // definitions still use the old name and cannot be replayed after a rebuild.
            if table
                .preserved_sql
                .iter()
                .any(|sql| mentions_identifier(sql, &old.name))
            {
                table.rebuild_blocker.get_or_insert_with(|| {
                    format!(
                        "la columna renombrada `{}` aparece en índices o triggers; aplica primero el renombre por separado",
                        old.name
                    )
                });
            }
            for fk in &mut table.foreign_keys {
                for c in &mut fk.columns {
                    if key(c) == source {
                        *c = column.name.clone();
                    }
                }
            }
            for other in &mut renamed.tables {
                for fk in &mut other.foreign_keys {
                    if key(&fk.referenced_table) == key(&table_name) {
                        for c in &mut fk.referenced_columns {
                            if key(c) == source {
                                *c = column.name.clone();
                            }
                        }
                    }
                }
            }
        }
    }
    Ok((renamed, statements))
}

/// Statements that turn schema `from` into schema `to`.
fn diff_schemas(
    engine: DbEngine,
    from: &DesignedSchema,
    to: &DesignedSchema,
) -> Result<(Vec<MigrationStatement>, Vec<String>), PyroError> {
    let (renamed_from, mut statements) = apply_renames(engine, from, to)?;
    let from = &renamed_from;
    let mut warnings = Vec::new();

    let from_tables: BTreeMap<String, &DesignTable> =
        from.tables.iter().map(|t| (key(&t.name), t)).collect();
    let to_tables: BTreeMap<String, &DesignTable> =
        to.tables.iter().map(|t| (key(&t.name), t)).collect();

    let dropped: Vec<&DesignTable> = from_tables
        .iter()
        .filter(|(k, _)| !to_tables.contains_key(*k))
        .map(|(_, t)| *t)
        .collect();
    let created: Vec<&DesignTable> = to_tables
        .iter()
        .filter(|(k, _)| !from_tables.contains_key(*k))
        .map(|(_, t)| *t)
        .collect();
    let common: Vec<(&DesignTable, &DesignTable)> = to_tables
        .iter()
        .filter_map(|(k, t)| from_tables.get(k).map(|old| (*old, *t)))
        .collect();

    // -----------------------------------------------------------------------
    // SQLite Engine: Table Rebuild for modified tables
    // -----------------------------------------------------------------------
    if engine == DbEngine::Sqlite {
        let mut modified_tables: Vec<(&DesignTable, &DesignTable)> = Vec::new();
        for (old, new) in &common {
            let cols_changed = old.columns.len() != new.columns.len()
                || old
                    .columns
                    .iter()
                    .zip(&new.columns)
                    .any(|(a, b)| !columns_equal(a, b) || key(&a.name) != key(&b.name));
            let pk_changed =
                key_set(&primary_key_columns(old)) != key_set(&primary_key_columns(new));
            let fks_changed = old.foreign_keys.len() != new.foreign_keys.len()
                || old.foreign_keys.iter().any(|ofk| {
                    !new.foreign_keys
                        .iter()
                        .any(|nfk| foreign_keys_equal(ofk, nfk))
                });
            if cols_changed || pk_changed || fks_changed {
                modified_tables.push((*old, *new));
            }
        }

        let has_rebuilds = !modified_tables.is_empty();

        if has_rebuilds {
            statements.push(statement(
                "PRAGMA foreign_keys = OFF;".to_string(),
                "Desactivar temporalmente claves foráneas para recreación segura de tablas"
                    .to_string(),
                DangerLevel::Safe,
                false,
                "database",
            ));
        }

        // Dropped tables, dependents first.
        let mut drop_order = creation_order(&dropped)?;
        drop_order.reverse();
        for table in drop_order {
            warnings.push(format!(
                "Se eliminará la tabla `{}` junto con todos sus datos.",
                table.name
            ));
            statements.push(statement(
                format!("DROP TABLE {};", qi(engine, &table.name)),
                format!("Eliminar tabla `{}` (¡PÉRDIDA DE DATOS!)", table.name),
                DangerLevel::Critical,
                true,
                &table.name,
            ));
        }

        // Created tables, dependencies first.
        for table in creation_order(&created)? {
            statements.push(statement(
                create_table_sql(engine, table),
                format!("Crear tabla `{}`", table.name),
                DangerLevel::Safe,
                false,
                &table.name,
            ));
        }

        // Modified tables: Table Rebuild
        for (old, new) in modified_tables {
            if let Some(blocker) = &old.rebuild_blocker {
                return Err(invalid(format!(
                    "La tabla `{}` no puede recrearse sin perder parte de su definición ({blocker}). Haz ese cambio desde el editor de estructura.",
                    old.name
                )));
            }
            let from_columns: HashMap<String, &DesignColumn> =
                old.columns.iter().map(|c| (key(&c.name), c)).collect();
            let to_columns: HashSet<String> = new.columns.iter().map(|c| key(&c.name)).collect();

            for col in &new.columns {
                if let Some(old_col) = from_columns.get(&key(&col.name)) {
                    for risk in data_loss_risks(old_col, col) {
                        warnings.push(format!("{}: {}", new.name, risk));
                    }
                }
            }
            for old_col in &old.columns {
                if !to_columns.contains(&key(&old_col.name)) {
                    warnings.push(format!(
                        "Se eliminará la columna `{}.{}` junto con todos sus datos.",
                        old.name, old_col.name
                    ));
                }
            }

            let temp_name = format!("pyro_rebuild_{}", new.name);
            // A previous run that stopped half-way may have left the copy behind.
            statements.push(statement(
                format!("DROP TABLE IF EXISTS {};", qi(engine, &temp_name)),
                format!(
                    "Eliminar restos de una recreación anterior de `{}`",
                    new.name
                ),
                DangerLevel::Safe,
                false,
                &new.name,
            ));
            for column in &new.columns {
                let is_new = !from_columns.contains_key(&key(&column.name));
                if is_new
                    && !column.nullable
                    && column.default_value.is_none()
                    && !column.auto_increment
                {
                    warnings.push(format!(
                        "{}: la nueva columna `{}` es NOT NULL sin valor por defecto; la copia fallará si la tabla tiene filas.",
                        new.name, column.name
                    ));
                }
            }
            statements.push(statement(
                create_table_sql_named(engine, &temp_name, new),
                format!(
                    "Crear tabla temporal `{}` con la nueva estructura",
                    temp_name
                ),
                DangerLevel::Safe,
                false,
                &new.name,
            ));

            let common_cols: Vec<String> = new
                .columns
                .iter()
                .filter(|c| from_columns.contains_key(&key(&c.name)))
                .map(|c| c.name.clone())
                .collect();

            if !common_cols.is_empty() {
                let cols_list = name_list(engine, &common_cols);
                statements.push(statement(
                    format!(
                        "INSERT INTO {} ({}) SELECT {} FROM {};",
                        qi(engine, &temp_name),
                        cols_list,
                        cols_list,
                        qi(engine, &old.name)
                    ),
                    format!(
                        "Copiar datos de columnas comunes de `{}` a `{}`",
                        old.name, temp_name
                    ),
                    DangerLevel::Safe,
                    false,
                    &new.name,
                ));
            }

            statements.push(statement(
                format!("DROP TABLE {};", qi(engine, &old.name)),
                format!("Eliminar tabla anterior `{}` tras migrar datos", old.name),
                DangerLevel::Critical,
                true,
                &old.name,
            ));

            statements.push(statement(
                format!(
                    "ALTER TABLE {} RENAME TO {};",
                    qi(engine, &temp_name),
                    qi(engine, &new.name)
                ),
                format!("Renombrar `{}` a `{}`", temp_name, new.name),
                DangerLevel::Safe,
                false,
                &new.name,
            ));

            // DROP TABLE removed the old indexes and triggers: re-create them.
            let dropped_columns: Vec<&String> = old
                .columns
                .iter()
                .map(|c| &c.name)
                .filter(|name| !to_columns.contains(&key(name)))
                .collect();
            for sql in &old.preserved_sql {
                if let Some(column) = dropped_columns.iter().find(|c| mentions_identifier(sql, c)) {
                    warnings.push(format!(
                        "{}: se omitirá un índice o trigger que usa la columna eliminada `{}`.",
                        new.name, column
                    ));
                    continue;
                }
                let sql = sql.trim().trim_end_matches(';');
                statements.push(statement(
                    format!("{sql};"),
                    format!("Recrear índice o trigger de `{}`", new.name),
                    DangerLevel::Safe,
                    false,
                    &new.name,
                ));
            }
        }

        if has_rebuilds {
            statements.push(statement(
                "PRAGMA foreign_key_check;".to_string(),
                "Verificar integridad referencial tras migraciones".to_string(),
                DangerLevel::Safe,
                false,
                "database",
            ));
            statements.push(statement(
                "PRAGMA foreign_keys = ON;".to_string(),
                "Reactivar claves foráneas".to_string(),
                DangerLevel::Safe,
                false,
                "database",
            ));
        }

        return Ok((statements, warnings));
    }

    // -----------------------------------------------------------------------
    // MySQL / MariaDB Engine: Direct ALTER statements
    // -----------------------------------------------------------------------

    // Columns whose type or collation changes. MySQL refuses to alter a column
    // that a foreign key uses (on either side), so those keys are dropped first
    // and added back afterwards.
    let mut retyped: HashSet<(String, String)> = HashSet::new();
    for (old, new) in &common {
        for column in &new.columns {
            if let Some(previous) = old
                .columns
                .iter()
                .find(|c| key(&c.name) == key(&column.name))
            {
                let collation_changed =
                    previous.collation.as_deref().map(key) != column.collation.as_deref().map(key);
                if normalized_type(&previous.column_type) != normalized_type(&column.column_type)
                    || collation_changed
                {
                    retyped.insert((key(&new.name), key(&column.name)));
                }
            }
        }
    }
    let uses_retyped = |table: &str, fk: &DesignForeignKey| {
        fk.columns
            .iter()
            .any(|c| retyped.contains(&(key(table), key(c))))
            || fk
                .referenced_columns
                .iter()
                .any(|c| retyped.contains(&(key(&fk.referenced_table), key(c))))
    };

    // A. Foreign keys that disappear or change on tables that stay.
    for (old, new) in &common {
        for fk in &old.foreign_keys {
            let kept = !uses_retyped(&old.name, fk)
                && new
                    .foreign_keys
                    .iter()
                    .any(|n| key(&n.name) == key(&fk.name) && foreign_keys_equal(n, fk));
            if !kept {
                statements.push(statement(
                    format!(
                        "ALTER TABLE {} DROP FOREIGN KEY {};",
                        qi(engine, &old.name),
                        qi(engine, &fk.name)
                    ),
                    format!("Eliminar clave foránea `{}` en `{}`", fk.name, old.name),
                    DangerLevel::Medium,
                    false,
                    &old.name,
                ));
            }
        }
    }

    // B. Dropped tables, dependents first.
    let mut drop_order = creation_order(&dropped)?;
    drop_order.reverse();
    for table in drop_order {
        warnings.push(format!(
            "Se eliminará la tabla `{}` junto con todos sus datos.",
            table.name
        ));
        statements.push(statement(
            format!("DROP TABLE {};", qi(engine, &table.name)),
            format!("Eliminar tabla `{}` (¡PÉRDIDA DE DATOS!)", table.name),
            DangerLevel::Critical,
            true,
            &table.name,
        ));
    }

    // C. Columns and keys of tables that stay (before new tables, whose
    //    foreign keys may point at columns added here).
    for (old, new) in &common {
        table_column_ops(engine, old, new, &mut statements, &mut warnings)?;
    }

    // D. New tables, dependencies first.
    for table in creation_order(&created)? {
        statements.push(statement(
            create_table_sql(engine, table),
            format!("Crear tabla `{}`", table.name),
            DangerLevel::Safe,
            false,
            &table.name,
        ));
    }

    // E. Foreign keys that appear or change on tables that stay.
    for (old, new) in &common {
        for fk in &new.foreign_keys {
            let existing = !uses_retyped(&new.name, fk)
                && old
                    .foreign_keys
                    .iter()
                    .any(|o| key(&o.name) == key(&fk.name) && foreign_keys_equal(o, fk));
            if !existing {
                statements.push(statement(
                    format!(
                        "ALTER TABLE {} ADD {};",
                        qi(engine, &new.name),
                        foreign_key_clause(engine, fk)
                    ),
                    format!("Agregar clave foránea `{}` en `{}`", fk.name, new.name),
                    DangerLevel::Safe,
                    false,
                    &new.name,
                ));
            }
        }
    }

    Ok((statements, warnings))
}

fn render_script(title: &str, database: &str, statements: &[MigrationStatement]) -> String {
    let mut sql = format!(
        "-- ----------------------------------------------------------------------------\n-- {title} generado por el Diseñador de esquemas de PyroStudio\n-- Base de datos: {database}\n-- ----------------------------------------------------------------------------\n\n"
    );
    for stmt in statements {
        sql.push_str(&format!("-- {}\n{}\n\n", stmt.description, stmt.sql));
    }
    sql
}

/// Schemas for the DOWN diff: `desired` keeps the SQLite extras of the tables it
/// came from, and `current` points back at the names `desired` gave them, so a
/// rename is undone by another rename instead of drop + create.
fn reverse_for_down(
    current: &DesignedSchema,
    desired: &DesignedSchema,
) -> (DesignedSchema, DesignedSchema) {
    let mut from = desired.clone();
    let mut to = current.clone();
    for table in &mut to.tables {
        table.original_name = None;
        for column in &mut table.columns {
            column.original_name = None;
        }
    }
    for designed in &mut from.tables {
        let source = source_name(&designed.original_name, &designed.name);
        let Some(original) = to.tables.iter_mut().find(|t| key(&t.name) == source) else {
            continue;
        };
        designed.preserved_sql = original.preserved_sql.clone();
        designed.rebuild_blocker = original.rebuild_blocker.clone();
        if source != key(&designed.name) {
            original.original_name = Some(designed.name.clone());
        }
        for column in &designed.columns {
            let column_source = source_name(&column.original_name, &column.name);
            if column_source == key(&column.name) {
                continue;
            }
            if let Some(original_column) = original
                .columns
                .iter_mut()
                .find(|c| key(&c.name) == column_source)
            {
                original_column.original_name = Some(column.name.clone());
            }
        }
    }
    (from, to)
}

/// Builds the reversible migration that turns `current` into `desired`.
pub fn build_migration(
    database: &str,
    engine: DbEngine,
    current: &DesignedSchema,
    desired: &DesignedSchema,
) -> Result<SchemaMigration, PyroError> {
    let desired = normalize_design(desired)?;
    let (up, mut warnings) = diff_schemas(engine, current, &desired)?;
    let (down_from, down_to) = reverse_for_down(current, &desired);
    let (down, down_dropped) = match diff_schemas(engine, &down_from, &down_to) {
        Ok((statements, down_warnings)) => (
            statements,
            down_warnings.iter().any(|w| w.starts_with("Se eliminará")),
        ),
        Err(error) => {
            warnings.push(format!("No se pudo generar el script DOWN: {error}"));
            (Vec::new(), false)
        }
    };
    if down_dropped || up.iter().any(|s| s.is_destructive) {
        warnings.push(
            "El script DOWN restaura la estructura, pero no los datos eliminados por UP."
                .to_string(),
        );
    }
    let up_sql = render_script("Script UP", database, &up);
    let down_sql = render_script("Script DOWN", database, &down);
    Ok(SchemaMigration {
        has_changes: !up.is_empty(),
        up,
        down,
        up_sql,
        down_sql,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn col(name: &str, column_type: &str) -> DesignColumn {
        DesignColumn {
            name: name.into(),
            column_type: column_type.into(),
            nullable: true,
            primary_key: false,
            auto_increment: false,
            ..Default::default()
        }
    }

    fn id_col() -> DesignColumn {
        DesignColumn {
            nullable: false,
            primary_key: true,
            auto_increment: true,
            ..col("id", "bigint")
        }
    }

    fn fk(name: &str, column: &str, table: &str) -> DesignForeignKey {
        DesignForeignKey {
            name: name.into(),
            columns: vec![column.into()],
            referenced_table: table.into(),
            referenced_columns: vec!["id".into()],
            on_delete: "CASCADE".into(),
            on_update: "RESTRICT".into(),
        }
    }

    fn table(name: &str, columns: Vec<DesignColumn>, fks: Vec<DesignForeignKey>) -> DesignTable {
        DesignTable {
            name: name.into(),
            columns,
            foreign_keys: fks,
            ..Default::default()
        }
    }

    fn schema(tables: Vec<DesignTable>) -> DesignedSchema {
        DesignedSchema { tables }
    }

    fn shop() -> DesignedSchema {
        // Declared in reverse dependency order on purpose.
        schema(vec![
            table(
                "items",
                vec![id_col(), col("order_id", "bigint")],
                vec![fk("fk_items_order", "order_id", "orders")],
            ),
            table(
                "orders",
                vec![id_col(), col("customer_id", "bigint")],
                vec![fk("fk_orders_customer", "customer_id", "customers")],
            ),
            table(
                "customers",
                vec![id_col(), col("name", "varchar(100)")],
                vec![],
            ),
        ])
    }

    fn position(statements: &[MigrationStatement], needle: &str) -> usize {
        statements
            .iter()
            .position(|s| s.sql.contains(needle))
            .unwrap_or_else(|| panic!("no statement contains {needle}"))
    }

    #[test]
    fn creates_tables_in_dependency_order_and_drops_them_in_reverse() {
        let migration =
            build_migration("shop", DbEngine::MySql, &DesignedSchema::default(), &shop()).unwrap();

        let customers = position(&migration.up, "CREATE TABLE `customers`");
        let orders = position(&migration.up, "CREATE TABLE `orders`");
        let items = position(&migration.up, "CREATE TABLE `items`");
        assert!(customers < orders && orders < items);
        assert!(migration.up[orders]
            .sql
            .contains("CONSTRAINT `fk_orders_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT"));
        assert!(migration.up[customers].sql.contains("PRIMARY KEY (`id`)"));
        assert!(migration.up[customers]
            .sql
            .contains("`id` bigint NOT NULL AUTO_INCREMENT"));

        // DOWN is symmetric: dependents are dropped before what they reference.
        let drop_items = position(&migration.down, "DROP TABLE `items`");
        let drop_orders = position(&migration.down, "DROP TABLE `orders`");
        let drop_customers = position(&migration.down, "DROP TABLE `customers`");
        assert!(drop_items < drop_orders && drop_orders < drop_customers);
        assert!(migration.down.iter().all(|s| s.is_destructive));
    }

    #[test]
    fn rejects_circular_dependencies() {
        let circular = schema(vec![
            table(
                "a",
                vec![id_col(), col("b_id", "bigint")],
                vec![fk("fk_a_b", "b_id", "b")],
            ),
            table(
                "b",
                vec![id_col(), col("a_id", "bigint")],
                vec![fk("fk_b_a", "a_id", "a")],
            ),
        ]);
        let error = build_migration("db", DbEngine::MySql, &DesignedSchema::default(), &circular)
            .unwrap_err();
        assert!(error.to_string().contains("circular"), "{error}");
    }

    #[test]
    fn self_references_are_allowed() {
        let tree = schema(vec![table(
            "category",
            vec![id_col(), col("parent_id", "bigint")],
            vec![fk("fk_category_parent", "parent_id", "category")],
        )]);
        let migration =
            build_migration("db", DbEngine::MySql, &DesignedSchema::default(), &tree).unwrap();
        assert_eq!(migration.up.len(), 1);
    }

    #[test]
    fn no_changes_produce_no_statements() {
        let migration = build_migration("shop", DbEngine::MySql, &shop(), &shop()).unwrap();
        assert!(!migration.has_changes);
        assert!(migration.up.is_empty() && migration.down.is_empty());
    }

    #[test]
    fn down_reverts_a_column_change() {
        let before = schema(vec![table(
            "t",
            vec![id_col(), col("name", "varchar(50)")],
            vec![],
        )]);
        let after = schema(vec![table(
            "t",
            vec![id_col(), col("name", "varchar(50)"), col("note", "text")],
            vec![],
        )]);
        let migration = build_migration("db", DbEngine::MySql, &before, &after).unwrap();
        assert!(migration.up[0]
            .sql
            .contains("ADD COLUMN `note` text NULL AFTER `name`"));
        assert!(migration.down[0].sql.contains("DROP COLUMN `note`"));
        assert!(migration.down[0].is_destructive);
    }

    #[test]
    fn adding_an_auto_increment_key_to_a_keyless_table_is_one_statement() {
        let before = schema(vec![table("t", vec![col("name", "varchar(50)")], vec![])]);
        let after = schema(vec![table(
            "t",
            vec![id_col(), col("name", "varchar(50)")],
            vec![],
        )]);
        let migration = build_migration("db", DbEngine::MySql, &before, &after).unwrap();
        assert_eq!(migration.up.len(), 1);
        assert_eq!(
            migration.up[0].sql,
            "ALTER TABLE `t` ADD COLUMN `id` bigint NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST;"
        );
    }

    #[test]
    fn changing_the_primary_key_drops_auto_increment_first() {
        let before = schema(vec![table(
            "t",
            vec![id_col(), col("code", "varchar(20)")],
            vec![],
        )]);
        let mut plain_id = id_col();
        plain_id.auto_increment = false;
        plain_id.primary_key = false;
        let mut code = col("code", "varchar(20)");
        code.nullable = false;
        code.primary_key = true;
        let after = schema(vec![table("t", vec![plain_id, code], vec![])]);

        let migration = build_migration("db", DbEngine::MySql, &before, &after).unwrap();
        let lose_ai = position(&migration.up, "MODIFY COLUMN `id` bigint NOT NULL");
        let change_pk = position(&migration.up, "DROP PRIMARY KEY, ADD PRIMARY KEY (`code`)");
        assert!(lose_ai < change_pk);
    }

    #[test]
    fn warns_about_data_loss() {
        let before = schema(vec![
            table(
                "t",
                vec![
                    id_col(),
                    col("name", "varchar(100)"),
                    col("qty", "bigint"),
                    col("txt", "varchar(10)"),
                ],
                vec![],
            ),
            table("gone", vec![id_col()], vec![]),
        ]);
        let mut required = col("name", "varchar(50)");
        required.nullable = false;
        let after = schema(vec![table(
            "t",
            vec![id_col(), required, col("qty", "int"), col("txt", "int")],
            vec![],
        )]);

        let migration = build_migration("db", DbEngine::MySql, &before, &after).unwrap();
        let all = migration.warnings.join("\n");
        assert!(all.contains("truncar"), "{all}");
        assert!(all.contains("NOT NULL"), "{all}");
        assert!(all.contains("desbordar"), "{all}");
        assert!(all.contains("incompatible"), "{all}");
        assert!(all.contains("tabla `gone`"), "{all}");
        let drop = &migration.up[position(&migration.up, "DROP TABLE `gone`")];
        assert!(drop.is_destructive);
        assert_eq!(drop.danger_level, DangerLevel::Critical);
    }

    #[test]
    fn widening_a_type_is_not_flagged() {
        let before = schema(vec![table(
            "t",
            vec![id_col(), col("name", "varchar(50)"), col("n", "int")],
            vec![],
        )]);
        let after = schema(vec![table(
            "t",
            vec![id_col(), col("name", "varchar(200)"), col("n", "bigint")],
            vec![],
        )]);
        let migration = build_migration("db", DbEngine::MySql, &before, &after).unwrap();
        assert!(migration.warnings.is_empty(), "{:?}", migration.warnings);
        assert!(migration.up.iter().all(|s| !s.is_destructive));
    }

    #[test]
    fn integer_display_width_is_not_a_change() {
        let before = schema(vec![table("t", vec![col("n", "int(11)")], vec![])]);
        let after = schema(vec![table("t", vec![col("n", "int")], vec![])]);
        assert!(
            !build_migration("db", DbEngine::MySql, &before, &after)
                .unwrap()
                .has_changes
        );
    }

    #[test]
    fn foreign_key_changes_drop_then_add() {
        let before = schema(vec![
            table("p", vec![id_col()], vec![]),
            table(
                "c",
                vec![id_col(), col("p_id", "bigint")],
                vec![fk("fk_c_p", "p_id", "p")],
            ),
        ]);
        let mut changed = fk("fk_c_p", "p_id", "p");
        changed.on_delete = "set null".into();
        let after = schema(vec![
            table("p", vec![id_col()], vec![]),
            table("c", vec![id_col(), col("p_id", "bigint")], vec![changed]),
        ]);
        let migration = build_migration("db", DbEngine::MySql, &before, &after).unwrap();
        let drop = position(&migration.up, "DROP FOREIGN KEY `fk_c_p`");
        let add = position(&migration.up, "ADD CONSTRAINT `fk_c_p`");
        assert!(drop < add);
        assert!(migration.up[add].sql.contains("ON DELETE SET NULL"));
    }

    #[test]
    fn rejects_invalid_designs() {
        let go = |tables: Vec<DesignTable>| {
            build_migration(
                "db",
                DbEngine::MySql,
                &DesignedSchema::default(),
                &schema(tables),
            )
            .unwrap_err()
            .to_string()
        };
        assert!(go(vec![table(
            "t",
            vec![col("a", "int); DROP TABLE x; --")],
            vec![]
        )])
        .contains("Tipo de dato no válido"));
        let mut ai = col("a", "int");
        ai.auto_increment = true;
        assert!(go(vec![table("t", vec![ai], vec![])]).contains("clave primaria"));
        assert!(go(vec![table(
            "t",
            vec![id_col(), col("x", "int")],
            vec![fk("fk", "x", "missing")]
        )])
        .contains("inexistente"));
        assert!(go(vec![table("t", vec![id_col(), id_col()], vec![])]).contains("duplicada"));
        let mut bad_action = fk("fk", "x", "t");
        bad_action.on_delete = "DROP EVERYTHING".into();
        assert!(go(vec![table(
            "t",
            vec![id_col(), col("x", "bigint")],
            vec![bad_action]
        )])
        .contains("no válida"));
    }

    #[test]
    fn defaults_are_quoted_unless_they_are_expressions() {
        assert_eq!(default_sql(DbEngine::MySql, "42", false), "42");
        assert_eq!(
            default_sql(DbEngine::MySql, "current_timestamp", false),
            "current_timestamp"
        );
        assert_eq!(
            default_sql(DbEngine::MySql, "CURRENT_TIMESTAMP(6)", false),
            "CURRENT_TIMESTAMP(6)"
        );
        assert_eq!(default_sql(DbEngine::MySql, "abc", false), "'abc'");
        assert_eq!(
            default_sql(DbEngine::MySql, "CURRENT_TIMESTAMP; DROP", false),
            "'CURRENT_TIMESTAMP; DROP'"
        );
        assert_eq!(default_sql(DbEngine::MySql, "uuid()", true), "(uuid())");
        assert_eq!(
            default_sql(DbEngine::Sqlite, "(datetime('now'))", true),
            "(datetime('now'))"
        );
        assert_eq!(
            parse_default(DbEngine::MySql, Some("'it''s'".into()), ""),
            (Some("it's".into()), false)
        );
        assert_eq!(
            parse_default(DbEngine::MySql, Some("NULL".into()), ""),
            (None, false)
        );
    }

    #[test]
    fn expression_defaults_are_recognized_per_engine() {
        // MariaDB: bare function call is an expression.
        assert_eq!(
            parse_default(DbEngine::MySql, Some("uuid()".into()), ""),
            (Some("uuid()".into()), true)
        );
        // MySQL 8: bare literal stays a literal unless DEFAULT_GENERATED.
        assert_eq!(
            parse_default(DbEngine::MySql, Some("activo".into()), ""),
            (Some("activo".into()), false)
        );
        assert_eq!(
            parse_default(
                DbEngine::MySql,
                Some("(now() + interval 1 day)".into()),
                "DEFAULT_GENERATED"
            ),
            (Some("(now() + interval 1 day)".into()), true)
        );
        // SQLite: anything unquoted and non-numeric is SQL.
        assert_eq!(
            parse_default(DbEngine::Sqlite, Some("(datetime('now'))".into()), ""),
            (Some("(datetime('now'))".into()), true)
        );
    }

    #[test]
    fn modify_keeps_on_update_and_collation() {
        let mut before_col = col("updated", "timestamp");
        before_col.on_update = Some("current_timestamp()".into());
        before_col.default_value = Some("current_timestamp()".into());
        before_col.default_is_expression = true;
        let mut name = col("nombre", "varchar(50)");
        name.collation = Some("utf8mb4_spanish_ci".into());
        let before = schema(vec![table(
            "t",
            vec![id_col(), before_col.clone(), name.clone()],
            vec![],
        )]);
        let mut after_col = before_col;
        after_col.comment = "última edición".into();
        let mut wider = name;
        wider.column_type = "varchar(80)".into();
        let after = schema(vec![table("t", vec![id_col(), after_col, wider], vec![])]);
        let up = build_migration("db", DbEngine::MySql, &before, &after)
            .unwrap()
            .up_sql;
        assert!(
            up.contains("DEFAULT current_timestamp() ON UPDATE current_timestamp()"),
            "{up}"
        );
        assert!(
            up.contains("varchar(80) COLLATE utf8mb4_spanish_ci"),
            "{up}"
        );
    }

    #[test]
    fn renaming_a_table_or_column_keeps_its_data() {
        let mut before_col = col("nombre", "varchar(50)");
        before_col.original_name = Some("nombre".into());
        let mut before_table = table("clientes", vec![id_col(), before_col.clone()], vec![]);
        before_table.original_name = Some("clientes".into());
        let before = schema(vec![before_table.clone()]);

        let mut renamed_col = before_col;
        renamed_col.name = "nombre_completo".into();
        let mut renamed = before_table;
        renamed.name = "personas".into();
        renamed.columns = vec![id_col(), renamed_col];
        let after = schema(vec![renamed]);

        let migration = build_migration("db", DbEngine::MySql, &before, &after).unwrap();
        assert!(migration
            .up_sql
            .contains("RENAME TABLE `clientes` TO `personas`;"));
        assert!(migration.up_sql.contains(
            "ALTER TABLE `personas` CHANGE COLUMN `nombre` `nombre_completo` varchar(50) NULL;"
        ));
        assert!(
            !migration.up.iter().any(|s| s.is_destructive),
            "{}",
            migration.up_sql
        );
        assert!(migration
            .down_sql
            .contains("RENAME TABLE `personas` TO `clientes`;"));
        assert!(migration
            .down_sql
            .contains("CHANGE COLUMN `nombre_completo` `nombre`"));

        let sqlite = build_migration("db", DbEngine::Sqlite, &before, &after).unwrap();
        assert!(sqlite
            .up_sql
            .contains("ALTER TABLE \"clientes\" RENAME TO \"personas\";"));
        assert!(sqlite
            .up_sql
            .contains("ALTER TABLE \"personas\" RENAME COLUMN \"nombre\" TO \"nombre_completo\";"));
        assert!(!sqlite.up_sql.contains("DROP TABLE"), "{}", sqlite.up_sql);
    }

    #[test]
    fn retyping_a_referenced_column_drops_and_restores_its_foreign_keys() {
        let mut child_ref = col("cliente_id", "int(11)");
        child_ref.nullable = false;
        let before = schema(vec![
            table(
                "clientes",
                vec![DesignColumn {
                    column_type: "int(11)".into(),
                    ..id_col()
                }],
                vec![],
            ),
            table(
                "pedidos",
                vec![id_col(), child_ref.clone()],
                vec![fk("fk_ped_cli", "cliente_id", "clientes")],
            ),
        ]);
        let mut wide_ref = child_ref;
        wide_ref.column_type = "bigint(20)".into();
        let after = schema(vec![
            table("clientes", vec![id_col()], vec![]),
            table(
                "pedidos",
                vec![id_col(), wide_ref],
                vec![fk("fk_ped_cli", "cliente_id", "clientes")],
            ),
        ]);
        let up = build_migration("db", DbEngine::MySql, &before, &after)
            .unwrap()
            .up;
        let drop = position(&up, "DROP FOREIGN KEY `fk_ped_cli`");
        let modify = position(&up, "MODIFY COLUMN `id`");
        let add = position(&up, "ADD CONSTRAINT `fk_ped_cli`");
        assert!(drop < modify && modify < add);
    }

    #[test]
    fn new_tables_are_created_after_new_columns_they_reference() {
        let before = schema(vec![table("paises", vec![id_col()], vec![])]);
        let mut code = col("codigo", "char(2)");
        code.nullable = false;
        let mut city_country = col("pais_codigo", "char(2)");
        city_country.nullable = false;
        let mut city_fk = fk("", "pais_codigo", "paises");
        city_fk.referenced_columns = vec!["codigo".into()];
        let after = schema(vec![
            table("paises", vec![id_col(), code], vec![]),
            table("ciudades", vec![id_col(), city_country], vec![city_fk]),
        ]);
        let up = build_migration("db", DbEngine::MySql, &before, &after)
            .unwrap()
            .up;
        assert!(position(&up, "ADD COLUMN `codigo`") < position(&up, "CREATE TABLE `ciudades`"));
    }

    #[test]
    fn foreign_key_names_are_unique_and_short() {
        let long = "una_tabla_con_un_nombre_extremadamente_largo_para_mysql";
        let mut a = col("cliente_id_de_referencia_principal", "bigint");
        a.nullable = false;
        let fks = vec![
            fk("", "cliente_id_de_referencia_principal", "clientes"),
            fk("", "cliente_id_de_referencia_principal", "clientes"),
        ];
        let design = schema(vec![
            table("clientes", vec![id_col()], vec![]),
            table(long, vec![id_col(), a], fks),
        ]);
        let normalized = normalize_design(&design).unwrap();
        let names: Vec<&String> = normalized.tables[1]
            .foreign_keys
            .iter()
            .map(|f| &f.name)
            .collect();
        assert_ne!(names[0], names[1]);
        assert!(names.iter().all(|n| n.chars().count() <= MAX_IDENTIFIER));
    }

    #[test]
    fn column_types_accept_any_quoted_enum_value() {
        assert!(is_safe_column_type("enum('sí','no','a-b','c.d')"));
        assert!(is_safe_column_type("set('x y','ñ')"));
        assert!(!is_safe_column_type("enum('a\\'); DROP')"));
        assert!(!is_safe_column_type("int; DROP TABLE x"));
        assert!(!is_safe_column_type("enum('abierta"));
    }

    #[test]
    fn generated_columns_cannot_be_modified() {
        let mut total = col("total", "decimal(10,2)");
        total.generated = true;
        let before = schema(vec![table("t", vec![id_col(), total.clone()], vec![])]);
        let mut changed = total;
        changed.column_type = "decimal(12,2)".into();
        let after = schema(vec![table("t", vec![id_col(), changed], vec![])]);
        let error = build_migration("db", DbEngine::MySql, &before, &after).unwrap_err();
        assert!(error.to_string().contains("columna generada"));
    }

    #[test]
    fn sqlite_rebuild_recreates_indexes_and_triggers() {
        let mut before_table = table(
            "t",
            vec![id_col(), col("a", "TEXT"), col("b", "TEXT")],
            vec![],
        );
        before_table.preserved_sql = vec![
            "CREATE INDEX idx_a ON t(a)".into(),
            "CREATE INDEX idx_b ON t(b)".into(),
            "CREATE TRIGGER trg AFTER INSERT ON t BEGIN SELECT 1; END".into(),
        ];
        let before = schema(vec![before_table]);
        let after = schema(vec![table("t", vec![id_col(), col("a", "TEXT")], vec![])]);
        let migration = build_migration("db", DbEngine::Sqlite, &before, &after).unwrap();
        let up = &migration.up_sql;
        assert!(up.contains("DROP TABLE IF EXISTS \"pyro_rebuild_t\";"));
        assert!(up.contains("CREATE INDEX idx_a ON t(a);"));
        assert!(up.contains("CREATE TRIGGER trg AFTER INSERT ON t BEGIN SELECT 1; END;"));
        assert!(!up.contains("idx_b"), "{up}");
        assert!(
            position(&migration.up, "RENAME TO \"t\"")
                < position(&migration.up, "CREATE INDEX idx_a")
        );
    }

    #[test]
    fn sqlite_rebuild_is_refused_when_it_would_drop_constraints() {
        assert_eq!(
            sqlite_rebuild_blocker("CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT)"),
            None
        );
        assert!(sqlite_rebuild_blocker("CREATE TABLE t (a TEXT UNIQUE)").is_some());
        assert!(sqlite_rebuild_blocker("CREATE TABLE t (a INT CHECK (a > 0))").is_some());

        let mut blocked = table("t", vec![id_col(), col("a", "TEXT")], vec![]);
        blocked.rebuild_blocker = Some("restricciones UNIQUE".into());
        let before = schema(vec![blocked]);
        let after = schema(vec![table(
            "t",
            vec![id_col(), col("a", "INTEGER")],
            vec![],
        )]);
        let error = build_migration("db", DbEngine::Sqlite, &before, &after).unwrap_err();
        assert!(error.to_string().contains("UNIQUE"));
    }

    #[test]
    fn sqlite_creates_tables_with_inline_fks_and_drops_in_reverse() {
        let migration = build_migration(
            "shop",
            DbEngine::Sqlite,
            &DesignedSchema::default(),
            &shop(),
        )
        .unwrap();
        let customers = position(&migration.up, "CREATE TABLE \"customers\"");
        let orders = position(&migration.up, "CREATE TABLE \"orders\"");
        assert!(customers < orders);
        assert!(migration.up[customers]
            .sql
            .contains("\"id\" bigint NOT NULL PRIMARY KEY AUTOINCREMENT"));
        assert!(migration.up[orders].sql.contains("CONSTRAINT \"fk_orders_customer\" FOREIGN KEY (\"customer_id\") REFERENCES \"customers\" (\"id\") ON DELETE CASCADE ON UPDATE RESTRICT"));
        assert!(!migration.up[customers].sql.contains("ENGINE="));

        // DOWN is symmetric drop
        let drop_orders = position(&migration.down, "DROP TABLE \"orders\"");
        let drop_customers = position(&migration.down, "DROP TABLE \"customers\"");
        assert!(drop_orders < drop_customers);
    }

    #[test]
    fn sqlite_table_rebuild_on_column_or_fk_change() {
        let before = schema(vec![table(
            "users",
            vec![id_col(), col("name", "text")],
            vec![],
        )]);
        let after = schema(vec![table(
            "users",
            vec![id_col(), col("name", "text"), col("email", "text")],
            vec![],
        )]);

        let migration = build_migration("db", DbEngine::Sqlite, &before, &after).unwrap();
        assert!(migration.has_changes);
        let pragma_off = position(&migration.up, "PRAGMA foreign_keys = OFF;");
        let create_temp = position(&migration.up, "CREATE TABLE \"pyro_rebuild_users\"");
        let copy_data = position(
            &migration.up,
            "INSERT INTO \"pyro_rebuild_users\" (\"id\", \"name\") SELECT \"id\", \"name\" FROM \"users\";",
        );
        let drop_old = position(&migration.up, "DROP TABLE \"users\";");
        let rename_new = position(
            &migration.up,
            "ALTER TABLE \"pyro_rebuild_users\" RENAME TO \"users\";",
        );
        let pragma_check = position(&migration.up, "PRAGMA foreign_key_check;");
        let pragma_on = position(&migration.up, "PRAGMA foreign_keys = ON;");

        assert!(pragma_off < create_temp);
        assert!(create_temp < copy_data);
        assert!(copy_data < drop_old);
        assert!(drop_old < rename_new);
        assert!(rename_new < pragma_check);
        assert!(pragma_check < pragma_on);

        // DOWN reverts the added column using symmetric rebuild
        let down_copy = position(
            &migration.down,
            "INSERT INTO \"pyro_rebuild_users\" (\"id\", \"name\") SELECT \"id\", \"name\" FROM \"users\";",
        );
        assert!(down_copy > 0);
    }
}
