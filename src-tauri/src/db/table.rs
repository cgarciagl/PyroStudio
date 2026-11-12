use super::backend::DatabaseBackend;
use super::dialect::Dialect;
use super::engine::DbEngine;
use super::error::PyroError;
use super::introspect::introspector;
use super::models::{
    ColumnMetadata, PrimaryKey, TableChunkRequest, TableChunkResult, TableDataRequest,
    TableDataResult, TableMetadata,
};
use super::query::value_to_i64;
use super::row_filter::target_database;
use super::sql_utils::sql_string_literal;
use std::collections::HashMap;

/// Lists all tables in the specified database.
pub async fn list_tables(
    backend: &dyn DatabaseBackend,
    database: &str,
) -> Result<Vec<TableMetadata>, PyroError> {
    introspector(backend).list_tables(backend, database).await
}

/// Retrieves all column details for a given table.
pub async fn get_table_columns(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
) -> Result<Vec<ColumnMetadata>, PyroError> {
    introspector(backend)
        .table_columns(backend, database, table)
        .await
}

/// Retrieves the ordered list of primary key columns for a table.
/// Returns empty if table has no primary key.
pub async fn get_table_primary_key(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
) -> Result<PrimaryKey, PyroError> {
    introspector(backend)
        .primary_key(backend, database, table)
        .await
}

/// Upper bound of rows returned by one page of the table browser.
const MAX_PAGE_ROWS: u32 = 10_000;

/// Queries paginated table data with optional server-side sorting and filtering, and real column types.
pub async fn query_table_data(
    backend: &dyn DatabaseBackend,
    req: TableDataRequest,
) -> Result<TableDataResult, PyroError> {
    let dialect = backend.engine().dialect();
    let database = target_database(&req.database);
    let table_ref = dialect.qualify_table(database, &req.table)?;
    let where_clause = where_clause(req.filter_sql.as_deref());
    let order_clause = order_clause(dialect, req.order_by.as_deref(), req.order_dir.as_deref())?;
    let select_list = introspector(backend)
        .browse_select_list(backend, &req.database, &req.table)
        .await?;
    let limit = req.limit.min(MAX_PAGE_ROWS);
    let offset = req.offset;

    let count_query = format!("SELECT COUNT(*) AS total FROM {table_ref}{where_clause}");
    let data_query = format!(
        "SELECT {select_list} FROM {table_ref}{where_clause}{order_clause} LIMIT {limit} OFFSET {offset}"
    );
    // Page mode needs the total for page navigation; run it alongside the data
    // instead of before it.
    let (total_rows, data) = futures_util::join!(
        count_rows(backend, &count_query, database),
        backend.execute_query(&data_query, database),
    );
    let data = data?;
    let column_types = column_types(backend, &req.database, &req.table, &data.columns).await;

    Ok(TableDataResult {
        columns: data.columns,
        column_types,
        rows: data.rows,
        total_rows,
        execution_time_ms: data.execution_time_ms,
        limit,
        offset,
    })
}

fn where_clause(filter_sql: Option<&str>) -> String {
    match filter_sql
        .map(str::trim)
        .filter(|filter| !filter.is_empty())
    {
        Some(filter) => format!(" WHERE {filter}"),
        None => String::new(),
    }
}

/// `order_by` holds one column (direction in `order_dir`) or a list such as
/// `a DESC, b`, where each entry carries its own direction.
fn order_clause(
    dialect: &dyn Dialect,
    order_by: Option<&str>,
    order_dir: Option<&str>,
) -> Result<String, PyroError> {
    let Some(order_by) = order_by.map(str::trim).filter(|order| !order.is_empty()) else {
        return Ok(String::new());
    };
    let parsed = parse_order_terms(order_by);
    let single = parsed.len() == 1;
    let terms = parsed
        .into_iter()
        .map(|(column, direction)| {
            let direction = direction.or(if single { order_dir } else { None });
            sort_term(dialect, &column, direction)
        })
        .collect::<Result<Vec<_>, _>>()?;
    if terms.is_empty() {
        return Ok(String::new());
    }
    Ok(format!(" ORDER BY {}", terms.join(", ")))
}

