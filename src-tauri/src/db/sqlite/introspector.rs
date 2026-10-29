//! SQLite catalog queries (`sqlite_master` and the `pragma_*` table-valued
//! functions). Values are inlined as escaped literals instead of bound so the
//! same queries also run through the PHP tunnel.

use futures_util::FutureExt;
use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::LazyLock;

use crate::db::backend::DatabaseBackend;
use crate::db::dialect::{Dialect, SQLITE_DIALECT};
use crate::db::error::PyroError;
use crate::db::introspect::{IntrospectFuture, SchemaIntrospector, TableStorage};
use crate::db::models::{
    ColumnMetadata, DatabaseSchema, ForeignKeyMetadata, IndexColumn, IndexMetadata, PrimaryKey,
    TableExtendedStats, TableMetadata, TriggerDetail, TriggerMetadata,
};
use crate::db::query::value_to_i64;

/// Names that address the implicit row id, in order of preference: a real
/// column with the same name hides the alias.
const ROW_ID_ALIASES: [&str; 3] = ["rowid", "_rowid_", "oid"];

/// Schema that a blank database name refers to.
const MAIN_SCHEMA: &str = "main";

/// The temporary schema is per connection and not browsable.
const TEMP_SCHEMA: &str = "temp";

pub struct SqliteIntrospector;

pub static SQLITE_INTROSPECTOR: SqliteIntrospector = SqliteIntrospector;

impl SchemaIntrospector for SqliteIntrospector {
    fn list_databases<'a>(
        &self,
        backend: &'a dyn DatabaseBackend,
    ) -> IntrospectFuture<'a, Vec<DatabaseSchema>> {
        list_databases(backend).boxed()
    }

    fn list_tables<'a>(
        &self,
        backend: &'a dyn DatabaseBackend,
        database: &'a str,
    ) -> IntrospectFuture<'a, Vec<TableMetadata>> {
        list_tables(backend, database).boxed()
    }

    fn table_columns<'a>(
        &self,
        backend: &'a dyn DatabaseBackend,
        database: &'a str,
        table: &'a str,
    ) -> IntrospectFuture<'a, Vec<ColumnMetadata>> {
        table_columns(backend, database, table).boxed()
    }

    fn primary_key<'a>(
        &self,
        backend: &'a dyn DatabaseBackend,
        database: &'a str,
        table: &'a str,
    ) -> IntrospectFuture<'a, PrimaryKey> {
        primary_key(backend, database, table).boxed()
    }

    fn completion_schema<'a>(
        &self,
        backend: &'a dyn DatabaseBackend,
        database: &'a str,
    ) -> IntrospectFuture<'a, HashMap<String, Vec<String>>> {
        completion_schema(backend, database).boxed()
    }

    fn list_indexes<'a>(
        &self,
        backend: &'a dyn DatabaseBackend,
        database: &'a str,
        table: &'a str,
    ) -> IntrospectFuture<'a, Vec<IndexMetadata>> {
        list_indexes(backend, database, table).boxed()
    }

    fn list_triggers<'a>(
        &self,
        backend: &'a dyn DatabaseBackend,
        database: &'a str,
        table: Option<&'a str>,
    ) -> IntrospectFuture<'a, Vec<TriggerMetadata>> {
        list_triggers(backend, database, table).boxed()
    }

    fn trigger_definition<'a>(
        &self,
        backend: &'a dyn DatabaseBackend,
        database: &'a str,
        name: &'a str,
    ) -> IntrospectFuture<'a, TriggerDetail> {
        trigger_definition(backend, database, name).boxed()
    }

    fn foreign_keys<'a>(
        &self,
        backend: &'a dyn DatabaseBackend,
        database: &'a str,
    ) -> IntrospectFuture<'a, HashMap<String, Vec<ForeignKeyMetadata>>> {
        foreign_keys(backend, database).boxed()
    }

    fn table_storage<'a>(
        &self,
        backend: &'a dyn DatabaseBackend,
        database: &'a str,
        table: &'a str,
    ) -> IntrospectFuture<'a, TableStorage> {
        table_storage(backend, database, table).boxed()
    }

    fn browse_select_list<'a>(
        &self,
        backend: &'a dyn DatabaseBackend,
        database: &'a str,
        table: &'a str,
    ) -> IntrospectFuture<'a, String> {
        browse_select_list(backend, database, table).boxed()
    }
}

