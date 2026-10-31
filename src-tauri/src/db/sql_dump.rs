use super::backend::{DatabaseBackend, PinnedSession};
use super::engine::DbEngine;
use super::error::PyroError;
use super::models::{SqlDumpRequest, SqlDumpSummary};
use super::routine::list_routines;
use super::sql_utils::{qualify_table, quote_identifier};
use super::table::{get_table_primary_key, list_tables};
use super::trigger::list_triggers;
use futures_util::future::BoxFuture;
use futures_util::FutureExt;
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

struct DedicatedBackend<'a> {
    session: tokio::sync::Mutex<&'a mut dyn PinnedSession>,
    engine: DbEngine,
}

impl<'a> DatabaseBackend for DedicatedBackend<'a> {
    fn engine(&self) -> DbEngine {
        self.engine
    }

    fn execute_query<'b>(
        &'b self,
        sql: &'b str,
        database: Option<&'b str>,
    ) -> BoxFuture<'b, Result<super::models::QueryExecutionResult, PyroError>> {
        async move {
            let mut session = self.session.lock().await;
            session.query(sql, database).await
        }
        .boxed()
    }

    fn update_cell<'b>(
        &'b self,
        _req: &'b super::models::CellUpdateRequest,
    ) -> BoxFuture<'b, Result<(), PyroError>> {
        async move {
            Err(PyroError::ReadOnlyConnection(
                "Operación no permitida durante el volcado.".into(),
            ))
        }
        .boxed()
    }

    fn delete_row<'b>(
        &'b self,
        _req: &'b super::models::DeleteRowRequest,
    ) -> BoxFuture<'b, Result<(), PyroError>> {
        async move {
            Err(PyroError::ReadOnlyConnection(
                "Operación no permitida durante el volcado.".into(),
            ))
        }
        .boxed()
    }

    fn execute_transaction<'b>(
        &'b self,
        _statements: &'b [String],
        _database: Option<&'b str>,
    ) -> BoxFuture<'b, Result<usize, PyroError>> {
        async move {
            Err(PyroError::ReadOnlyConnection(
                "Operación no permitida durante el volcado.".into(),
            ))
        }
        .boxed()
    }

    fn close<'b>(&'b self) -> BoxFuture<'b, ()> {
        async move {}.boxed()
    }
}

async fn detect_binlog_coordinates(backend: &dyn DatabaseBackend) -> Option<String> {
    let mut parts = Vec::new();

    if let Ok(res) = backend.execute_query("SHOW MASTER STATUS", None).await {
        if let Some(row) = res.rows.first() {
            let file = row.first().and_then(|v| v.as_str());
            let pos = row.get(1).and_then(|v| {
                if let Some(n) = v.as_i64() {
                    Some(n.to_string())
                } else if let Some(n) = v.as_u64() {
                    Some(n.to_string())
                } else {
                    v.as_str().map(|s| s.to_string())
                }
            });
            if let (Some(f), Some(p)) = (file, pos) {
                parts.push(format!("File: {f}, Position: {p}"));
            }
            if let Some(gtid) = row.get(4).and_then(|v| v.as_str()) {
                if !gtid.trim().is_empty() {
                    parts.push(format!("GTID: {}", gtid.trim()));
                }
            }
        }
    }

    if !parts.iter().any(|p| p.contains("GTID")) {
        if let Ok(gtid_res) = backend
            .execute_query("SELECT @@gtid_current_pos", None)
            .await
        {
            if let Some(gtid) = gtid_res
                .rows
                .first()
                .and_then(|r| r.first())
                .and_then(|v| v.as_str())
            {
                if !gtid.trim().is_empty() {
                    parts.push(format!("GTID: {}", gtid.trim()));
                }
            }
        } else if let Ok(gtid_res) = backend.execute_query("SELECT @@gtid_executed", None).await {
            if let Some(gtid) = gtid_res
                .rows
                .first()
                .and_then(|r| r.first())
                .and_then(|v| v.as_str())
            {
                if !gtid.trim().is_empty() {
                    parts.push(format!("GTID: {}", gtid.trim()));
                }
            }
        }
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join("; "))
    }
}