/// Splits an `order_by` list into (column, direction) pairs. Columns may be
/// quoted with backticks or double quotes (doubled quotes escape), so names
/// containing spaces or commas survive; the direction is the optional
/// trailing `ASC` / `DESC`.
pub(crate) fn parse_order_terms(order_by: &str) -> Vec<(String, Option<&str>)> {
    let mut terms = Vec::new();
    let mut rest = order_by.trim_start();
    while !rest.is_empty() {
        let (column, after) = match rest.chars().next() {
            Some(q @ ('`' | '"')) => {
                let body = &rest[1..];
                let mut name = String::new();
                let mut end = body.len();
                let mut chars = body.char_indices().peekable();
                while let Some((i, c)) = chars.next() {
                    if c == q {
                        if chars.peek().map(|&(_, n)| n) == Some(q) {
                            name.push(q);
                            chars.next();
                            continue;
                        }
                        end = i + 1;
                        break;
                    }
                    name.push(c);
                }
                (name, &body[end.min(body.len())..])
            }
            _ => {
                let stop = rest
                    .find(|c: char| c == ',' || c.is_whitespace())
                    .unwrap_or(rest.len());
                (rest[..stop].to_string(), &rest[stop..])
            }
        };
        let (tail, next) = match after.find(',') {
            Some(i) => (&after[..i], &after[i + 1..]),
            None => (after, ""),
        };
        let direction = tail
            .split_whitespace()
            .next()
            .filter(|d| d.eq_ignore_ascii_case("ASC") || d.eq_ignore_ascii_case("DESC"));
        if !column.is_empty() {
            terms.push((column, direction));
        }
        rest = next.trim_start();
    }
    terms
}

fn sort_term(
    dialect: &dyn Dialect,
    column: &str,
    direction: Option<&str>,
) -> Result<String, PyroError> {
    let column = dialect.quote_identifier(column)?;
    let direction = match direction {
        Some(direction) if direction.eq_ignore_ascii_case("DESC") => "DESC",
        _ => "ASC",
    };
    Ok(format!("{column} {direction}"))
}

/// The total is informative: a failing count must not hide the page.
async fn count_rows(
    backend: &dyn DatabaseBackend,
    count_query: &str,
    database: Option<&str>,
) -> Option<i64> {
    let result = backend.execute_query(count_query, database).await.ok()?;
    result.rows.first()?.first().and_then(value_to_i64)
}

/// Exact number of rows of a table, optionally filtered. Can be slow on large tables.
pub async fn count_table_rows(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
    filter_sql: Option<&str>,
) -> Result<i64, PyroError> {
    let target = target_database(database);
    let table_ref = backend.engine().dialect().qualify_table(target, table)?;
    let sql = format!(
        "SELECT COUNT(*) AS total FROM {table_ref}{}",
        where_clause(filter_sql)
    );
    let result = backend.execute_query(&sql, target).await?;
    Ok(result
        .rows
        .first()
        .and_then(|row| row.first())
        .and_then(value_to_i64)
        .unwrap_or(0))
}

/// Instant row estimate from engine statistics (`information_schema.TABLES`).
/// Only MariaDB/MySQL provide it; other engines return `None`.
async fn estimate_table_rows(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
) -> Option<i64> {
    if backend.engine() != DbEngine::MySql {
        return None;
    }
    let dialect = backend.engine().dialect();
    let sql = format!(
        "SELECT TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = {} AND TABLE_NAME = {}",
        sql_string_literal(dialect, database),
        sql_string_literal(dialect, table)
    );
    let result = backend.execute_query(&sql, None).await.ok()?;
    result.rows.first()?.first().and_then(value_to_i64)
}