async fn list_databases(backend: &dyn DatabaseBackend) -> Result<Vec<DatabaseSchema>, PyroError> {
    let mut schemas = Vec::new();
    for row in fetch_rows(backend, "PRAGMA database_list").await? {
        let name = text(&row, 1);
        if name.is_empty() || name == TEMP_SCHEMA {
            continue;
        }
        let count_sql = format!(
            "SELECT count(*) FROM {} WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
            catalog(&name)?
        );
        let tables_count = fetch_rows(backend, &count_sql)
            .await?
            .first()
            .map_or(0, |row| integer(row, 0));
        schemas.push(DatabaseSchema {
            name,
            tables_count: tables_count.max(0) as usize,
        });
    }
    Ok(schemas)
}

async fn list_tables(
    backend: &dyn DatabaseBackend,
    database: &str,
) -> Result<Vec<TableMetadata>, PyroError> {
    let sql = format!(
        "SELECT name, type FROM {} WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
        catalog(database)?
    );
    Ok(fetch_rows(backend, &sql)
        .await?
        .iter()
        .map(|row| TableMetadata {
            name: text(row, 0),
            table_type: if text(row, 1) == "view" {
                "VIEW"
            } else {
                "BASE TABLE"
            }
            .into(),
            engine: None,
            rows_count: None,
            data_length: None,
            collation: None,
            comment: None,
        })
        .collect())
}

/// Row of `pragma_table_info`.
struct DeclaredColumn {
    position: i64,
    name: String,
    declared_type: String,
    not_null: bool,
    default: Option<String>,
    /// 1-based position inside the primary key, 0 when not part of it.
    primary_key_position: i64,
}

async fn declared_columns(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
) -> Result<Vec<DeclaredColumn>, PyroError> {
    let sql = format!(
        "SELECT cid, name, type, \"notnull\", dflt_value, pk FROM pragma_table_info({}, {}) ORDER BY cid",
        literal(table),
        literal(schema(database))
    );
    Ok(fetch_rows(backend, &sql)
        .await?
        .iter()
        .map(|row| DeclaredColumn {
            position: integer(row, 0),
            name: text(row, 1),
            declared_type: text(row, 2),
            not_null: integer(row, 3) != 0,
            default: optional_text(row, 4),
            primary_key_position: integer(row, 5),
        })
        .collect())
}

async fn table_columns(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
) -> Result<Vec<ColumnMetadata>, PyroError> {
    let columns = declared_columns(backend, database, table).await?;
    let key_columns = columns
        .iter()
        .filter(|column| column.primary_key_position > 0)
        .count();
    Ok(columns
        .into_iter()
        .map(|column| {
            // `INTEGER PRIMARY KEY` aliases the row id: SQLite assigns it.
            let is_row_id_alias = key_columns == 1
                && column.primary_key_position > 0
                && column.declared_type.eq_ignore_ascii_case("INTEGER");
            ColumnMetadata {
                ordinal_position: column.position as i32 + 1,
                column_default: column.default,
                is_nullable: !column.not_null && !is_row_id_alias,
                data_type: base_type(&column.declared_type),
                column_key: if column.primary_key_position > 0 {
                    "PRI"
                } else {
                    ""
                }
                .into(),
                extra: if is_row_id_alias {
                    "auto_increment"
                } else {
                    ""
                }
                .into(),
                comment: String::new(),
                collation: None,
                character_set: None,
                column_type: column.declared_type,
                name: column.name,
            }
        })
        .collect())
}

