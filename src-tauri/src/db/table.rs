use super::backend::DatabaseBackend;
use super::dialect::Dialect;
use super::error::PyroError;
use super::introspect::introspector;
use super::models::{
    ColumnMetadata, PrimaryKey, TableChunkRequest, TableChunkResult, TableDataRequest,
    TableDataResult, TableMetadata,
};
use super::query::value_to_i64;
use super::row_filter::target_database;
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
    let total_rows = count_rows(backend, &count_query, database).await;
    let data = backend.execute_query(&data_query, database).await?;
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
    let terms = if order_by.contains(',') {
        order_by
            .split(',')
            .filter_map(|term| {
                let mut tokens = term.split_whitespace();
                let column = tokens.next()?;
                Some(sort_term(dialect, column, tokens.next()))
            })
            .collect::<Result<Vec<_>, _>>()?
    } else {
        vec![sort_term(dialect, order_by, order_dir)?]
    };
    if terms.is_empty() {
        return Ok(String::new());
    }
    Ok(format!(" ORDER BY {}", terms.join(", ")))
}

fn sort_term(
    dialect: &dyn Dialect,
    column: &str,
    direction: Option<&str>,
) -> Result<String, PyroError> {
    let column = dialect.quote_identifier(column.trim_matches(|c| c == '`' || c == '"'))?;
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

    // Retrieve primary key definition
    let pk = get_table_primary_key(backend, &req.database, &req.table)
        .await
        .unwrap_or(PrimaryKey { columns: vec![] });

    let keyset_eligible = is_keyset_eligible(&pk.columns, req.order_by.as_deref());

    let query = if keyset_eligible {
        build_keyset_chunk_query(
            dialect,
            &select_list,
            &table_ref,
            &pk.columns,
            &base_where,
            req.order_dir.as_deref(),
            req.last_primary_key_values.as_deref(),
            chunk_size,
        )?
    } else {
        let order_clause =
            order_clause(dialect, req.order_by.as_deref(), req.order_dir.as_deref())?;
        let offset = req.offset;
        format!(
            "SELECT {select_list} FROM {table_ref}{base_where}{order_clause} LIMIT {chunk_size} OFFSET {offset}"
        )
    };

    let total_rows = if req.include_total_count {
        let count_query = format!("SELECT COUNT(*) AS total FROM {table_ref}{base_where}");
        count_rows(backend, &count_query, database).await
    } else {
        None
    };

    let data = backend.execute_query(&query, database).await?;
    let column_types = column_types(backend, &req.database, &req.table, &data.columns).await;

    let rows_count = data.rows.len() as u64;
    let has_more = rows_count == chunk_size as u64;
    let next_offset = req.offset + rows_count;

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
        has_more,
        next_offset,
        next_primary_key_values,
        execution_time_ms: data.execution_time_ms,
    })
}

/// Checks whether keyset pagination can be used based on primary key and ordering.
pub fn is_keyset_eligible(pk_columns: &[String], order_by: Option<&str>) -> bool {
    if pk_columns.is_empty() {
        return false;
    }
    let Some(order_by) = order_by.map(str::trim).filter(|o| !o.is_empty()) else {
        return true; // Default order uses the primary key
    };

    let order_cols: Vec<&str> = order_by
        .split(',')
        .filter_map(|t| {
            t.split_whitespace()
                .next()
                .map(|c| c.trim_matches(|ch| ch == '`' || ch == '"'))
        })
        .collect();

    if order_cols.len() == pk_columns.len() {
        order_cols
            .iter()
            .zip(pk_columns.iter())
            .all(|(oc, pk)| oc.eq_ignore_ascii_case(pk))
    } else if order_cols.len() == 1 && pk_columns.len() == 1 {
        order_cols[0].eq_ignore_ascii_case(&pk_columns[0])
    } else {
        false
    }
}

/// Constructs the keyset pagination query using row value comparison for composite keys
/// or simple column comparison for single-column keys.
pub fn build_keyset_chunk_query(
    dialect: &dyn Dialect,
    select_list: &str,
    table_ref: &str,
    pk_columns: &[String],
    base_where: &str,
    order_dir: Option<&str>,
    last_key: Option<&[serde_json::Value]>,
    chunk_size: u32,
) -> Result<String, PyroError> {
    let is_desc = order_dir.map_or(false, |d| d.eq_ignore_ascii_case("DESC"));
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
                .map(crate::db::sql_dump::format_sql_value)
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
    fn test_is_keyset_eligible() {
        let single_pk = vec!["id".to_string()];
        assert!(is_keyset_eligible(&single_pk, None));
        assert!(is_keyset_eligible(&single_pk, Some("id")));
        assert!(is_keyset_eligible(&single_pk, Some("`id` ASC")));
        assert!(!is_keyset_eligible(&single_pk, Some("name ASC")));

        let composite_pk = vec!["tenant_id".to_string(), "user_id".to_string()];
        assert!(is_keyset_eligible(&composite_pk, None));
        assert!(is_keyset_eligible(
            &composite_pk,
            Some("tenant_id, user_id")
        ));
        assert!(!is_keyset_eligible(&composite_pk, Some("tenant_id")));

        let no_pk: Vec<String> = vec![];
        assert!(!is_keyset_eligible(&no_pk, None));
    }

    #[test]
    fn test_build_keyset_chunk_query() {
        let dialect = MySqlDialect;
        let pk = vec!["id".to_string()];

        // Initial chunk without last key
        let q1 = build_keyset_chunk_query(&dialect, "*", "`app`.`users`", &pk, "", None, None, 500)
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
    }
}