/// Declared type of each result column; unknown columns default to VARCHAR.
async fn column_types(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
    columns: &[String],
) -> Vec<String> {
    let declared: HashMap<String, String> = get_table_columns(backend, database, table)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|column| (column.name.to_lowercase(), column.column_type))
        .collect();
    columns
        .iter()
        .map(|column| {
            declared
                .get(&column.to_lowercase())
                .cloned()
                .unwrap_or_else(|| "VARCHAR".to_string())
        })
        .collect()
}

/// Drops a table.
pub async fn drop_table(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
) -> Result<(), PyroError> {
    let database = target_database(database);
    let table_ref = backend.engine().dialect().qualify_table(database, table)?;
    let sql = format!("DROP TABLE {table_ref};");
    backend.execute_query(&sql, database).await?;
    Ok(())
}

/// Renames a table inside its database.
pub async fn rename_table(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
    new_name: &str,
) -> Result<(), PyroError> {
    let database = target_database(database);
    let sql = backend
        .engine()
        .dialect()
        .rename_table(database, table, new_name)?;
    backend.execute_query(&sql, database).await?;
    Ok(())
}

/// Copies a table under a new name in the same database: its structure and,
/// when `with_data` is set, every row.
pub async fn duplicate_table(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
    new_name: &str,
    with_data: bool,
) -> Result<(), PyroError> {
    let database = target_database(database);
    let dialect = backend.engine().dialect();
    let source = dialect.qualify_table(database, table)?;
    let target = dialect.qualify_table(database, new_name)?;
    let create_sql = match backend.engine() {
        DbEngine::MySql => format!("CREATE TABLE {target} LIKE {source};"),
        DbEngine::Sqlite => {
            let schema = database.unwrap_or("main");
            let catalog = dialect.qualify_table(Some(schema), "sqlite_master")?;
            let sql = format!(
                "SELECT sql FROM {catalog} WHERE type = 'table' AND name = {}",
                dialect.string_literal(table)
            );
            let result = backend.execute_query(&sql, None).await?;
            let original = result
                .rows
                .first()
                .and_then(|row| row.first())
                .and_then(|value| value.as_str())
                .ok_or_else(|| {
                    PyroError::InvalidOperation(format!("No se encontró la tabla '{table}'."))
                })?;
            sqlite_create_with_name(original, &target)?
        }
    };
    backend.execute_query(&create_sql, database).await?;
    if with_data {
        let copy_sql = format!("INSERT INTO {target} SELECT * FROM {source};");
        if let Err(err) = backend.execute_query(&copy_sql, database).await {
            // Do not leave a half-made copy behind.
            let _ = backend
                .execute_query(&format!("DROP TABLE {target};"), database)
                .await;
            return Err(err);
        }
    }
    Ok(())
}

/// Rewrites a SQLite `CREATE TABLE <name> (...)` statement for another name.
fn sqlite_create_with_name(create_sql: &str, target: &str) -> Result<String, PyroError> {
    let body_start = create_sql.find('(').ok_or_else(|| {
        PyroError::InvalidOperation("No se pudo leer la definición de la tabla.".into())
    })?;
    Ok(format!(
        "CREATE TABLE {target} {};",
        &create_sql[body_start..]
    ))
}

/// Empties a table (`TRUNCATE` where the engine supports it).
pub async fn truncate_table(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
) -> Result<(), PyroError> {
    let database = target_database(database);
    let dialect = backend.engine().dialect();
    let table_ref = dialect.qualify_table(database, table)?;
    backend
        .execute_query(&dialect.truncate_table(&table_ref), database)
        .await?;
    Ok(())
}

/// Retrieves a mapping of all table names to their column names in a database for autocompletion.
pub async fn get_database_completion_schema(
    backend: &dyn DatabaseBackend,
    database: &str,
) -> Result<HashMap<String, Vec<String>>, PyroError> {
    introspector(backend)
        .completion_schema(backend, database)
        .await
}

/// Upper bound of rows returned by one chunk of continuous infinite scrolling.
const MAX_CHUNK_ROWS: u32 = 2_000;

