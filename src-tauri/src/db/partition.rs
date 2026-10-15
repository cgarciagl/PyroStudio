use super::backend::DatabaseBackend;
use super::error::PyroError;
use super::models::{PartitionMetadata, TablePartitioningInfo};
use super::query::value_to_i64;

/// Retrieves partitioning metadata for a specific table.
pub async fn get_table_partitions(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
) -> Result<TablePartitioningInfo, PyroError> {
    let clean_db = database.replace('\'', "''");
    let clean_tbl = table.replace('\'', "''");

    let sql = format!(
        r#"
        SELECT
            PARTITION_NAME,
            SUBPARTITION_NAME,
            PARTITION_ORDINAL_POSITION,
            PARTITION_METHOD,
            PARTITION_EXPRESSION,
            PARTITION_DESCRIPTION,
            TABLE_ROWS,
            AVG_ROW_LENGTH,
            DATA_LENGTH,
            INDEX_LENGTH
        FROM information_schema.PARTITIONS
        WHERE TABLE_SCHEMA = '{clean_db}' AND TABLE_NAME = '{clean_tbl}'
        ORDER BY PARTITION_ORDINAL_POSITION ASC;
        "#
    );

    let res = backend.execute_query(&sql, Some(database)).await?;
    let mut partitions = Vec::new();
    let mut is_partitioned = false;
    let mut partition_method = None;
    let mut partition_expression = None;

    for r in res.rows {
        let p_name = r.first().and_then(|v| v.as_str());
        // If partition_name is NULL or empty, the table is not partitioned
        if let Some(p_name_str) = p_name {
            if !p_name_str.is_empty() {
                is_partitioned = true;
                let subpart_name = r.get(1).and_then(|v| v.as_str()).map(|s| s.to_string());
                let pos = r.get(2).and_then(value_to_i64).unwrap_or(1) as u32;
                let method = r.get(3).and_then(|v| v.as_str()).map(|s| s.to_string());
                let expr = r.get(4).and_then(|v| v.as_str()).map(|s| s.to_string());
                let desc = r.get(5).and_then(|v| v.as_str()).map(|s| s.to_string());
                let rows = r.get(6).and_then(value_to_i64).unwrap_or(0);
                let avg_len = r.get(7).and_then(value_to_i64).unwrap_or(0);
                let data_len = r.get(8).and_then(value_to_i64).unwrap_or(0);
                let idx_len = r.get(9).and_then(value_to_i64).unwrap_or(0);

                if partition_method.is_none() && method.is_some() {
                    partition_method = method.clone();
                }
                if partition_expression.is_none() && expr.is_some() {
                    partition_expression = expr.clone();
                }

                partitions.push(PartitionMetadata {
                    partition_name: p_name_str.to_string(),
                    subpartition_name: subpart_name,
                    partition_ordinal_position: pos,
                    partition_method: method,
                    partition_expression: expr,
                    partition_description: desc,
                    table_rows: rows,
                    avg_row_length: avg_len,
                    data_length: data_len,
                    index_length: idx_len,
                });
            }
        }
    }

    Ok(TablePartitioningInfo {
        table_name: table.to_string(),
        is_partitioned,
        partition_method,
        partition_expression,
        partitions,
    })
}
