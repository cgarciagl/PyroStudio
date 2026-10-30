use super::backend::DatabaseBackend;
use super::error::PyroError;
use super::models::{SqlDumpRequest, SqlDumpSummary};
use super::routine::list_routines;
use super::sql_utils::{qualify_table, quote_identifier};
use super::table::{get_table_primary_key, list_tables};
use super::trigger::list_triggers;
use std::time::Instant;
use tokio::io::AsyncWriteExt;

/// Safely escapes a string for inclusion as a MySQL/MariaDB single-quoted literal.
pub fn escape_sql_string(input: &str) -> String {
    let mut escaped = String::with_capacity(input.len() + 16);
    for ch in input.chars() {
        match ch {
            '\0' => escaped.push_str("\\0"),
            '\'' => escaped.push_str("\\'"),
            '\"' => escaped.push_str("\\\""),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            '\\' => escaped.push_str("\\\\"),
            '\x1a' => escaped.push_str("\\Z"),
            _ => escaped.push(ch),
        }
    }
    escaped
}

/// Converts a JSON value from SQL execution into a compact, optimized SQL literal.
pub fn format_sql_value(val: &serde_json::Value) -> String {
    match val {
        serde_json::Value::Null => "NULL".to_string(),
        serde_json::Value::Bool(b) => {
            if *b {
                "1".to_string()
            } else {
                "0".to_string()
            }
        }
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(s) => {
            // Check if string represents a raw hex literal like 0xDEADBEEF
            if s.starts_with("0x") && s.len() > 2 && s[2..].chars().all(|c| c.is_ascii_hexdigit()) {
                s.clone()
            } else {
                format!("'{}'", escape_sql_string(s))
            }
        }
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
            let json_str = serde_json::to_string(val).unwrap_or_default();
            format!("'{}'", escape_sql_string(&json_str))
        }
    }
}

/// Helper writer that writes either to an async file or an in-memory buffer.
enum DumpWriter {
    File(tokio::io::BufWriter<tokio::fs::File>),
    Memory(String),
}

impl DumpWriter {
    async fn write_str(&mut self, s: &str) -> Result<(), PyroError> {
        match self {
            DumpWriter::File(writer) => {
                writer.write_all(s.as_bytes()).await.map_err(|e| {
                    PyroError::Io(format!("Error escribiendo en archivo de exportación: {e}"))
                })?;
            }
            DumpWriter::Memory(buf) => {
                buf.push_str(s);
            }
        }
        Ok(())
    }

    async fn flush(&mut self) -> Result<(), PyroError> {
        match self {
            DumpWriter::File(writer) => {
                writer.flush().await.map_err(|e| {
                    PyroError::Io(format!("Error guardando archivo de exportación: {e}"))
                })?;
            }
            DumpWriter::Memory(_) => {}
        }
        Ok(())
    }
}

/// Exports a single table or an entire database to SQL DDL + optimized multi-row INSERTs.
///
/// File output is written to `<path>.partial` and renamed only when the dump
/// completes, so a failed or interrupted backup never looks like a valid one.
pub async fn export_sql_dump(
    backend: &dyn DatabaseBackend,
    mut req: SqlDumpRequest,
) -> Result<SqlDumpSummary, PyroError> {
    let Some(final_path) = req.output_file_path.clone() else {
        return write_sql_dump(backend, req).await;
    };
    let partial_path = format!("{final_path}.partial");
    req.output_file_path = Some(partial_path.clone());
    match write_sql_dump(backend, req).await {
        Ok(mut summary) => {
            tokio::fs::rename(&partial_path, &final_path)
                .await
                .map_err(|e| {
                    PyroError::Io(format!(
                        "No se pudo finalizar el archivo '{final_path}': {e}"
                    ))
                })?;
            summary.file_path = Some(final_path);
            Ok(summary)
        }
        Err(error) => {
            let _ = tokio::fs::remove_file(&partial_path).await;
            Err(error)
        }
    }
}

