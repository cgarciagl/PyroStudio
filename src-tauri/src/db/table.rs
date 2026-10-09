use std::collections::HashMap;
use super::backend::DatabaseBackend;
use super::error::PyroError;
use super::models::{ColumnMetadata, PrimaryKey, TableDataResult, TableMetadata};
use super::query::value_to_i64;
use super::sql_utils::qualify_table;

/// Lists all tables in the specified database.
pub async fn list_tables(
    backend: &dyn DatabaseBackend,
    database: &str,
) -> Result<Vec<TableMetadata>, PyroError> {
    let clean_db = database.replace('\'', "''");
    let sql = format!(
        r#"
        SELECT 
            TABLE_NAME,
            TABLE_TYPE,
            ENGINE,
            TABLE_ROWS,
            DATA_LENGTH,
            TABLE_COLLATION,
            TABLE_COMMENT
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = '{clean_db}'
        ORDER BY TABLE_TYPE ASC, TABLE_NAME ASC
        "#
    );

    let res = backend.execute_query(&sql, Some(database)).await?;
    let mut tables = Vec::new();

    for row in res.rows {
        let name = row
            .get(0)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let table_type = row
            .get(1)
            .and_then(|v| v.as_str())
            .unwrap_or("BASE TABLE")
            .to_string();
        let engine = row.get(2).and_then(|v| v.as_str()).map(|s| s.to_string());
        let rows_count = row.get(3).and_then(value_to_i64);
        let data_length = row.get(4).and_then(value_to_i64);
        let collation = row.get(5).and_then(|v| v.as_str()).map(|s| s.to_string());
        let comment = row.get(6).and_then(|v| v.as_str()).map(|s| s.to_string());

        if !name.is_empty() {
            tables.push(TableMetadata {
                name,
                table_type,
                engine,
                rows_count,
                data_length,
                collation,
                comment,
            });
        }
    }

    Ok(tables)
}

/// Retrieves all column details for a given table.
pub async fn get_table_columns(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
) -> Result<Vec<ColumnMetadata>, PyroError> {
    let clean_db = database.replace('\'', "''");
    let clean_tbl = table.replace('\'', "''");

    let sql = format!(
        r#"
        SELECT 
            COLUMN_NAME,
            ORDINAL_POSITION,
            COLUMN_DEFAULT,
            IS_NULLABLE,
            DATA_TYPE,
            COLUMN_TYPE,
            COLUMN_KEY,
            EXTRA,
            COLUMN_COMMENT,
            COLLATION_NAME,
            CHARACTER_SET_NAME
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = '{clean_db}' AND TABLE_NAME = '{clean_tbl}'
        ORDER BY ORDINAL_POSITION ASC
        "#
    );

    let res = backend.execute_query(&sql, Some(database)).await?;
    let mut columns = Vec::new();

    for row in res.rows {
        let name = row
            .get(0)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let ordinal_position = row
            .get(1)
            .and_then(value_to_i64)
            .map(|n| n as i32)
            .unwrap_or(0);
        let column_default = row.get(2).and_then(|v| v.as_str()).map(|s| s.to_string());
        let is_nullable = row
            .get(3)
            .and_then(|v| v.as_str())
            .map(|s| s.eq_ignore_ascii_case("YES"))
            .unwrap_or(false);
        let data_type = row
            .get(4)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let column_type = row
            .get(5)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let column_key = row
            .get(6)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let extra = row
            .get(7)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let comment = row
            .get(8)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let collation = row.get(9).and_then(|v| v.as_str()).map(|s| s.to_string());
        let character_set = row.get(10).and_then(|v| v.as_str()).map(|s| s.to_string());

        if !name.is_empty() {
            columns.push(ColumnMetadata {
                name,
                ordinal_position,
                column_default,
                is_nullable,
                data_type,
                column_type,
                column_key,
                extra,
                comment,
                collation,
                character_set,
            });
        }
    }

    Ok(columns)
}