/// `VARCHAR(20)` → `varchar`; an undeclared type has BLOB affinity.
fn base_type(declared_type: &str) -> String {
    let base = declared_type
        .split(|c: char| c == '(' || c.is_whitespace())
        .next()
        .unwrap_or_default();
    if base.is_empty() {
        "blob".into()
    } else {
        base.to_lowercase()
    }
}

/// Declared primary key or, for tables without one, the implicit row id.
async fn primary_key(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
) -> Result<PrimaryKey, PyroError> {
    let mut columns = declared_columns(backend, database, table).await?;
    columns.retain(|column| column.primary_key_position > 0);
    if !columns.is_empty() {
        columns.sort_by_key(|column| column.primary_key_position);
        return Ok(PrimaryKey {
            columns: columns.into_iter().map(|column| column.name).collect(),
        });
    }
    let row_id = implicit_row_id(backend, database, table).await?;
    Ok(PrimaryKey {
        columns: row_id.map(str::to_string).into_iter().collect(),
    })
}

/// Row id alias usable for `table`: `None` for views and when every alias is
/// shadowed by a real column. `WITHOUT ROWID` tables always declare a key.
async fn implicit_row_id(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
) -> Result<Option<&'static str>, PyroError> {
    let sql = format!(
        "SELECT type FROM {} WHERE name = {}",
        catalog(database)?,
        literal(table)
    );
    let is_table = fetch_rows(backend, &sql)
        .await?
        .first()
        .is_some_and(|row| text(row, 0) == "table");
    if !is_table {
        return Ok(None);
    }
    let columns = declared_columns(backend, database, table).await?;
    Ok(ROW_ID_ALIASES.into_iter().find(|alias| {
        !columns
            .iter()
            .any(|column| column.name.eq_ignore_ascii_case(alias))
    }))
}

/// Tables identified by their implicit row id expose it as the first column.
async fn browse_select_list(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
) -> Result<String, PyroError> {
    let key = primary_key(backend, database, table).await?;
    match key.columns.as_slice() {
        [column] if ROW_ID_ALIASES.contains(&column.as_str()) => Ok(format!("{column}, *")),
        _ => Ok("*".into()),
    }
}

async fn completion_schema(
    backend: &dyn DatabaseBackend,
    database: &str,
) -> Result<HashMap<String, Vec<String>>, PyroError> {
    let sql = format!(
        "SELECT m.name, p.name FROM {} AS m JOIN pragma_table_info(m.name, {}) AS p \
         WHERE m.type IN ('table', 'view') AND m.name NOT LIKE 'sqlite_%' ORDER BY m.name, p.cid",
        catalog(database)?,
        literal(schema(database))
    );
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for row in fetch_rows(backend, &sql).await? {
        map.entry(text(&row, 0)).or_default().push(text(&row, 1));
    }
    Ok(map)
}

/// Explicit indexes plus a `PRIMARY` entry built from the declared key, like
/// MariaDB's `SHOW INDEX`. SQLite's automatic key indexes are not repeated.
async fn list_indexes(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
) -> Result<Vec<IndexMetadata>, PyroError> {
    let sql = format!(
        "SELECT il.name, il.\"unique\", il.origin, ii.seqno, ii.name \
         FROM pragma_index_list({table}, {schema}) AS il \
         JOIN pragma_index_info(il.name, {schema}) AS ii ORDER BY il.name, ii.seqno",
        table = literal(table),
        schema = literal(schema(database))
    );
    let mut indexes: Vec<IndexMetadata> = Vec::new();
    for row in fetch_rows(backend, &sql).await? {
        if text(&row, 2) == "pk" {
            continue;
        }
        let name = text(&row, 0);
        let column = IndexColumn {
            seq_in_index: integer(&row, 3) as u32 + 1,
            column_name: optional_text(&row, 4).unwrap_or_else(|| "<expresión>".into()),
            sub_part: None,
            collation: None,
        };
        match indexes.last_mut() {
            Some(index) if index.key_name == name => index.columns.push(column),
            _ => indexes.push(IndexMetadata {
                key_name: name,
                is_primary: false,
                is_unique: integer(&row, 1) != 0,
                index_type: "BTREE".into(),
                columns: vec![column],
                comment: None,
            }),
        }
    }
    if let Some(primary) = primary_index(backend, database, table).await? {
        indexes.insert(0, primary);
    }
    Ok(indexes)
}

