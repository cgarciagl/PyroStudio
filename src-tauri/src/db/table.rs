use super::backend::DatabaseBackend;
use super::dialect::Dialect;
use super::error::PyroError;
use super::introspect::introspector;
use super::models::{ColumnMetadata, PrimaryKey, TableDataRequest, TableDataResult, TableMetadata};
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