/// Builds the SELECT for the next data chunk of a table.
fn build_chunk_query(
    qualified: &str,
    pk_columns: &[String],
    column_count: usize,
    last_key: Option<&[serde_json::Value]>,
    limit: usize,
    offset: usize,
) -> Result<String, PyroError> {
    if pk_columns.is_empty() {
        // No key: order by every column so OFFSET paging is deterministic.
        let order = (1..=column_count)
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join(", ");
        let order_clause = if order.is_empty() {
            String::new()
        } else {
            format!(" ORDER BY {order}")
        };
        return Ok(format!(
            "SELECT * FROM {qualified}{order_clause} LIMIT {limit} OFFSET {offset}"
        ));
    }
    let quoted = pk_columns
        .iter()
        .map(|c| quote_identifier(c))
        .collect::<Result<Vec<_>, _>>()?;
    let key_list = quoted.join(", ");
    let where_clause = match last_key {
        Some(values) => {
            let literals = values
                .iter()
                .map(format_sql_value)
                .collect::<Vec<_>>()
                .join(", ");
            if quoted.len() == 1 {
                format!(" WHERE {key_list} > {literals}")
            } else {
                format!(" WHERE ({key_list}) > ({literals})")
            }
        }
        None => String::new(),
    };
    Ok(format!(
        "SELECT * FROM {qualified}{where_clause} ORDER BY {key_list} LIMIT {limit}"
    ))
}

/// Picks the primary key values of `row` in key order.
fn extract_key(
    columns: &[String],
    row: &[serde_json::Value],
    pk_columns: &[String],
) -> Result<Vec<serde_json::Value>, PyroError> {
    pk_columns
        .iter()
        .map(|pk| {
            columns
                .iter()
                .position(|c| c.eq_ignore_ascii_case(pk))
                .and_then(|i| row.get(i).cloned())
                .ok_or_else(|| {
                    PyroError::Database(format!(
                        "La columna clave `{pk}` no aparece en el resultado del volcado."
                    ))
                })
        })
        .collect()
}