/// Fetches a discrete chunk of rows for continuous virtualization and infinite scrolling,
/// using O(1) keyset pagination when a primary key is available and sorting aligns with it,
/// or falling back to deterministic cursor/offset pagination.
/// Fetches a discrete chunk of rows for continuous virtualization and infinite scrolling,
/// using O(1) keyset pagination when a primary key is available and sorting aligns with it,
/// or falling back to deterministic cursor/offset pagination.
pub async fn fetch_table_chunk(
    backend: &dyn DatabaseBackend,
    req: TableChunkRequest,
) -> Result<TableChunkResult, PyroError> {
    let dialect = backend.engine().dialect();
    let database = target_database(&req.database);
    let table_ref = dialect.qualify_table(database, &req.table)?;
    let base_where = where_clause(req.filter_sql.as_deref());
    let select_list = introspector(backend)
        .browse_select_list(backend, &req.database, &req.table)
        .await?;
    let chunk_size = req.chunk_size.clamp(10, MAX_CHUNK_ROWS);

    // Metadata lookups are independent: run them concurrently so remote
    // backends (HTTP tunnel) pay one round-trip of latency instead of several.
    let (pk, table_cols, estimated_total) = futures_util::join!(
        get_table_primary_key(backend, &req.database, &req.table),
        get_table_columns(backend, &req.database, &req.table),
        async {
            if req.include_total_count && base_where.is_empty() {
                estimate_table_rows(backend, &req.database, &req.table).await
            } else {
                None
            }
        },
    );
    let pk = pk.unwrap_or(PrimaryKey { columns: vec![] });
    let table_cols = table_cols.unwrap_or_default();

    let col_type_map: HashMap<String, String> = table_cols
        .into_iter()
        .map(|c| (c.name.to_lowercase(), c.column_type))
        .collect();

    let pk_column_types: Vec<String> = pk
        .columns
        .iter()
        .map(|c| {
            col_type_map
                .get(&c.to_lowercase())
                .cloned()
                .unwrap_or_default()
        })
        .collect();

    let keyset_eligible = is_keyset_eligible(
        &pk.columns,
        &pk_column_types,
        req.order_by.as_deref(),
        req.order_dir.as_deref(),
        req.last_primary_key_values.as_deref(),
    );

    let resolved_dir = if req
        .order_dir
        .as_deref()
        .is_some_and(|d| d.eq_ignore_ascii_case("DESC"))
        || req.order_by.as_deref().is_some_and(|o| {
            parse_order_terms(o)
                .iter()
                .any(|(_, d)| d.is_some_and(|d| d.eq_ignore_ascii_case("DESC")))
        }) {
        Some("DESC")
    } else {
        Some("ASC")
    };

    // We fetch chunk_size + 1 rows to accurately determine has_more without an extra round-trip
    let fetch_limit = chunk_size + 1;

    let query = if keyset_eligible {
        build_keyset_chunk_query(
            dialect,
            &select_list,
            &table_ref,
            &pk.columns,
            &pk_column_types,
            &base_where,
            resolved_dir,
            req.last_primary_key_values.as_deref(),
            fetch_limit,
        )?
    } else {
        let order_clause =
            order_clause(dialect, req.order_by.as_deref(), req.order_dir.as_deref())?;
        let offset = req.offset;
        format!(
            "SELECT {select_list} FROM {table_ref}{base_where}{order_clause} LIMIT {fetch_limit} OFFSET {offset}"
        )
    };

    // The exact COUNT(*) is never on the critical path: on large InnoDB tables it
    // scans a whole index. The client requests it separately (`count_table_rows`).
    let total_rows_estimated = estimated_total.is_some();
    let total_rows = estimated_total;

    let mut data = backend.execute_query(&query, database).await?;

    let has_more = data.rows.len() > chunk_size as usize;
    if has_more {
        data.rows.truncate(chunk_size as usize);
    }

    let rows_count = data.rows.len() as u64;
    let next_offset = req.offset + rows_count;

    let column_types = data
        .columns
        .iter()
        .map(|col| {
            col_type_map
                .get(&col.to_lowercase())
                .cloned()
                .unwrap_or_else(|| "VARCHAR".to_string())
        })
        .collect();

    let next_primary_key_values = if !pk.columns.is_empty() {
        data.rows
            .last()
            .and_then(|last_row| extract_key_values(&data.columns, last_row, &pk.columns))
    } else {
        None
    };

    Ok(TableChunkResult {
        columns: data.columns,
        column_types,
        rows: data.rows,
        total_rows,
        total_rows_estimated,
        has_more,
        next_offset,
        next_primary_key_values,
        execution_time_ms: data.execution_time_ms,
    })
}