async fn primary_index(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
) -> Result<Option<IndexMetadata>, PyroError> {
    let mut key_columns = declared_columns(backend, database, table).await?;
    key_columns.retain(|column| column.primary_key_position > 0);
    if key_columns.is_empty() {
        return Ok(None);
    }
    key_columns.sort_by_key(|column| column.primary_key_position);
    Ok(Some(IndexMetadata {
        key_name: "PRIMARY".into(),
        is_primary: true,
        is_unique: true,
        index_type: "BTREE".into(),
        columns: key_columns
            .into_iter()
            .map(|column| IndexColumn {
                seq_in_index: column.primary_key_position as u32,
                column_name: column.name,
                sub_part: None,
                collation: None,
            })
            .collect(),
        comment: None,
    }))
}

async fn list_triggers(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: Option<&str>,
) -> Result<Vec<TriggerMetadata>, PyroError> {
    let table_filter = table
        .filter(|table| !table.is_empty())
        .map(|table| format!(" AND tbl_name = {}", literal(table)))
        .unwrap_or_default();
    let sql = format!(
        "SELECT name, tbl_name, sql FROM {} WHERE type = 'trigger'{table_filter} ORDER BY tbl_name, name",
        catalog(database)?
    );
    Ok(fetch_rows(backend, &sql)
        .await?
        .iter()
        .map(|row| {
            let (timing, event) = trigger_timing_and_event(&text(row, 2));
            TriggerMetadata {
                name: text(row, 0),
                table_name: text(row, 1),
                timing,
                event,
                definer: None,
                created: None,
            }
        })
        .collect())
}

async fn trigger_definition(
    backend: &dyn DatabaseBackend,
    database: &str,
    name: &str,
) -> Result<TriggerDetail, PyroError> {
    let sql = format!(
        "SELECT tbl_name, sql FROM {} WHERE type = 'trigger' AND name = {}",
        catalog(database)?,
        literal(name)
    );
    let rows = fetch_rows(backend, &sql).await?;
    let row = rows.first().ok_or_else(|| {
        PyroError::InvalidOperation(format!("No se encontró el trigger '{name}'."))
    })?;
    let ddl = text(row, 1);
    let (timing, event) = trigger_timing_and_event(&ddl);
    Ok(TriggerDetail {
        name: name.to_string(),
        table_name: text(row, 0),
        timing,
        event,
        ddl,
    })
}

static TRIGGER_EVENT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?is)\bTRIGGER\b.*?\b(BEFORE|AFTER|INSTEAD\s+OF)?\s*\b(INSERT|UPDATE|DELETE)\b")
        .expect("valid trigger regex")
});

/// Timing and event of a `CREATE TRIGGER` statement; SQLite defaults to `BEFORE`.
fn trigger_timing_and_event(ddl: &str) -> (String, String) {
    let Some(captures) = TRIGGER_EVENT.captures(ddl) else {
        return ("BEFORE".into(), "INSERT".into());
    };
    let timing = captures
        .get(1)
        .map(|timing| {
            timing
                .as_str()
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
        })
        .unwrap_or_else(|| "BEFORE".into())
        .to_uppercase();
    (timing, captures[2].to_uppercase())
}