async fn write_sql_dump(
    backend: &dyn DatabaseBackend,
    req: SqlDumpRequest,
) -> Result<SqlDumpSummary, PyroError> {
    let start_time = Instant::now();
    let database = &req.database;
    let export_mode = req.export_mode.as_str();
    let include_structure = export_mode == "structure_and_data" || export_mode == "structure_only";
    let include_data = export_mode == "structure_and_data" || export_mode == "data_only";
    let batch_size = req.insert_batch_size.unwrap_or(250).clamp(10, 5000);

    let mut writer = match &req.output_file_path {
        Some(path) => {
            let file = tokio::fs::File::create(path)
                .await
                .map_err(|e| PyroError::Io(format!("No se pudo crear el archivo '{path}': {e}")))?;
            DumpWriter::File(tokio::io::BufWriter::with_capacity(128 * 1024, file))
        }
        None => DumpWriter::Memory(String::with_capacity(32 * 1024)),
    };

    // 1. Header and environment setup
    let server_ver = backend
        .execute_query("SELECT VERSION()", None)
        .await
        .ok()
        .and_then(|r| r.rows.first().and_then(|row| row.first().cloned()))
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "Unknown MariaDB/MySQL".to_string());

    let create_db_sql = if req.include_create_database.unwrap_or(false) {
        format!(
            "CREATE DATABASE /*!32312 IF NOT EXISTS*/ `{}` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci */;\nUSE `{}`;\n\n",
            database, database
        )
    } else {
        format!("USE `{}`;\n\n", database)
    };

    let header = format!(
        r#"-- ----------------------------------------------------------------------------
-- PyroStudio Database Backup & Export
-- Host: {}
-- Server Version: {}
-- Database: `{}`
-- Generated: {}
-- Export Mode: {}
-- ----------------------------------------------------------------------------

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

{}"#,
        "localhost",
        server_ver,
        database,
        chrono_lite(),
        export_mode,
        create_db_sql
    );
    writer.write_str(&header).await?;

    // 2. Determine target tables
    let all_tables_meta = list_tables(backend, database).await?;
    let target_tables_meta: Vec<_> = if let Some(ref selected) = req.tables {
        if selected.is_empty() {
            all_tables_meta
        } else {
            all_tables_meta
                .into_iter()
                .filter(|t| selected.iter().any(|s| s.eq_ignore_ascii_case(&t.name)))
                .collect()
        }
    } else {
        all_tables_meta
    };

    let mut tables_exported = Vec::new();
    let mut total_tables = 0;
    let mut total_views = 0;
    let mut total_rows_exported: u64 = 0;

    // Process BASE TABLEs first, then VIEWs
    let base_tables: Vec<_> = target_tables_meta
        .iter()
        .filter(|t| t.table_type != "VIEW")
        .collect();
    let views: Vec<_> = target_tables_meta
        .iter()
        .filter(|t| t.table_type == "VIEW")
        .collect();

    for tbl in base_tables {
        total_tables += 1;
        tables_exported.push(tbl.name.clone());
        let qualified = qualify_table(Some(database), &tbl.name)?;

        // 3a. DDL Creation
        if include_structure {
            writer
                .write_str(&format!(
                    "-- ----------------------------------------------------------------------------\n-- Table structure for `{}`\n-- ----------------------------------------------------------------------------\n",
                    tbl.name
                ))
                .await?;

            if req.include_drop_table {
                writer
                    .write_str(&format!("DROP TABLE IF EXISTS `{}`;\n", tbl.name))
                    .await?;
            }

            let ddl_sql = format!("SHOW CREATE TABLE {qualified}");
            let res = backend
                .execute_query(&ddl_sql, Some(database))
                .await
                .map_err(|e| {
                    PyroError::Database(format!(
                        "No se pudo obtener la estructura de `{}`: {e}",
                        tbl.name
                    ))
                })?;
            if let Some(ddl_val) = res
                .rows
                .first()
                .and_then(|row| row.get(1))
                .and_then(|v| v.as_str())
            {
                writer.write_str(ddl_val).await?;
                writer.write_str(";\n\n").await?;
            }
        }

        // 3b. Data Export (Optimized Multi-Row INSERTs)
        if include_data {
            // Fetch columns for clean INSERT column lists
            let clean_db = database.replace('\'', "''");
            let clean_tbl = tbl.name.replace('\'', "''");
            let cols_sql = format!(
                "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '{clean_db}' AND TABLE_NAME = '{clean_tbl}' ORDER BY ORDINAL_POSITION ASC"
            );
            let col_names = if let Ok(c_res) =
                backend.execute_query(&cols_sql, Some(database)).await
            {
                c_res
                    .rows
                    .into_iter()
                    .filter_map(|r| r.first().and_then(|v| v.as_str().map(|s| format!("`{s}`"))))
                    .collect::<Vec<_>>()
            } else {
                Vec::new()
            };

            let cols_clause = if !col_names.is_empty() {
                format!(" ({})", col_names.join(", "))
            } else {
                String::new()
            };

            // Query rows in deterministic chunks: keyset pagination over the
            // primary key when there is one, otherwise ORDER BY every column.
            let pk_columns = get_table_primary_key(backend, database, &tbl.name)
                .await?
                .columns;
            let chunk_limit = 2000;
            let mut offset = 0;
            let mut last_key: Option<Vec<serde_json::Value>> = None;
            let mut table_has_data = false;
            let mut rows_in_current_batch = 0;

            loop {
                let fetch_sql = build_chunk_query(
                    &qualified,
                    &pk_columns,
                    col_names.len(),
                    last_key.as_deref(),
                    chunk_limit,
                    offset,
                )?;
                let chunk_res = backend
                    .execute_query(&fetch_sql, Some(database))
                    .await
                    .map_err(|e| {
                        PyroError::Database(format!(
                            "Fallo al leer datos de `{}` (fila {offset}): {e}",
                            tbl.name
                        ))
                    })?;

                let rows_count = chunk_res.rows.len();
                if rows_count == 0 {
                    break;
                }

                if !pk_columns.is_empty() {
                    let last_row = chunk_res.rows.last().map(Vec::as_slice).unwrap_or(&[]);
                    last_key = Some(extract_key(&chunk_res.columns, last_row, &pk_columns)?);
                }

                if !table_has_data {
                    table_has_data = true;
                    writer
                        .write_str(&format!(
                            "--\n-- Dumping data for table `{}`\n--\n\nLOCK TABLES `{}` WRITE;\n/*!40000 ALTER TABLE `{}` DISABLE KEYS */;\n",
                            tbl.name, tbl.name, tbl.name
                        ))
                        .await?;
                }

                for row in chunk_res.rows {
                    total_rows_exported += 1;
                    let values_tuple = format!(
                        "({})",
                        row.iter()
                            .map(format_sql_value)
                            .collect::<Vec<_>>()
                            .join(", ")
                    );

                    if rows_in_current_batch == 0 {
                        // Start a new multi-row INSERT statement
                        writer
                            .write_str(&format!(
                                "INSERT INTO `{}`{} VALUES\n",
                                tbl.name, cols_clause
                            ))
                            .await?;
                        writer.write_str(&values_tuple).await?;
                        rows_in_current_batch = 1;
                    } else if rows_in_current_batch < batch_size {
                        // Append tuple with comma
                        writer.write_str(",\n").await?;
                        writer.write_str(&values_tuple).await?;
                        rows_in_current_batch += 1;
                    } else {
                        // End current INSERT statement and start new one
                        writer.write_str(";\n").await?;
                        writer
                            .write_str(&format!(
                                "INSERT INTO `{}`{} VALUES\n",
                                tbl.name, cols_clause
                            ))
                            .await?;
                        writer.write_str(&values_tuple).await?;
                        rows_in_current_batch = 1;
                    }
                }

                offset += rows_count;
                if rows_count < chunk_limit {
                    break;
                }
            }

            if table_has_data {
                if rows_in_current_batch > 0 {
                    writer.write_str(";\n").await?;
                }
                writer
                    .write_str(&format!(
                        "/*!40000 ALTER TABLE `{}` ENABLE KEYS */;\nUNLOCK TABLES;\n\n",
                        tbl.name
                    ))
                    .await?;
            }
        }
    }

    // 4. Export VIEWs (if requested)
    if req.include_views && include_structure {
        for v in views {
            total_views += 1;
            tables_exported.push(v.name.clone());
            let qualified = qualify_table(Some(database), &v.name)?;

            writer
                .write_str(&format!(
                    "-- ----------------------------------------------------------------------------\n-- View structure for `{}`\n-- ----------------------------------------------------------------------------\n",
                    v.name
                ))
                .await?;

            if req.include_drop_table {
                writer
                    .write_str(&format!("DROP VIEW IF EXISTS `{}`;\n", v.name))
                    .await?;
            }

            let ddl_sql = format!("SHOW CREATE VIEW {qualified}");
            if let Ok(res) = backend.execute_query(&ddl_sql, Some(database)).await {
                if let Some(row) = res.rows.first() {
                    if let Some(ddl_val) = row.get(1).and_then(|val| val.as_str()) {
                        writer.write_str(ddl_val).await?;
                        writer.write_str(";\n\n").await?;
                    }
                }
            }
        }
    }

    // 5. Export Routines (Procedures & Functions) if requested
    let mut total_routines = 0;
    if req.include_routines && include_structure {
        let routines = list_routines(backend, database, None)
            .await
            .unwrap_or_default();
        for r in routines {
            total_routines += 1;
            let kind = &r.routine_type;
            let qualified = qualify_table(Some(database), &r.name)?;

            writer
                .write_str(&format!(
                    "-- ----------------------------------------------------------------------------\n-- Routine `{}` ({})\n-- ----------------------------------------------------------------------------\n",
                    r.name, kind
                ))
                .await?;

            writer
                .write_str(&format!("DROP {} IF EXISTS `{}`;\n", kind, r.name))
                .await?;

            let show_sql = format!("SHOW CREATE {kind} {qualified}");
            if let Ok(res) = backend.execute_query(&show_sql, Some(database)).await {
                if let Some(row) = res.rows.first() {
                    if let Some(ddl_val) = row.get(2).and_then(|val| val.as_str()) {
                        writer.write_str("DELIMITER ;;\n").await?;
                        writer.write_str(ddl_val).await?;
                        writer.write_str(" ;;\nDELIMITER ;\n\n").await?;
                    }
                }
            }
        }
    }

    // 6. Export Triggers if requested
    let mut total_triggers = 0;
    if req.include_triggers && include_structure {
        let triggers = list_triggers(backend, database, None)
            .await
            .unwrap_or_default();
        for trg in triggers {
            total_triggers += 1;
            writer
                .write_str(&format!(
                    "-- ----------------------------------------------------------------------------\n-- Trigger `{}`\n-- ----------------------------------------------------------------------------\n",
                    trg.name
                ))
                .await?;

            writer
                .write_str(&format!("DROP TRIGGER IF EXISTS `{}`;\n", trg.name))
                .await?;

            let show_sql = format!("SHOW CREATE TRIGGER `{database}`.`{}`", trg.name);
            if let Ok(res) = backend.execute_query(&show_sql, Some(database)).await {
                if let Some(row) = res.rows.first() {
                    if let Some(ddl_val) = row.get(2).and_then(|val| val.as_str()) {
                        writer.write_str("DELIMITER ;;\n").await?;
                        writer.write_str(ddl_val).await?;
                        writer.write_str(" ;;\nDELIMITER ;\n\n").await?;
                    }
                }
            }
        }
    }

    // 7. Footer
    let footer = r#"