/// Returns true if `raw_type` is an integer or bounded text (CHAR/VARCHAR) type suitable for keyset pagination.
pub fn is_keyset_column_type(raw_type: &str) -> bool {
    let raw = raw_type.trim().to_ascii_uppercase();
    if raw.is_empty() {
        return false;
    }
    let base = raw
        .split(|c: char| c == '(' || c.is_whitespace())
        .next()
        .unwrap_or("");

    matches!(
        base,
        "INT" | "INTEGER" | "TINYINT" | "SMALLINT" | "MEDIUMINT" | "BIGINT" | "CHAR" | "VARCHAR"
    )
}

/// Checks if a cursor value looks truncated (e.g. from Fase 9 safe cell truncation).
pub fn is_truncated_cursor_value(v: &serde_json::Value) -> bool {
    if let serde_json::Value::String(s) = v {
        s.contains("… (+") || s.contains("... (+") || s.ends_with('…')
    } else {
        false
    }
}

/// Checks whether keyset pagination can be used based on primary key columns, their types,
/// and whether ordering and cursor values strictly align.
pub fn is_keyset_eligible(
    pk_columns: &[String],
    pk_column_types: &[String],
    order_by: Option<&str>,
    order_dir: Option<&str>,
    last_key: Option<&[serde_json::Value]>,
) -> bool {
    if pk_columns.is_empty() {
        return false;
    }

    // 1. All PK columns must have a valid keyset type (integer or char/varchar).
    if pk_column_types.len() != pk_columns.len() {
        return false;
    }
    if !pk_column_types.iter().all(|t| is_keyset_column_type(t)) {
        return false;
    }

    // 2. Cursor values must not be truncated.
    if let Some(keys) = last_key {
        if keys.iter().any(is_truncated_cursor_value) {
            return false;
        }
    }

    let Some(order_by) = order_by.map(str::trim).filter(|o| !o.is_empty()) else {
        return true; // Default order uses the primary key with order_dir
    };

    // 3. Parse terms in order_by: extract (column_name, Option<direction>)
    let terms = parse_order_terms(order_by);

    if terms.is_empty() || terms.len() != pk_columns.len() {
        return false;
    }

    // Check that column names match pk_columns in order
    let cols_match = terms
        .iter()
        .zip(pk_columns.iter())
        .all(|((col, _), pk)| col.eq_ignore_ascii_case(pk));
    if !cols_match {
        return false;
    }

    // 4. Validate directions: no mixed directions, and embedded must match order_dir
    let expected_dir = order_dir.map(str::trim).filter(|d| !d.is_empty()).map(|d| {
        if d.eq_ignore_ascii_case("DESC") {
            "DESC"
        } else {
            "ASC"
        }
    });

    let mut first_dir: Option<&'static str> = expected_dir;

    for &(_, embedded) in &terms {
        if let Some(dir) = embedded {
            let norm_embedded = if dir.eq_ignore_ascii_case("DESC") {
                "DESC"
            } else if dir.eq_ignore_ascii_case("ASC") {
                "ASC"
            } else {
                return false;
            };

            // If order_dir was provided, embedded must match it
            if let Some(expected) = expected_dir {
                if norm_embedded != expected {
                    return false;
                }
            }

            // All terms with explicit directions must agree
            if let Some(existing) = first_dir {
                if norm_embedded != existing {
                    return false; // Mixed directions!
                }
            } else {
                first_dir = Some(norm_embedded);
            }
        }
    }

    true
}