async fn detect_non_transactional_tables(
    backend: &dyn DatabaseBackend,
    database: &str,
    target_tables: &[String],
) -> Vec<(String, String)> {
    let clean_db = database.replace('\'', "''");
    let sql = format!(
        "SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = '{clean_db}' AND ENGINE IN ('MyISAM', 'Aria', 'MEMORY', 'CSV')"
    );
    let mut non_tx = Vec::new();
    if let Ok(res) = backend.execute_query(&sql, Some(database)).await {
        for row in res.rows {
            if let (Some(tbl), Some(engine)) = (
                row.first().and_then(|v| v.as_str()),
                row.get(1).and_then(|v| v.as_str()),
            ) {
                if target_tables.is_empty()
                    || target_tables.iter().any(|t| t.eq_ignore_ascii_case(tbl))
                {
                    non_tx.push((tbl.to_string(), engine.to_string()));
                }
            }
        }
    }
    non_tx
}

async fn write_sql_dump(
    backend: &dyn DatabaseBackend,
    req: SqlDumpRequest,
) -> Result<SqlDumpSummary, PyroError> {
    let mut snapshot_session = backend.open_snapshot_session().await.ok();
    let consistent_snapshot = snapshot_session.is_some();

    let dedicated;
    let dump_backend: &dyn DatabaseBackend = if let Some(ref mut session) = snapshot_session {
        dedicated = DedicatedBackend {
            session: tokio::sync::Mutex::new(session.as_mut()),
            engine: backend.engine(),
        };
        &dedicated
    } else {
        backend
    };

    let result = write_sql_dump_inner(dump_backend, req, consistent_snapshot).await;

    if let Some(session) = snapshot_session {
        session.release().await;
    }

    result
}