/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed
"#;
    writer.write_str(footer).await?;
    writer.flush().await?;

    let duration_ms = start_time.elapsed().as_millis() as u64;

    let (file_size_bytes, sql_preview) = match writer {
        DumpWriter::File(_) => {
            let size = if let Some(ref path) = req.output_file_path {
                tokio::fs::metadata(path)
                    .await
                    .map(|m| m.len())
                    .unwrap_or(0)
            } else {
                0
            };
            (size, None)
        }
        DumpWriter::Memory(buf) => {
            let size = buf.len() as u64;
            (size, Some(buf))
        }
    };

    Ok(SqlDumpSummary {
        database: database.to_string(),
        tables_exported,
        total_tables,
        total_views,
        total_routines,
        total_triggers,
        total_rows_exported,
        file_path: req.output_file_path,
        file_size_bytes,
        duration_ms,
        sql_preview,
    })
}

fn chrono_lite() -> String {
    // Simple timestamp helper
    format!("{:?}", std::time::SystemTime::now())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_escape_sql_string() {
        assert_eq!(escape_sql_string("hello 'world'"), "hello \\'world\\'");
        assert_eq!(escape_sql_string("line1\nline2"), "line1\\nline2");
        assert_eq!(escape_sql_string("tab\tdone"), "tab\\tdone");
        assert_eq!(escape_sql_string("slash\\path"), "slash\\\\path");
    }

    #[test]
    fn chunk_query_uses_keyset_on_primary_key() {
        let pk = vec!["id".to_string()];
        assert_eq!(
            build_chunk_query("`db`.`t`", &pk, 3, None, 100, 0).unwrap(),
            "SELECT * FROM `db`.`t` ORDER BY `id` LIMIT 100"
        );
        let key = [serde_json::json!(42)];
        assert_eq!(
            build_chunk_query("`db`.`t`", &pk, 3, Some(&key), 100, 200).unwrap(),
            "SELECT * FROM `db`.`t` WHERE `id` > 42 ORDER BY `id` LIMIT 100"
        );
    }

    #[test]
    fn chunk_query_compares_composite_keys_as_rows() {
        let pk = vec!["a".to_string(), "b".to_string()];
        let key = [serde_json::json!(1), serde_json::json!("x")];
        assert_eq!(
            build_chunk_query("`t`", &pk, 2, Some(&key), 10, 0).unwrap(),
            "SELECT * FROM `t` WHERE (`a`, `b`) > (1, 'x') ORDER BY `a`, `b` LIMIT 10"
        );
    }

    #[test]
    fn chunk_query_without_key_orders_by_every_column() {
        assert_eq!(
            build_chunk_query("`t`", &[], 3, None, 10, 20).unwrap(),
            "SELECT * FROM `t` ORDER BY 1, 2, 3 LIMIT 10 OFFSET 20"
        );
    }

    #[test]
    fn extract_key_reads_columns_case_insensitively() {
        let columns = vec!["ID".to_string(), "name".to_string()];
        let row = vec![serde_json::json!(7), serde_json::json!("x")];
        assert_eq!(
            extract_key(&columns, &row, &["id".to_string()]).unwrap(),
            vec![serde_json::json!(7)]
        );
    }

    #[test]
    fn test_format_sql_value() {
        assert_eq!(format_sql_value(&serde_json::Value::Null), "NULL");
        assert_eq!(format_sql_value(&serde_json::json!(123)), "123");
        assert_eq!(format_sql_value(&serde_json::json!(true)), "1");
        assert_eq!(format_sql_value(&serde_json::json!(false)), "0");
        assert_eq!(
            format_sql_value(&serde_json::json!("O'Connor")),
            "'O\\'Connor'"
        );
        assert_eq!(
            format_sql_value(&serde_json::json!("0xDEADBEEF")),
            "0xDEADBEEF"
        );
    }
}