/// Retrieves the ordered list of primary key columns for a table.
/// Returns empty if table has no primary key.
pub async fn get_table_primary_key(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
) -> Result<PrimaryKey, PyroError> {
    let clean_db = database.replace('\'', "''");
    let clean_tbl = table.replace('\'', "''");

    let sql = format!(
        r#"
        SELECT COLUMN_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = '{clean_db}' 
          AND TABLE_NAME = '{clean_tbl}' 
          AND CONSTRAINT_NAME = 'PRIMARY'
        ORDER BY ORDINAL_POSITION ASC
        "#
    );

    let res = backend.execute_query(&sql, Some(database)).await?;
    let mut columns = Vec::new();
    for row in res.rows {
        if let Some(col) = row.first().and_then(|v| v.as_str()) {
            if !col.is_empty() {
                columns.push(col.to_string());
            }
        }
    }

    Ok(PrimaryKey { columns })
}

/// Queries paginated table data.
pub async fn query_table_data(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
    limit: u32,
    offset: u32,
) -> Result<TableDataResult, PyroError> {
    let db_arg = if database.trim().is_empty() {
        None
    } else {
        Some(database)
    };
    let table_ref = qualify_table(db_arg, table)?;

    let count_query = format!("SELECT COUNT(*) AS total FROM {table_ref}");
    let total_rows = match backend.execute_query(&count_query, db_arg).await {
        Ok(res) => res
            .rows
            .first()
            .and_then(|r| r.first().and_then(value_to_i64)),
        Err(_) => None,
    };

    let safe_limit = limit.min(10_000);
    let query_str = format!("SELECT * FROM {table_ref} LIMIT {safe_limit} OFFSET {offset}");
    let query_res = backend.execute_query(&query_str, db_arg).await?;

    let column_types = query_res
        .columns
        .iter()
        .map(|_| "VARCHAR".to_string())
        .collect();

    Ok(TableDataResult {
        columns: query_res.columns,
        column_types,
        rows: query_res.rows,
        total_rows,
        execution_time_ms: query_res.execution_time_ms,
        limit: safe_limit,
        offset,
    })
}

/// Drops a table.
pub async fn drop_table(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
) -> Result<(), PyroError> {
    let db_arg = if database.trim().is_empty() {
        None
    } else {
        Some(database)
    };
    let table_ref = qualify_table(db_arg, table)?;
    let sql = format!("DROP TABLE {table_ref};");
    backend.execute_query(&sql, db_arg).await?;
    Ok(())
}

/// Truncates a table.
pub async fn truncate_table(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
) -> Result<(), PyroError> {
    let db_arg = if database.trim().is_empty() {
        None
    } else {
        Some(database)
    };
    let table_ref = qualify_table(db_arg, table)?;
    let sql = format!("TRUNCATE TABLE {table_ref};");
    backend.execute_query(&sql, db_arg).await?;
    Ok(())
}

/// Retrieves a mapping of all table names to their column names in a database for autocompletion.
pub async fn get_database_completion_schema(
    backend: &dyn DatabaseBackend,
    database: &str,
) -> Result<HashMap<String, Vec<String>>, PyroError> {
    let clean_db = database.replace('\'', "''");
    let sql = format!(
        r#"
        SELECT TABLE_NAME, COLUMN_NAME
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = '{clean_db}'
        ORDER BY TABLE_NAME ASC, ORDINAL_POSITION ASC
        "#
    );

    let res = backend.execute_query(&sql, Some(database)).await?;
    let mut map: HashMap<String, Vec<String>> = HashMap::new();

    for row in res.rows {
        if let (Some(tbl), Some(col)) = (
            row.get(0).and_then(|v| v.as_str()),
            row.get(1).and_then(|v| v.as_str()),
        ) {
            map.entry(tbl.to_string()).or_default().push(col.to_string());
        }
    }

    Ok(map)
}

