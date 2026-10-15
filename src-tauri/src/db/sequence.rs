use super::backend::DatabaseBackend;
use super::error::PyroError;
use super::models::{SequenceDetail, SequenceMetadata};
use super::query::value_to_i64;
use super::sql_utils::quote_identifier;

/// Lists all sequences in the specified database.
pub async fn list_sequences(
    backend: &dyn DatabaseBackend,
    database: &str,
) -> Result<Vec<SequenceMetadata>, PyroError> {
    let clean_db = database.replace('\'', "''");

    // 1. Find all tables with TABLE_TYPE = 'SEQUENCE'
    let sql = format!(
        r#"
        SELECT TABLE_NAME, TABLE_COMMENT
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = '{clean_db}' AND TABLE_TYPE = 'SEQUENCE'
        ORDER BY TABLE_NAME ASC
        "#
    );

    let res = backend.execute_query(&sql, Some(database)).await?;
    let mut sequences = Vec::new();

    for r in res.rows {
        let name = r
            .first()
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        if name.is_empty() {
            continue;
        }
        let comment = r.get(1).and_then(|v| v.as_str()).map(|s| s.to_string());

        // Try reading sequence internal row: `SELECT * FROM \`db\`.\`seq\``
        let (next_val, min_val, max_val, start_val, incr, cache, cycle) = if let Ok(q_db) =
            quote_identifier(database)
        {
            if let Ok(q_seq) = quote_identifier(&name) {
                let seq_row_sql = format!("SELECT next_not_cached_value, minimum_value, maximum_value, start_value, increment, cache_size, cycle_option FROM {q_db}.{q_seq} LIMIT 1;");
                if let Ok(seq_res) = backend.execute_query(&seq_row_sql, Some(database)).await {
                    if let Some(sr) = seq_res.rows.first() {
                        let next = sr.first().and_then(value_to_i64);
                        let min = sr.get(1).and_then(value_to_i64);
                        let max = sr.get(2).and_then(value_to_i64);
                        let start = sr.get(3).and_then(value_to_i64);
                        let inc = sr.get(4).and_then(value_to_i64);
                        let c_sz = sr.get(5).and_then(value_to_i64);
                        let cyc = sr
                            .get(6)
                            .and_then(value_to_i64)
                            .map(|v| v != 0)
                            .unwrap_or(false);
                        (next, min, max, start, inc, c_sz, cyc)
                    } else {
                        (None, None, None, None, None, None, false)
                    }
                } else {
                    (None, None, None, None, None, None, false)
                }
            } else {
                (None, None, None, None, None, None, false)
            }
        } else {
            (None, None, None, None, None, None, false)
        };

        sequences.push(SequenceMetadata {
            name,
            next_value: next_val,
            min_value: min_val,
            max_value: max_val,
            start: start_val,
            increment: incr,
            cache_size: cache,
            cycle,
            comment,
        });
    }

    Ok(sequences)
}

/// Retrieves the DDL and metadata for a sequence.
pub async fn get_sequence_definition(
    backend: &dyn DatabaseBackend,
    database: &str,
    sequence_name: &str,
) -> Result<SequenceDetail, PyroError> {
    let q_db = quote_identifier(database)?;
    let q_seq = quote_identifier(sequence_name)?;

    // In MariaDB, SHOW CREATE SEQUENCE or SHOW CREATE TABLE
    let ddl_sql = format!("SHOW CREATE SEQUENCE {q_db}.{q_seq}");
    let ddl = match backend.execute_query(&ddl_sql, Some(database)).await {
        Ok(res) => res
            .rows
            .first()
            .and_then(|r| r.get(1))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        Err(_) => {
            // Fallback to SHOW CREATE TABLE
            let fallback_sql = format!("SHOW CREATE TABLE {q_db}.{q_seq}");
            let res = backend.execute_query(&fallback_sql, Some(database)).await?;
            res.rows
                .first()
                .and_then(|r| r.get(1))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        }
    };

    // Query sequence metadata
    let seq_row_sql = format!("SELECT next_not_cached_value, minimum_value, maximum_value, start_value, increment, cache_size, cycle_option FROM {q_db}.{q_seq} LIMIT 1;");
    let (next_val, min_val, max_val, start_val, incr, cache, cycle) =
        if let Ok(seq_res) = backend.execute_query(&seq_row_sql, Some(database)).await {
            if let Some(sr) = seq_res.rows.first() {
                let next = sr.first().and_then(value_to_i64);
                let min = sr.get(1).and_then(value_to_i64);
                let max = sr.get(2).and_then(value_to_i64);
                let start = sr.get(3).and_then(value_to_i64);
                let inc = sr.get(4).and_then(value_to_i64);
                let c_sz = sr.get(5).and_then(value_to_i64);
                let cyc = sr
                    .get(6)
                    .and_then(value_to_i64)
                    .map(|v| v != 0)
                    .unwrap_or(false);
                (next, min, max, start, inc, c_sz, cyc)
            } else {
                (None, None, None, None, None, None, false)
            }
        } else {
            (None, None, None, None, None, None, false)
        };

    let properties = SequenceMetadata {
        name: sequence_name.to_string(),
        next_value: next_val,
        min_value: min_val,
        max_value: max_val,
        start: start_val,
        increment: incr,
        cache_size: cache,
        cycle,
        comment: None,
    };

    Ok(SequenceDetail {
        name: sequence_name.to_string(),
        ddl,
        properties,
    })
}

/// Drops a sequence safely.
pub async fn drop_sequence(
    backend: &dyn DatabaseBackend,
    database: &str,
    sequence_name: &str,
) -> Result<(), PyroError> {
    let q_db = quote_identifier(database)?;
    let q_seq = quote_identifier(sequence_name)?;
    let sql = format!("DROP SEQUENCE IF EXISTS {q_db}.{q_seq};");

    backend.execute_query(&sql, Some(database)).await?;
    Ok(())
}
