use super::backend::DatabaseBackend;
use super::error::PyroError;
use super::models::TableOperationResult;
use super::sql_utils::qualify_table;
use std::time::Instant;

/// Executes administrative table maintenance operations (ANALYZE, OPTIMIZE, CHECK, REPAIR)
pub async fn execute_table_operation(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
    operation: &str,
) -> Result<TableOperationResult, PyroError> {
    let qualified = qualify_table(Some(database), table)?;
    let start = Instant::now();

    let sql = match operation.to_uppercase().as_str() {
        "ANALYZE" => format!("ANALYZE TABLE {qualified};"),
        "OPTIMIZE" => format!("OPTIMIZE TABLE {qualified};"),
        "CHECK" => format!("CHECK TABLE {qualified};"),
        "REPAIR" => format!("REPAIR TABLE {qualified};"),
        "CHECKSUM" => format!("CHECKSUM TABLE {qualified};"),
        _ => {
            return Err(PyroError::InvalidOperation(format!(
                "Operación administrativa '{operation}' no reconocida o no permitida."
            )))
        }
    };

    let res = backend.execute_query(&sql, Some(database)).await?;
    let duration_ms = start.elapsed().as_millis() as u64;

    let mut msg_type = "status".to_string();
    let mut msg_text = "OK".to_string();

    if let Some(row) = res.rows.first() {
        if row.len() >= 4 {
            msg_type = row[2].as_str().unwrap_or("status").to_string();
            msg_text = row[3].as_str().unwrap_or("OK").to_string();
        } else if let Some(last_val) = row.last() {
            msg_text = last_val.as_str().unwrap_or("OK").to_string();
        }
    }

    Ok(TableOperationResult {
        database: database.to_string(),
        table: table.to_string(),
        operation: operation.to_uppercase(),
        msg_type,
        msg_text,
        duration_ms,
    })
}

/// Executes safe flush or maintenance operations
pub async fn execute_maintenance_flush(
    backend: &dyn DatabaseBackend,
    flush_type: &str,
) -> Result<String, PyroError> {
    let sql = match flush_type.to_uppercase().as_str() {
        "TABLES" => "FLUSH TABLES;",
        "PRIVILEGES" => "FLUSH PRIVILEGES;",
        "STATUS" => "FLUSH STATUS;",
        _ => {
            return Err(PyroError::InvalidOperation(format!(
                "Tipo de flush '{flush_type}' no permitido."
            )))
        }
    };

    backend.execute_query(sql, None).await?;
    Ok(format!("Operación '{sql}' completada con éxito."))
}