/// Constructs the keyset pagination query using row value comparison for composite keys
/// or simple column comparison for single-column keys.
#[allow(clippy::too_many_arguments)]
pub fn build_keyset_chunk_query(
    dialect: &dyn Dialect,
    select_list: &str,
    table_ref: &str,
    pk_columns: &[String],
    pk_column_types: &[String],
    base_where: &str,
    order_dir: Option<&str>,
    last_key: Option<&[serde_json::Value]>,
    chunk_size: u32,
) -> Result<String, PyroError> {
    let is_desc = order_dir.is_some_and(|d| d.eq_ignore_ascii_case("DESC"));
    let dir_str = if is_desc { "DESC" } else { "ASC" };
    let cmp_op = if is_desc { "<" } else { ">" };

    let quoted_pks = pk_columns
        .iter()
        .map(|c| dialect.quote_identifier(c.trim_matches(|ch| ch == '`' || ch == '"')))
        .collect::<Result<Vec<_>, _>>()?;

    let order_terms = quoted_pks
        .iter()
        .map(|col| format!("{col} {dir_str}"))
        .collect::<Vec<_>>()
        .join(", ");

    let keyset_condition = match last_key {
        Some(vals) if vals.len() == pk_columns.len() => {
            let literals = vals
                .iter()
                .enumerate()
                .map(|(i, v)| {
                    let col_type = pk_column_types.get(i).map(|s| s.as_str()).unwrap_or("");
                    crate::db::sql_dump::format_sql_value_typed(v, col_type)
                })
                .collect::<Vec<_>>()
                .join(", ");
            if quoted_pks.len() == 1 {
                Some(format!("{} {cmp_op} {literals}", quoted_pks[0]))
            } else {
                let col_tuple = quoted_pks.join(", ");
                Some(format!("({col_tuple}) {cmp_op} ({literals})"))
            }
        }
        _ => None,
    };

    let combined_where = match (base_where.trim(), keyset_condition) {
        ("", Some(kc)) => format!(" WHERE {kc}"),
        (w, Some(kc)) if w.starts_with("WHERE ") => {
            let inner = &w[6..];
            format!(" WHERE ({inner}) AND ({kc})")
        }
        (w, None) if !w.is_empty() => format!(" {w}"),
        _ => String::new(),
    };

    Ok(format!(
        "SELECT {select_list} FROM {table_ref}{combined_where} ORDER BY {order_terms} LIMIT {chunk_size}"
    ))
}