/// SQLite foreign keys are unnamed; they are labelled `fk_<table>_<id>`.
async fn foreign_keys(
    backend: &dyn DatabaseBackend,
    database: &str,
) -> Result<HashMap<String, Vec<ForeignKeyMetadata>>, PyroError> {
    let sql = format!(
        "SELECT m.name, f.id, f.\"from\", f.\"table\", f.\"to\", f.on_update, f.on_delete \
         FROM {} AS m JOIN pragma_foreign_key_list(m.name, {}) AS f \
         WHERE m.type = 'table' ORDER BY m.name, f.id, f.seq",
        catalog(database)?,
        literal(schema(database))
    );
    let mut result: HashMap<String, Vec<ForeignKeyMetadata>> = HashMap::new();
    for row in fetch_rows(backend, &sql).await? {
        let table = text(&row, 0);
        result
            .entry(table.clone())
            .or_default()
            .push(ForeignKeyMetadata {
                name: format!("fk_{table}_{}", integer(&row, 1)),
                column_name: text(&row, 2),
                referenced_table: text(&row, 3),
                referenced_column: text(&row, 4),
                update_rule: text(&row, 5),
                delete_rule: text(&row, 6),
            });
    }
    Ok(result)
}

/// Row count plus the stored DDL of the table and of its indexes and triggers.
/// SQLite keeps no other physical statistics per table.
async fn table_storage(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
) -> Result<TableStorage, PyroError> {
    let mut statistics = TableExtendedStats::empty(schema(database), table, "SQLite");
    let count_sql = format!(
        "SELECT count(*) FROM {}",
        SQLITE_DIALECT.qualify_table(Some(schema(database)), table)?
    );
    statistics.table_rows = fetch_rows(backend, &count_sql)
        .await?
        .first()
        .map_or(0, |row| integer(row, 0));

    let ddl_sql = format!(
        "SELECT sql FROM {} WHERE tbl_name = {} AND sql IS NOT NULL \
         ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'view' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name",
        catalog(database)?,
        literal(table)
    );
    let statements: Vec<String> = fetch_rows(backend, &ddl_sql)
        .await?
        .iter()
        .map(|row| format!("{};", text(row, 0)))
        .collect();
    Ok(TableStorage {
        statistics,
        ddl: statements.join("\n\n"),
    })
}

fn schema(database: &str) -> &str {
    let database = database.trim();
    if database.is_empty() {
        MAIN_SCHEMA
    } else {
        database
    }
}

fn catalog(database: &str) -> Result<String, PyroError> {
    SQLITE_DIALECT.qualify_table(Some(schema(database)), "sqlite_master")
}

fn literal(text: &str) -> String {
    SQLITE_DIALECT.string_literal(text)
}

async fn fetch_rows(
    backend: &dyn DatabaseBackend,
    sql: &str,
) -> Result<Vec<Vec<Value>>, PyroError> {
    Ok(backend.execute_query(sql, None).await?.rows)
}

fn optional_text(row: &[Value], index: usize) -> Option<String> {
    match row.get(index)? {
        Value::Null => None,
        Value::String(text) => Some(text.clone()),
        other => Some(other.to_string()),
    }
}

fn text(row: &[Value], index: usize) -> String {
    optional_text(row, index).unwrap_or_default()
}

fn integer(row: &[Value], index: usize) -> i64 {
    row.get(index).and_then(value_to_i64).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_trigger_timing_and_event() {
        assert_eq!(
            trigger_timing_and_event("CREATE TRIGGER t AFTER UPDATE OF a ON x BEGIN SELECT 1; END"),
            ("AFTER".into(), "UPDATE".into())
        );
        assert_eq!(
            trigger_timing_and_event("CREATE TRIGGER t INSTEAD  OF delete ON v BEGIN END"),
            ("INSTEAD OF".into(), "DELETE".into())
        );
        assert_eq!(
            trigger_timing_and_event("create temp trigger t insert on x begin end"),
            ("BEFORE".into(), "INSERT".into())
        );
    }

    #[test]
    fn base_type_drops_length_and_defaults_to_blob() {
        assert_eq!(base_type("VARCHAR(20)"), "varchar");
        assert_eq!(base_type("UNSIGNED BIG INT"), "unsigned");
        assert_eq!(base_type(""), "blob");
    }
}