async fn write_sql_dump_inner(
    backend: &dyn DatabaseBackend,
    req: SqlDumpRequest,
    consistent_snapshot: bool,
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

    let binlog_coords = if consistent_snapshot {
        detect_binlog_coordinates(backend).await
    } else {
        None
    };

    let snapshot_header = if consistent_snapshot {
        let mut s = String::from("-- Consistent Snapshot: ACTIVE (REPEATABLE READ)\n");
        if let Some(ref coords) = binlog_coords {
            s.push_str(&format!("-- Binlog / GTID Coordinates: {coords}\n"));
        }
        s
    } else {
        String::from("-- Consistent Snapshot: NOT AVAILABLE (FALLBACK)\n")
    };

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
{}-- ----------------------------------------------------------------------------

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
        snapshot_header,
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

    let target_names: Vec<String> = target_tables_meta.iter().map(|t| t.name.clone()).collect();
    let non_tx_tables = detect_non_transactional_tables(backend, database, &target_names).await;
    if !non_tx_tables.is_empty() {
        let mut warning_comment = String::from(
            "-- ----------------------------------------------------------------------------\n-- WARNING: Non-transactional table(s) detected. Their data may not be consistent with the snapshot:\n",
        );
        for (tbl_name, engine) in &non_tx_tables {
            warning_comment.push_str(&format!("--   * `{tbl_name}` ({engine})\n"));
        }
        warning_comment.push_str(
            "-- ----------------------------------------------------------------------------\n\n",
        );
        writer.write_str(&warning_comment).await?;
    }

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

    let mut warnings = Vec::new();
    if !non_tx_tables.is_empty() {
        let names = non_tx_tables
            .iter()
            .map(|(t, eng)| format!("{t} ({eng})"))
            .collect::<Vec<_>>()
            .join(", ");
        warnings.push(format!(
            "Las siguientes tablas usan motores no transaccionales y sus datos pueden no ser coherentes con el snapshot: {names}"
        ));
    }

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
        consistent_snapshot,
        binlog_coordinates: binlog_coords,
        non_transactional_tables: non_tx_tables.into_iter().map(|(t, _)| t).collect(),
        warnings,
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

    struct MockQueryBackend {
        responses: std::collections::HashMap<String, super::super::models::QueryExecutionResult>,
    }

    impl DatabaseBackend for MockQueryBackend {
        fn engine(&self) -> DbEngine {
            DbEngine::MySql
        }

        fn execute_query<'a>(
            &'a self,
            sql: &'a str,
            _database: Option<&'a str>,
        ) -> BoxFuture<'a, Result<super::super::models::QueryExecutionResult, PyroError>> {
            let res = self.responses.get(sql).cloned().unwrap_or_else(|| {
                super::super::models::QueryExecutionResult {
                    columns: vec![],
                    rows: vec![],
                    affected_rows: 0,
                    execution_time_ms: 1,
                    message: String::new(),
                    warning: None,
                }
            });
            async move { Ok(res) }.boxed()
        }

        fn update_cell<'a>(
            &'a self,
            _req: &'a super::super::models::CellUpdateRequest,
        ) -> BoxFuture<'a, Result<(), PyroError>> {
            async move { Ok(()) }.boxed()
        }

        fn delete_row<'a>(
            &'a self,
            _req: &'a super::super::models::DeleteRowRequest,
        ) -> BoxFuture<'a, Result<(), PyroError>> {
            async move { Ok(()) }.boxed()
        }

        fn execute_transaction<'a>(
            &'a self,
            _statements: &'a [String],
            _database: Option<&'a str>,
        ) -> BoxFuture<'a, Result<usize, PyroError>> {
            async move { Ok(0) }.boxed()
        }

        fn close<'a>(&'a self) -> BoxFuture<'a, ()> {
            async move {}.boxed()
        }
    }

    #[tokio::test]
    async fn binlog_coordinates_extracted_correctly() {
        let mut responses = std::collections::HashMap::new();
        responses.insert(
            "SHOW MASTER STATUS".to_string(),
            super::super::models::QueryExecutionResult {
                columns: vec![
                    "File".into(),
                    "Position".into(),
                    "Binlog_Do_DB".into(),
                    "Binlog_Ignore_DB".into(),
                    "Executed_Gtid_Set".into(),
                ],
                rows: vec![vec![
                    serde_json::json!("mysql-bin.000005"),
                    serde_json::json!(5678),
                    serde_json::json!(""),
                    serde_json::json!(""),
                    serde_json::json!("0-1-99"),
                ]],
                affected_rows: 0,
                execution_time_ms: 1,
                message: String::new(),
                warning: None,
            },
        );

        let backend = MockQueryBackend { responses };
        let coords = detect_binlog_coordinates(&backend).await;
        assert_eq!(
            coords,
            Some("File: mysql-bin.000005, Position: 5678; GTID: 0-1-99".to_string())
        );
    }

    #[tokio::test]
    async fn non_transactional_tables_detected() {
        let mut responses = std::collections::HashMap::new();
        responses.insert(
            "SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'test_db' AND ENGINE IN ('MyISAM', 'Aria', 'MEMORY', 'CSV')".to_string(),
            super::super::models::QueryExecutionResult {
                columns: vec!["TABLE_NAME".into(), "ENGINE".into()],
                rows: vec![
                    vec![serde_json::json!("tbl_myisam"), serde_json::json!("MyISAM")],
                    vec![serde_json::json!("tbl_aria"), serde_json::json!("Aria")],
                ],
                affected_rows: 0,
                execution_time_ms: 1,
                message: String::new(),
                warning: None,
            },
        );

        let backend = MockQueryBackend { responses };
        let detected = detect_non_transactional_tables(
            &backend,
            "test_db",
            &["tbl_myisam".to_string(), "tbl_innodb".to_string()],
        )
        .await;

        assert_eq!(
            detected,
            vec![("tbl_myisam".to_string(), "MyISAM".to_string())]
        );
    }
}