/// Extracts primary key values from a row given its column layout.
pub fn extract_key_values(
    columns: &[String],
    row: &[serde_json::Value],
    pk_columns: &[String],
) -> Option<Vec<serde_json::Value>> {
    let mut values = Vec::with_capacity(pk_columns.len());
    for pk in pk_columns {
        let idx = columns.iter().position(|c| c.eq_ignore_ascii_case(pk))?;
        values.push(row.get(idx)?.clone());
    }
    Some(values)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::dialect::MySqlDialect;

    #[test]
    fn order_clause_single_quoted_term_with_direction() {
        // The visual filter sends one sort rule as "`col` DESC".
        let d = MySqlDialect;
        assert_eq!(
            order_clause(&d, Some("`name` DESC"), None).unwrap(),
            " ORDER BY `name` DESC"
        );
        assert_eq!(
            order_clause(&d, Some("`name` ASC"), Some("DESC")).unwrap(),
            " ORDER BY `name` ASC"
        );
        assert_eq!(
            order_clause(&d, Some("name"), Some("DESC")).unwrap(),
            " ORDER BY `name` DESC"
        );
    }

    #[test]
    fn order_clause_quoted_names_with_spaces_and_commas() {
        let d = MySqlDialect;
        assert_eq!(
            order_clause(&d, Some("`full name` DESC, `a,b` ASC, `x``y`"), None).unwrap(),
            " ORDER BY `full name` DESC, `a,b` ASC, `x``y` ASC"
        );
    }

    #[test]
    fn test_is_keyset_eligible_and_type_restrictions() {
        let single_pk = vec!["id".to_string()];
        let int_type = vec!["int(11)".to_string()];
        let binary_type = vec!["binary(16)".to_string()];
        let varbinary_type = vec!["varbinary(64)".to_string()];
        let decimal_type = vec!["decimal(10,2)".to_string()];
        let varchar_type = vec!["varchar(255)".to_string()];

        // 1. PK entera -> keyset
        assert!(is_keyset_eligible(&single_pk, &int_type, None, None, None));
        assert!(is_keyset_eligible(
            &single_pk,
            &int_type,
            Some("id"),
            None,
            None
        ));
        assert!(is_keyset_eligible(
            &single_pk,
            &int_type,
            Some("`id` ASC"),
            Some("ASC"),
            None
        ));
        assert!(!is_keyset_eligible(
            &single_pk,
            &int_type,
            Some("name ASC"),
            None,
            None
        ));

        // 2. PK binaria, decimal o fecha -> OFFSET (no elegible)
        assert!(
            !is_keyset_eligible(&single_pk, &binary_type, None, None, None),
            "PK binary(16) debe usar OFFSET"
        );
        assert!(
            !is_keyset_eligible(&single_pk, &varbinary_type, None, None, None),
            "PK varbinary debe usar OFFSET"
        );
        assert!(
            !is_keyset_eligible(&single_pk, &decimal_type, None, None, None),
            "PK decimal debe usar OFFSET"
        );

        // 3. Composite PK con int + varchar -> keyset
        let composite_pk = vec!["tenant_id".to_string(), "user_code".to_string()];
        let composite_types = vec!["bigint".to_string(), "varchar(50)".to_string()];
        assert!(is_keyset_eligible(
            &composite_pk,
            &composite_types,
            None,
            None,
            None
        ));
        assert!(is_keyset_eligible(
            &composite_pk,
            &composite_types,
            Some("tenant_id, user_code"),
            None,
            None
        ));
        assert!(!is_keyset_eligible(
            &composite_pk,
            &composite_types,
            Some("tenant_id"),
            None,
            None
        ));

        // 4. Direcciones mezcladas -> no elegible
        assert!(
            !is_keyset_eligible(
                &composite_pk,
                &composite_types,
                Some("tenant_id ASC, user_code DESC"),
                None,
                None
            ),
            "Direcciones mezcladas (ASC + DESC) no deben ser elegibles"
        );

        // 5. Contradicción entre order_by embebido y order_dir -> no elegible
        assert!(
            !is_keyset_eligible(&single_pk, &int_type, Some("id DESC"), Some("ASC"), None),
            "Dirección embebida DESC no coincide con order_dir ASC"
        );

        // 6. Celdas truncadas (Fase 9) en el cursor -> no elegible
        let truncated_key = vec![serde_json::json!("cadena_muy_larga… (+15 KB)")];
        assert!(
            !is_keyset_eligible(&single_pk, &varchar_type, None, None, Some(&truncated_key)),
            "Cursor con celda truncada debe invalidar keyset y recurrir a OFFSET"
        );

        // Sin PK
        let no_pk: Vec<String> = vec![];
        let no_types: Vec<String> = vec![];
        assert!(!is_keyset_eligible(&no_pk, &no_types, None, None, None));
    }

    #[test]
    fn test_has_more_exact_block_lookahead() {
        let chunk_size = 50usize;

        // Caso A: El motor devolvió exactamente chunk_size filas (llegaron 50 cuando pedimos 51).
        // has_more debe ser FALSE sin necesidad de consulta adicional vacía.
        let mut rows_exact = vec![vec![serde_json::json!(1)]; chunk_size];
        let has_more_exact = rows_exact.len() > chunk_size;
        if has_more_exact {
            rows_exact.truncate(chunk_size);
        }
        assert!(
            !has_more_exact,
            "Bloque exacto devuelto debe resultar en has_more = false"
        );
        assert_eq!(rows_exact.len(), chunk_size);

        // Caso B: El motor devolvió chunk_size + 1 filas (llegaron 51 cuando pedimos 51).
        // has_more debe ser TRUE y el result debe truncarse a chunk_size (50 filas).
        let mut rows_plus_one = vec![vec![serde_json::json!(1)]; chunk_size + 1];
        let has_more_plus_one = rows_plus_one.len() > chunk_size;
        if has_more_plus_one {
            rows_plus_one.truncate(chunk_size);
        }
        assert!(
            has_more_plus_one,
            "Fila extra debe confirmar has_more = true"
        );
        assert_eq!(
            rows_plus_one.len(),
            chunk_size,
            "Las filas devueltas deben acotarse al chunk_size"
        );
    }

    #[test]
    fn test_build_keyset_chunk_query() {
        let dialect = MySqlDialect;
        let pk = vec!["id".to_string()];
        let pk_types = vec!["int".to_string()];

        // Initial chunk without last key
        let q1 = build_keyset_chunk_query(
            &dialect,
            "*",
            "`app`.`users`",
            &pk,
            &pk_types,
            "",
            None,
            None,
            500,
        )
        .unwrap();
        assert_eq!(
            q1,
            "SELECT * FROM `app`.`users` ORDER BY `id` ASC LIMIT 500"
        );

        // Next chunk with last key = 42
        let last_key = vec![serde_json::json!(42)];
        let q2 = build_keyset_chunk_query(
            &dialect,
            "*",
            "`app`.`users`",
            &pk,
            &pk_types,
            "",
            None,
            Some(&last_key),
            500,
        )
        .unwrap();
        assert_eq!(
            q2,
            "SELECT * FROM `app`.`users` WHERE `id` > 42 ORDER BY `id` ASC LIMIT 500"
        );

        // With existing filter
        let q3 = build_keyset_chunk_query(
            &dialect,
            "*",
            "`app`.`users`",
            &pk,
            &pk_types,
            " WHERE status = 'active'",
            Some("DESC"),
            Some(&last_key),
            200,
        )
        .unwrap();
        assert_eq!(
            q3,
            "SELECT * FROM `app`.`users` WHERE (status = 'active') AND (`id` < 42) ORDER BY `id` DESC LIMIT 200"
        );

        // VARCHAR primary key with value starting with "0xAB" must remain quoted as a string
        let varchar_pk = vec!["code".to_string()];
        let varchar_pk_types = vec!["varchar(50)".to_string()];
        let varchar_key = vec![serde_json::json!("0xAB")];
        let q4 = build_keyset_chunk_query(
            &dialect,
            "*",
            "`app`.`items`",
            &varchar_pk,
            &varchar_pk_types,
            "",
            None,
            Some(&varchar_key),
            50,
        )
        .unwrap();
        assert_eq!(
            q4,
            "SELECT * FROM `app`.`items` WHERE `code` > '0xAB' ORDER BY `code` ASC LIMIT 50"
        );
    }
}

#[cfg(test)]
mod duplicate_tests {
    use super::sqlite_create_with_name;

    #[test]
    fn sqlite_copy_keeps_the_column_definitions() {
        let sql = sqlite_create_with_name(
            "CREATE TABLE \"clientes\" (id INTEGER PRIMARY KEY, nombre TEXT)",
            "\"main\".\"clientes_copia\"",
        )
        .unwrap();
        assert_eq!(
            sql,
            "CREATE TABLE \"main\".\"clientes_copia\" (id INTEGER PRIMARY KEY, nombre TEXT);"
        );
    }
}
