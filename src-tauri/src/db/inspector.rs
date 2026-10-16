use super::backend::DatabaseBackend;
use super::diff::fetch_schema_foreign_keys;
use super::error::PyroError;
use super::index::list_indexes;
use super::models::{TableExtendedStats, TableInspectorDetails};
use super::query::value_to_i64;
use super::sql_utils::qualify_table;
use super::table::get_table_columns;
use super::trigger::list_triggers;

/// Gathers comprehensive table inspection details (structure, indexes, FKs, triggers, stats, and DDL).
pub async fn get_table_inspector_details(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
) -> Result<TableInspectorDetails, PyroError> {
    let clean_tbl = table.replace('\'', "''");
    let status_sql = format!("SHOW TABLE STATUS WHERE Name = '{clean_tbl}'");
    let qualified = qualify_table(Some(database), table)?;
    let ddl_sql = format!("SHOW CREATE TABLE {qualified}");
    let batch_queries = [status_sql.as_str(), ddl_sql.as_str()];

    let (structure_res, indexes_res, fks_res, triggers_res, status_ddl_batch) = tokio::join!(
        get_table_columns(backend, database, table),
        list_indexes(backend, database, table),
        fetch_schema_foreign_keys(backend, database),
        list_triggers(backend, database, None),
        backend.execute_batch(&batch_queries, Some(database))
    );

    let structure = structure_res?;
    let indexes = indexes_res.unwrap_or_default();
    let foreign_keys = fks_res
        .unwrap_or_default()
        .get(table)
        .cloned()
        .unwrap_or_default();
    let triggers = triggers_res
        .unwrap_or_default()
        .into_iter()
        .filter(|t| t.table_name.eq_ignore_ascii_case(table))
        .collect();

    let (status_res, ddl_res_opt) = match status_ddl_batch {
        Ok(mut batch) if batch.len() == 2 => {
            let ddl_res = batch.pop();
            let st_res = batch.pop();
            (st_res, ddl_res)
        }
        _ => (
            backend
                .execute_query(&status_sql, Some(database))
                .await
                .ok(),
            backend.execute_query(&ddl_sql, Some(database)).await.ok(),
        ),
    };

    let mut stats = TableExtendedStats {
        table_name: table.to_string(),
        database_name: database.to_string(),
        engine: "InnoDB".to_string(),
        row_format: None,
        table_rows: 0,
        avg_row_length: 0,
        data_length: 0,
        index_length: 0,
        data_free: 0,
        auto_increment: None,
        create_time: None,
        update_time: None,
        check_time: None,
        collation: None,
        comment: None,
    };

    if let Some(res) = status_res {
        if let Some(row) = res.rows.first() {
            let cols_lower: Vec<String> = res.columns.iter().map(|c| c.to_lowercase()).collect();
            let get_col = |name: &str| -> Option<&serde_json::Value> {
                cols_lower
                    .iter()
                    .position(|c| c == name)
                    .and_then(|i| row.get(i))
            };

            if let Some(v) = get_col("engine").and_then(|v| v.as_str()) {
                stats.engine = v.to_string();
            }
            if let Some(v) = get_col("row_format").and_then(|v| v.as_str()) {
                stats.row_format = Some(v.to_string());
            }
            if let Some(v) = get_col("rows").and_then(value_to_i64) {
                stats.table_rows = v;
            }
            if let Some(v) = get_col("avg_row_length").and_then(value_to_i64) {
                stats.avg_row_length = v;
            }
            if let Some(v) = get_col("data_length").and_then(value_to_i64) {
                stats.data_length = v;
            }
            if let Some(v) = get_col("index_length").and_then(value_to_i64) {
                stats.index_length = v;
            }
            if let Some(v) = get_col("data_free").and_then(value_to_i64) {
                stats.data_free = v;
            }
            if let Some(v) = get_col("auto_increment").and_then(value_to_i64) {
                stats.auto_increment = Some(v);
            }
            stats.create_time = get_col("create_time")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            stats.update_time = get_col("update_time")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            stats.check_time = get_col("check_time")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            stats.collation = get_col("collation")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            stats.comment = get_col("comment")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
        }
    }

    // 6. DDL from SHOW CREATE TABLE
    let ddl = match ddl_res_opt {
        Some(res) => {
            if let Some(row) = res.rows.first() {
                row.get(1)
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string()
            } else {
                String::new()
            }
        }
        None => String::new(),
    };

    Ok(TableInspectorDetails {
        structure,
        indexes,
        foreign_keys,
        triggers,
        statistics: stats,
        ddl,
    })
}
