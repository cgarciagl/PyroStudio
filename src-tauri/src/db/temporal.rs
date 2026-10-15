use super::backend::DatabaseBackend;
use super::error::PyroError;
use super::models::SystemVersionedTableInfo;
use super::query::value_to_i64;
use super::sql_utils::quote_identifier;

/// Inspects whether a table has system versioning enabled and its temporal bounds.
pub async fn inspect_system_versioning(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
) -> Result<SystemVersionedTableInfo, PyroError> {
    let clean_db = database.replace('\'', "''");
    let clean_tbl = table.replace('\'', "''");

    // 1. Check if TABLE_TYPE is SYSTEM VERSIONED or columns have ROW START/END
    let type_sql = format!(
        r#"
        SELECT TABLE_TYPE
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = '{clean_db}' AND TABLE_NAME = '{clean_tbl}'
        LIMIT 1;
        "#
    );

    let is_type_sys_ver = if let Ok(res) = backend.execute_query(&type_sql, Some(database)).await {
        res.rows
            .first()
            .and_then(|r| r.first())
            .and_then(|v| v.as_str())
            .map(|t| t.to_uppercase().contains("SYSTEM VERSIONED"))
            .unwrap_or(false)
    } else {
        false
    };

    // 2. Check columns with ROW START / ROW END in extra
    let cols_sql = format!(
        r#"
        SELECT COLUMN_NAME, EXTRA
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = '{clean_db}' AND TABLE_NAME = '{clean_tbl}'
        "#
    );

    let mut row_start_col = None;
    let mut row_end_col = None;

    if let Ok(cres) = backend.execute_query(&cols_sql, Some(database)).await {
        for r in cres.rows {
            let col = r
                .first()
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let extra = r
                .get(1)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_uppercase();
            if extra.contains("ROW START") {
                row_start_col = Some(col);
            } else if extra.contains("ROW END") {
                row_end_col = Some(col);
            }
        }
    }

    // 3. Fallback to check SHOW CREATE TABLE
    let is_system_versioned = is_type_sys_ver || row_start_col.is_some() || {
        let q_db = quote_identifier(database)?;
        let q_tbl = quote_identifier(table)?;
        let ddl_sql = format!("SHOW CREATE TABLE {q_db}.{q_tbl}");
        if let Ok(ddl_res) = backend.execute_query(&ddl_sql, Some(database)).await {
            ddl_res
                .rows
                .first()
                .and_then(|r| r.get(1))
                .and_then(|v| v.as_str())
                .map(|s| s.to_uppercase().contains("WITH SYSTEM VERSIONING"))
                .unwrap_or(false)
        } else {
            false
        }
    };

    // 4. If system versioned, count current vs historical rows
    let (current_rows, history_rows) = if is_system_versioned {
        let q_db = quote_identifier(database)?;
        let q_tbl = quote_identifier(table)?;

        let cur_count_sql = format!("SELECT COUNT(*) FROM {q_db}.{q_tbl};");
        let all_count_sql = format!("SELECT COUNT(*) FROM {q_db}.{q_tbl} FOR SYSTEM_TIME ALL;");

        let cur_cnt = backend
            .execute_query(&cur_count_sql, Some(database))
            .await
            .ok()
            .and_then(|r| r.rows.first().cloned())
            .and_then(|r| r.first().cloned())
            .and_then(|v| value_to_i64(&v));

        let all_cnt = backend
            .execute_query(&all_count_sql, Some(database))
            .await
            .ok()
            .and_then(|r| r.rows.first().cloned())
            .and_then(|r| r.first().cloned())
            .and_then(|v| value_to_i64(&v));

        let hist_cnt = match (all_cnt, cur_cnt) {
            (Some(all), Some(cur)) if all >= cur => Some(all - cur),
            _ => None,
        };

        (cur_cnt, hist_cnt)
    } else {
        (None, None)
    };

    Ok(SystemVersionedTableInfo {
        table_name: table.to_string(),
        is_system_versioned,
        row_start_column: row_start_col,
        row_end_column: row_end_col,
        history_rows_count: history_rows,
        current_rows_count: current_rows,
    })
}

/// Generates a standardized FOR SYSTEM_TIME SQL statement for exploring historical rows.
pub fn build_temporal_query(
    database: &str,
    table: &str,
    mode: &str, // "ALL" | "AS_OF" | "BETWEEN"
    timestamp_param: Option<&str>,
    timestamp_end_param: Option<&str>,
    limit: u32,
) -> Result<String, PyroError> {
    let q_db = quote_identifier(database)?;
    let q_tbl = quote_identifier(table)?;

    let temporal_clause = match mode.to_uppercase().as_str() {
        "ALL" => "FOR SYSTEM_TIME ALL".to_string(),
        "AS_OF" => {
            let ts = timestamp_param.unwrap_or("NOW()");
            let clean_ts = ts.replace('\'', "''");
            if ts.eq_ignore_ascii_case("NOW()") {
                "FOR SYSTEM_TIME AS OF NOW()".to_string()
            } else {
                format!("FOR SYSTEM_TIME AS OF TIMESTAMP '{clean_ts}'")
            }
        }
        "BETWEEN" => {
            let ts1 = timestamp_param
                .unwrap_or("NOW() - INTERVAL 1 DAY")
                .replace('\'', "''");
            let ts2 = timestamp_end_param.unwrap_or("NOW()").replace('\'', "''");
            format!("FOR SYSTEM_TIME BETWEEN TIMESTAMP '{ts1}' AND TIMESTAMP '{ts2}'")
        }
        _ => "FOR SYSTEM_TIME ALL".to_string(),
    };

    Ok(format!(
        "SELECT * FROM {q_db}.{q_tbl} {temporal_clause} LIMIT {limit};"
    ))
}
