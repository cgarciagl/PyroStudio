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

use serde::{Deserialize, Serialize};

use super::backend::DatabaseBackend;
use super::dialect::{MYSQL_DIALECT, SQLITE_DIALECT};
use super::engine::DbEngine;
use super::error::PyroError;
use super::introspect::introspector;
use super::models::MigrationStatement;
use super::safe_mode::DangerLevel;
use super::sql_utils::{quote_ident_mysql, sql_string_literal};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DesignColumn {
    pub name: String,
    pub column_type: String,
    pub nullable: bool,
    pub primary_key: bool,
    pub auto_increment: bool,
    #[serde(default)]
    pub default_value: Option<String>,
    #[serde(default)]
    pub comment: String,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DesignTable {
    pub name: String,
    pub columns: Vec<DesignColumn>,
    #[serde(default)]
    pub foreign_keys: Vec<DesignForeignKey>,
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

/// MariaDB reports string defaults already quoted (`'abc'`) and a bare `NULL`
/// for nullable columns; the designer works with the plain value.
fn plain_default(raw: Option<String>) -> Option<String> {
    let value = raw?;
    let trimmed = value.trim();
    if trimmed.eq_ignore_ascii_case("null") {
        return None;
    }
    if trimmed.len() >= 2 && trimmed.starts_with('\'') && trimmed.ends_with('\'') {
        return Some(trimmed[1..trimmed.len() - 1].replace("''", "'"));
    }
    Some(value)
}

/// Reads the physical schema of `database` as a design model (views excluded).
pub async fn fetch_design_schema(
    backend: &dyn DatabaseBackend,
    database: &str,
) -> Result<DesignedSchema, PyroError> {
    let schema = introspector(backend);
    let mut tables = Vec::new();
    for meta in schema.list_tables(backend, database).await? {
        if meta.table_type.to_ascii_uppercase().contains("VIEW") {
            continue;
        }
        let columns = schema
            .table_columns(backend, database, &meta.name)
            .await?
            .into_iter()
            .map(|c| DesignColumn {
                primary_key: c.column_key.eq_ignore_ascii_case("PRI"),
                auto_increment: c.extra.to_ascii_lowercase().contains("auto_increment"),
                default_value: plain_default(c.column_default),
                name: c.name,
                column_type: c.column_type,
                nullable: c.is_nullable,
                comment: c.comment,
            })
            .collect();
        tables.push(DesignTable {
            name: meta.name,
            columns,
            foreign_keys: Vec::new(),
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

fn is_safe_column_type(column_type: &str) -> bool {
    let t = column_type.trim();
    !t.is_empty()
        && t.len() <= 200
        && t.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | ',' | '(' | ')' | '_' | '\''))
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
            if fk.name.trim().is_empty() {
                fk.name = format!("fk_{}_{}", table.name, fk.columns.join("_"));
            }
            fk.on_delete = normalize_action(&fk.on_delete)?;
            fk.on_update = normalize_action(&fk.on_update)?;
        }
    }
    Ok(schema)
}

// ---------------------------------------------------------------------------
// SQL fragments
// ---------------------------------------------------------------------------

fn default_sql(engine: DbEngine, value: &str) -> String {
    let trimmed = value.trim();
    let upper = trimmed.to_ascii_uppercase();
    let is_timestamp = upper == "NOW()"
        || upper == "CURRENT_TIMESTAMP"
        || upper == "CURRENT_TIME"
        || upper == "CURRENT_DATE"
        || upper
            .strip_prefix("CURRENT_TIMESTAMP(")
            .and_then(|rest| rest.strip_suffix(')'))
            .is_some_and(|digits| digits.chars().all(|c| c.is_ascii_digit()));
    if upper == "NULL" || is_timestamp || trimmed.parse::<f64>().is_ok() {
        trimmed.to_string()
    } else {
        match engine {
            DbEngine::Sqlite => sql_string_literal(&SQLITE_DIALECT, trimmed),
            _ => sql_string_literal(&MYSQL_DIALECT, trimmed),
        }
    }
}

fn column_sql(engine: DbEngine, column: &DesignColumn, with_auto_increment: bool) -> String {
    let mut sql = format!(
        "{} {} {}",
        qi(engine, &column.name),
        column.column_type.trim(),
        if column.nullable { "NULL" } else { "NOT NULL" }
    );
    if with_auto_increment && column.auto_increment {
        if engine == DbEngine::Sqlite {
            sql.push_str(" PRIMARY KEY AUTOINCREMENT");
        } else {
            sql.push_str(" AUTO_INCREMENT");
        }
    } else if let Some(default) = &column.default_value {
        sql.push_str(&format!(" DEFAULT {}", default_sql(engine, default)));
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
        && a.comment == b.comment
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
) {
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
}

/// Statements that turn schema `from` into schema `to`.
fn diff_schemas(
    engine: DbEngine,
    from: &DesignedSchema,
    to: &DesignedSchema,
) -> Result<(Vec<MigrationStatement>, Vec<String>), PyroError> {
    let mut statements = Vec::new();
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

    // A. Foreign keys that disappear or change on tables that stay.
    for (old, new) in &common {
        for fk in &old.foreign_keys {
            let kept = new
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

    // C. New tables, dependencies first.
    for table in creation_order(&created)? {
        statements.push(statement(
            create_table_sql(engine, table),
            format!("Crear tabla `{}`", table.name),
            DangerLevel::Safe,
            false,
            &table.name,
        ));
    }

    // D. Columns and keys of tables that stay.
    for (old, new) in &common {
        table_column_ops(engine, old, new, &mut statements, &mut warnings);
    }

    // E. Foreign keys that appear or change on tables that stay.
    for (old, new) in &common {
        for fk in &new.foreign_keys {
            let existing = old
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

/// Builds the reversible migration that turns `current` into `desired`.
pub fn build_migration(
    database: &str,
    engine: DbEngine,
    current: &DesignedSchema,
    desired: &DesignedSchema,
) -> Result<SchemaMigration, PyroError> {
    let desired = normalize_design(desired)?;
    let (up, mut warnings) = diff_schemas(engine, current, &desired)?;
    let (down, down_dropped) = match diff_schemas(engine, &desired, current) {
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
            default_value: None,
            comment: String::new(),
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
        assert_eq!(default_sql(DbEngine::MySql, "42"), "42");
        assert_eq!(
            default_sql(DbEngine::MySql, "current_timestamp"),
            "current_timestamp"
        );
        assert_eq!(
            default_sql(DbEngine::MySql, "CURRENT_TIMESTAMP(6)"),
            "CURRENT_TIMESTAMP(6)"
        );
        assert_eq!(default_sql(DbEngine::MySql, "abc"), "'abc'");
        assert_eq!(
            default_sql(DbEngine::MySql, "CURRENT_TIMESTAMP; DROP"),
            "'CURRENT_TIMESTAMP; DROP'"
        );
        assert_eq!(
            plain_default(Some("'it''s'".into())).as_deref(),
            Some("it's")
        );
        assert_eq!(plain_default(Some("NULL".into())), None);
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
