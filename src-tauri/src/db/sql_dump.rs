use super::backend::{DatabaseBackend, PinnedSession};
use super::engine::DbEngine;
use super::error::PyroError;
use super::models::{SqlDumpRequest, SqlDumpSummary};
use super::routine::list_routines;
use super::dialect::MYSQL_DIALECT;
use super::sql_utils::{qualify_table, quote_ident_mysql, quote_identifier, sql_string_literal};
use super::table::{get_table_columns, get_table_primary_key, list_tables};
use super::trigger::list_triggers;
use futures_util::future::BoxFuture;
use futures_util::FutureExt;
use std::time::Instant;
use tokio::io::AsyncWriteExt;

pub use super::sql_utils::escape_sql_string;

/// Detects binary/blob/bit column data types.
pub fn is_binary_column_type(column_type: &str) -> bool {
    let t = column_type.trim().to_ascii_uppercase();
    let base = t.split('(').next().unwrap_or(&t).trim();
    matches!(
        base,
        "BINARY" | "VARBINARY" | "TINYBLOB" | "BLOB" | "MEDIUMBLOB" | "LONGBLOB" | "BIT"
    )
}

/// Converts a JSON value from SQL execution into a compact, optimized SQL literal.
/// Always quotes string values without treating "0x..." as a binary literal.
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
            format!("'{}'", escape_sql_string(s))
        }
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
            let json_str = serde_json::to_string(val).unwrap_or_default();
            format!("'{}'", escape_sql_string(&json_str))
        }
    }
}

/// Formats a value using column type knowledge:
/// - If the column is binary/blob/bit, formats as a hex literal `0x...` (or `''` if empty).
/// - Otherwise, formats using `format_sql_value` (strings are quoted).
pub fn format_sql_value_typed(val: &serde_json::Value, column_type: &str) -> String {
    if val.is_null() {
        return "NULL".to_string();
    }
    if is_binary_column_type(column_type) {
        match val {
            serde_json::Value::String(s) => {
                if s.is_empty() {
                    "''".to_string()
                } else if s.starts_with("0x") || s.starts_with("0X") {
                    format!("0x{}", &s[2..])
                } else {
                    format!("0x{s}")
                }
            }
            serde_json::Value::Array(arr) => {
                let hex: String = arr
                    .iter()
                    .filter_map(|b| b.as_u64())
                    .map(|b| format!("{b:02X}"))
                    .collect();
                if hex.is_empty() {
                    "''".to_string()
                } else {
                    format!("0x{hex}")
                }
            }
            serde_json::Value::Number(n) => {
                format!("{n}")
            }
            _ => format_sql_value(val),
        }
    } else {
        format_sql_value(val)
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

/// Builds the SELECT for the next data chunk of a table with default `*` selection.
pub fn build_chunk_query(
    qualified: &str,
    pk_columns: &[String],
    column_count: usize,
    last_key: Option<&[serde_json::Value]>,
    limit: usize,
    offset: usize,
) -> Result<String, PyroError> {
    build_chunk_query_with_select(
        "*",
        qualified,
        pk_columns,
        column_count,
        last_key,
        limit,
        offset,
    )
}

/// Builds the SELECT for the next data chunk of a table with a custom select list
/// (e.g., converting binary columns to HEX(col) AS col).
pub fn build_chunk_query_with_select(
    select_list: &str,
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
            "SELECT {select_list} FROM {qualified}{order_clause} LIMIT {limit} OFFSET {offset}"
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
        "SELECT {select_list} FROM {qualified}{where_clause} ORDER BY {key_list} LIMIT {limit}"
    ))
}

/// Picks the primary key values of `row` in key order.
pub fn extract_key(
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SnapshotStrategy {
    MariaDbSnapshotStatus,
    MySqlFtwrl,
}

pub fn detect_snapshot_strategy(server_version: &str) -> SnapshotStrategy {
    if server_version.to_lowercase().contains("mariadb") {
        SnapshotStrategy::MariaDbSnapshotStatus
    } else {
        SnapshotStrategy::MySqlFtwrl
    }
}

pub fn parse_mariadb_snapshot_status(
    status_map: &std::collections::HashMap<String, String>,
    gtid: Option<&str>,
) -> Option<String> {
    let file = status_map
        .get("BINLOG_SNAPSHOT_FILE")
        .filter(|s| !s.trim().is_empty());
    let pos = status_map
        .get("BINLOG_SNAPSHOT_POSITION")
        .filter(|s| !s.trim().is_empty());

    let mut parts = Vec::new();
    if let (Some(f), Some(p)) = (file, pos) {
        parts.push(format!("File: {f}, Position: {p}"));
    }
    if let Some(g) = gtid {
        let trimmed = g.trim();
        if !trimmed.is_empty() {
            parts.push(format!("GTID: {trimmed}"));
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("; "))
    }
}

pub fn parse_binary_log_status_row(
    row: &[serde_json::Value],
    fallback_gtid: Option<&str>,
) -> Option<String> {
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

    let mut parts = Vec::new();
    if let (Some(f), Some(p)) = (file, pos) {
        if !f.trim().is_empty() && !p.trim().is_empty() {
            parts.push(format!("File: {f}, Position: {p}"));
        }
    }

    let gtid_from_row = row.get(4).and_then(|v| v.as_str());
    if let Some(gtid) = gtid_from_row.or(fallback_gtid) {
        let trimmed = gtid.trim();
        if !trimmed.is_empty() {
            parts.push(format!("GTID: {trimmed}"));
        }
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join("; "))
    }
}

/// Atomically captures replication coordinates aligned with the transaction snapshot.
///
/// - MariaDB: reads `binlog_snapshot_file` and `binlog_snapshot_position` from the dedicated
///   snapshot session (zero lock overhead), and queries `SELECT BINLOG_GTID_POS(...)` for GTID.
///   Does not use table locks and is always captured.
/// - MySQL: if `include_replication_coordinates` is true, uses a brief `FLUSH TABLES WITH READ LOCK`
///   -> `START TRANSACTION WITH CONSISTENT SNAPSHOT` -> read coordinates -> `UNLOCK TABLES`.
///   If false, skips FTWRL entirely and leaves coordinates empty.
pub async fn detect_binlog_coordinates_atomic(
    backend: &dyn DatabaseBackend,
    server_version: &str,
    include_replication_coordinates: bool,
) -> (Option<String>, Option<String>) {
    let strategy = detect_snapshot_strategy(server_version);
    match strategy {
        SnapshotStrategy::MariaDbSnapshotStatus => {
            // MariaDB records snapshot-consistent status variables at the exact moment
            // START TRANSACTION WITH CONSISTENT SNAPSHOT was executed without locks.
            let mut status_map = std::collections::HashMap::new();
            if let Ok(res) = backend
                .execute_query("SHOW STATUS LIKE 'binlog_snapshot_%'", None)
                .await
            {
                for row in res.rows {
                    if row.len() >= 2 {
                        if let (Some(k), Some(v)) = (row[0].as_str(), row[1].as_str()) {
                            status_map.insert(k.to_ascii_uppercase(), v.to_string());
                        }
                    }
                }
            }

            let file_opt = status_map
                .get("BINLOG_SNAPSHOT_FILE")
                .map(|s| s.trim())
                .filter(|s| !s.is_empty());
            let pos_opt = status_map
                .get("BINLOG_SNAPSHOT_POSITION")
                .map(|s| s.trim())
                .filter(|s| !s.is_empty());

            let gtid = match (file_opt, pos_opt) {
                (Some(file), Some(pos)) => {
                    let clean_file = sql_string_literal(&MYSQL_DIALECT, file);
                    let clean_pos: u64 = pos.parse().unwrap_or(0);
                    let query = format!("SELECT BINLOG_GTID_POS({clean_file}, {clean_pos})");
                    if let Ok(res) = backend.execute_query(&query, None).await {
                        res.rows
                            .first()
                            .and_then(|r| r.first())
                            .and_then(|v| v.as_str())
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty())
                    } else {
                        None
                    }
                }
                _ => None,
            };

            let coords = parse_mariadb_snapshot_status(&status_map, gtid.as_deref());
            (coords, None)
        }
        SnapshotStrategy::MySqlFtwrl => {
            if !include_replication_coordinates {
                return (None, None);
            }

            // On MySQL, reset any previous transaction state on this connection
            let _ = backend.execute_query("ROLLBACK", None).await;

            // 1. Brief global read lock
            if let Err(e) = backend
                .execute_query("FLUSH TABLES WITH READ LOCK", None)
                .await
            {
                // FTWRL failed (typically lacks RELOAD privilege). Start snapshot anyway
                // but do not fabricate coordinates.
                let _ = backend
                    .execute_query("START TRANSACTION WITH CONSISTENT SNAPSHOT", None)
                    .await;
                let warn = format!(
                    "No se pudieron registrar coordenadas binlog atómicas: FLUSH TABLES WITH READ LOCK no está disponible ({e}). El volcado continúa con snapshot consistente sin coordenadas binlog."
                );
                return (None, Some(warn));
            }

            // 2. Start consistent snapshot while lock is held
            let start_res = backend
                .execute_query("START TRANSACTION WITH CONSISTENT SNAPSHOT", None)
                .await;

            // 3. Read binlog coordinates while lock is held
            let coords = if start_res.is_ok() {
                // MySQL 8.4+ replaced SHOW MASTER STATUS with SHOW BINARY LOG STATUS
                let binlog_res = match backend.execute_query("SHOW BINARY LOG STATUS", None).await {
                    Ok(res) if !res.rows.is_empty() => Ok(res),
                    _ => backend.execute_query("SHOW MASTER STATUS", None).await,
                };

                let fallback_gtid =
                    if let Ok(gres) = backend.execute_query("SELECT @@gtid_executed", None).await {
                        gres.rows
                            .first()
                            .and_then(|r| r.first())
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string())
                    } else {
                        None
                    };

                binlog_res.ok().and_then(|res| {
                    res.rows
                        .first()
                        .and_then(|row| parse_binary_log_status_row(row, fallback_gtid.as_deref()))
                })
            } else {
                None
            };

            // 4. Always release table lock immediately
            let _ = backend.execute_query("UNLOCK TABLES", None).await;

            (coords, None)
        }
    }
}

async fn detect_non_transactional_tables(
    backend: &dyn DatabaseBackend,
    database: &str,
    target_tables: &[String],
) -> Vec<(String, String)> {
    let clean_db = sql_string_literal(backend.engine().dialect(), database);
    let sql = format!(
        "SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = {clean_db} AND ENGINE IN ('MyISAM', 'Aria', 'MEMORY', 'CSV')"
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
    let _fallback_slot = if !consistent_snapshot {
        backend.acquire_background_slot().await.ok()
    } else {
        None
    };

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

    let include_coords = req.include_replication_coordinates.unwrap_or(false);
    let (binlog_coords, ftwrl_warning) = if consistent_snapshot {
        detect_binlog_coordinates_atomic(backend, &server_ver, include_coords).await
    } else {
        (None, None)
    };

    let snapshot_header = if consistent_snapshot {
        let mut s = String::from("-- Consistent Snapshot: ACTIVE (REPEATABLE READ)\n");
        if let Some(ref coords) = binlog_coords {
            s.push_str(&format!("-- Binlog / GTID Coordinates: {coords}\n"));
        } else if let Some(ref warn) = ftwrl_warning {
            s.push_str(&format!("-- WARNING: {warn}\n"));
        }
        s
    } else {
        String::from("-- Consistent Snapshot: NOT AVAILABLE (FALLBACK)\n")
    };

    let quoted_db = quote_ident_mysql(database);
    let create_db_sql = if req.include_create_database.unwrap_or(false) {
        format!(
            "CREATE DATABASE /*!32312 IF NOT EXISTS*/ {quoted_db} /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci */;\nUSE {quoted_db};\n\n"
        )
    } else {
        format!("USE {quoted_db};\n\n")
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
                    .write_str(&format!("DROP TABLE IF EXISTS {};\n", quote_ident_mysql(&tbl.name)))
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
            let columns_meta = get_table_columns(backend, database, &tbl.name)
                .await
                .unwrap_or_default();
            let is_sqlite = backend.engine() == DbEngine::Sqlite;

            let select_items: Vec<String> = columns_meta
                .iter()
                .map(|col| {
                    let is_bin = is_binary_column_type(&col.data_type)
                        || is_binary_column_type(&col.column_type);
                    if is_sqlite {
                        let q = format!("\"{}\"", col.name.replace('"', "\"\""));
                        if is_bin {
                            format!("hex({q}) AS {q}")
                        } else {
                            q
                        }
                    } else {
                        let q = format!("`{}`", col.name.replace('`', "``"));
                        if is_bin {
                            format!("HEX({q}) AS {q}")
                        } else {
                            q
                        }
                    }
                })
                .collect();
            let select_clause = if select_items.is_empty() {
                "*".to_string()
            } else {
                select_items.join(", ")
            };

            let col_names: Vec<String> = columns_meta
                .iter()
                .map(|col| {
                    if is_sqlite {
                        format!("\"{}\"", col.name.replace('"', "\"\""))
                    } else {
                        format!("`{}`", col.name.replace('`', "``"))
                    }
                })
                .collect();

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
                let fetch_sql = build_chunk_query_with_select(
                    &select_clause,
                    &qualified,
                    &pk_columns,
                    columns_meta.len(),
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

                let quoted_tbl = quote_ident_mysql(&tbl.name);
                if !table_has_data {
                    table_has_data = true;
                    writer
                        .write_str(&format!(
                            "--\n-- Dumping data for table `{}`\n--\n\nLOCK TABLES {quoted_tbl} WRITE;\n/*!40000 ALTER TABLE {quoted_tbl} DISABLE KEYS */;\n",
                            tbl.name
                        ))
                        .await?;
                }

                for row in chunk_res.rows {
                    total_rows_exported += 1;
                    let values_tuple = format!(
                        "({})",
                        row.iter()
                            .enumerate()
                            .map(|(i, val)| {
                                let col_type = columns_meta
                                    .get(i)
                                    .map(|c| c.data_type.as_str())
                                    .unwrap_or("");
                                format_sql_value_typed(val, col_type)
                            })
                            .collect::<Vec<_>>()
                            .join(", ")
                    );

                    if rows_in_current_batch == 0 {
                        // Start a new multi-row INSERT statement
                        writer
                            .write_str(&format!(
                                "INSERT INTO {quoted_tbl}{} VALUES\n",
                                cols_clause
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
                                "INSERT INTO {quoted_tbl}{} VALUES\n",
                                cols_clause
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
                        "/*!40000 ALTER TABLE {} ENABLE KEYS */;\nUNLOCK TABLES;\n\n",
                        quote_ident_mysql(&tbl.name)
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
                    .write_str(&format!("DROP VIEW IF EXISTS {};\n", quote_ident_mysql(&v.name)))
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
                .write_str(&format!("DROP {} IF EXISTS {};\n", kind, quote_ident_mysql(&r.name)))
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
                .write_str(&format!("DROP TRIGGER IF EXISTS {};\n", quote_ident_mysql(&trg.name)))
                .await?;

            let show_sql = format!("SHOW CREATE TRIGGER {}.{}", quote_ident_mysql(database), quote_ident_mysql(&trg.name));
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
    if let Some(w) = ftwrl_warning {
        warnings.push(w);
    }
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
        // VARCHAR values with 0x prefix must always be quoted
        assert_eq!(
            format_sql_value(&serde_json::json!("0xDEADBEEF")),
            "'0xDEADBEEF'"
        );
    }

    #[test]
    fn test_format_sql_value_typed() {
        // 1. VARCHAR containing "0xDEADBEEF" -> quoted string '0xDEADBEEF'
        assert_eq!(
            format_sql_value_typed(&serde_json::json!("0xDEADBEEF"), "varchar(100)"),
            "'0xDEADBEEF'"
        );
        assert_eq!(
            format_sql_value_typed(&serde_json::json!("0x1234"), "char(10)"),
            "'0x1234'"
        );

        // 2. BINARY with bytes that are valid UTF-8 (e.g. ASCII "Hello" -> 48656C6C6F) -> 0x48656C6C6F
        assert_eq!(
            format_sql_value_typed(&serde_json::json!("48656C6C6F"), "binary(16)"),
            "0x48656C6C6F"
        );
        assert_eq!(
            format_sql_value_typed(&serde_json::json!("0x48656C6C6F"), "varbinary(255)"),
            "0x48656C6C6F"
        );

        // 3. BLOB with bytes that are not valid UTF-8 -> 0x00FF
        assert_eq!(
            format_sql_value_typed(&serde_json::json!("00FF"), "blob"),
            "0x00FF"
        );
        assert_eq!(
            format_sql_value_typed(&serde_json::json!("0x00FF"), "tinyblob"),
            "0x00FF"
        );

        // Empty binary -> ''
        assert_eq!(
            format_sql_value_typed(&serde_json::json!(""), "blob"),
            "''"
        );

        // NULL binary -> NULL
        assert_eq!(
            format_sql_value_typed(&serde_json::Value::Null, "blob"),
            "NULL"
        );
    }

    struct MockQueryBackend {
        responses: std::collections::HashMap<String, super::super::models::QueryExecutionResult>,
        failing_queries: std::collections::HashSet<String>,
        executed_queries: std::sync::Mutex<Vec<String>>,
    }

    impl MockQueryBackend {
        fn with_responses(
            responses: std::collections::HashMap<
                String,
                super::super::models::QueryExecutionResult,
            >,
        ) -> Self {
            Self {
                responses,
                failing_queries: std::collections::HashSet::new(),
                executed_queries: std::sync::Mutex::new(Vec::new()),
            }
        }

        fn was_executed(&self, query_prefix: &str) -> bool {
            let list = self.executed_queries.lock().unwrap();
            list.iter().any(|q| q.starts_with(query_prefix))
        }
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
            if let Ok(mut list) = self.executed_queries.lock() {
                list.push(sql.to_string());
            }
            if self.failing_queries.contains(sql) {
                return async move {
                    Err(PyroError::Database(format!(
                        "Access denied; you need (at least one of) the RELOAD privilege(s) for this operation for query `{sql}`"
                    )))
                }
                .boxed();
            }
            let res = self
                .responses
                .get(sql)
                .cloned()
                .or_else(|| {
                    for (k, v) in &self.responses {
                        if sql.contains(k) {
                            return Some(v.clone());
                        }
                    }
                    None
                })
                .unwrap_or_else(|| {
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

    #[test]
    fn strategy_selected_by_engine_and_version() {
        assert_eq!(
            detect_snapshot_strategy("10.11.4-MariaDB-log"),
            SnapshotStrategy::MariaDbSnapshotStatus
        );
        assert_eq!(
            detect_snapshot_strategy("11.4.2-MariaDB"),
            SnapshotStrategy::MariaDbSnapshotStatus
        );
        assert_eq!(
            detect_snapshot_strategy("8.0.35"),
            SnapshotStrategy::MySqlFtwrl
        );
        assert_eq!(
            detect_snapshot_strategy("8.4.0"),
            SnapshotStrategy::MySqlFtwrl
        );
        assert_eq!(
            detect_snapshot_strategy("5.7.42"),
            SnapshotStrategy::MySqlFtwrl
        );
    }

    #[test]
    fn parse_mariadb_snapshot_status_works() {
        let mut map = std::collections::HashMap::new();
        map.insert(
            "BINLOG_SNAPSHOT_FILE".to_string(),
            "mariadb-bin.000042".to_string(),
        );
        map.insert("BINLOG_SNAPSHOT_POSITION".to_string(), "12345".to_string());

        let coords = parse_mariadb_snapshot_status(&map, Some("0-1-500"));
        assert_eq!(
            coords,
            Some("File: mariadb-bin.000042, Position: 12345; GTID: 0-1-500".to_string())
        );

        let coords_no_gtid = parse_mariadb_snapshot_status(&map, None);
        assert_eq!(
            coords_no_gtid,
            Some("File: mariadb-bin.000042, Position: 12345".to_string())
        );

        let empty_map = std::collections::HashMap::new();
        assert_eq!(parse_mariadb_snapshot_status(&empty_map, None), None);
    }

    #[test]
    fn parse_mysql_binary_log_status_row_works() {
        let row_84 = vec![
            serde_json::json!("binlog.000008"),
            serde_json::json!(4321),
            serde_json::json!(""),
            serde_json::json!(""),
            serde_json::json!("3E11FA47-71CA-11E1-9E33-C80AA9E295A4:1-5"),
        ];
        let coords = parse_binary_log_status_row(&row_84, None);
        assert_eq!(
            coords,
            Some("File: binlog.000008, Position: 4321; GTID: 3E11FA47-71CA-11E1-9E33-C80AA9E295A4:1-5".to_string())
        );

        let row_old = vec![
            serde_json::json!("mysql-bin.000001"),
            serde_json::json!(107),
            serde_json::json!(""),
            serde_json::json!(""),
        ];
        let coords_fallback = parse_binary_log_status_row(&row_old, Some("UUID:1-2"));
        assert_eq!(
            coords_fallback,
            Some("File: mysql-bin.000001, Position: 107; GTID: UUID:1-2".to_string())
        );
    }

    #[tokio::test]
    async fn atomic_detection_mariadb_reads_snapshot_status_and_binlog_gtid_pos() {
        let mut responses = std::collections::HashMap::new();
        responses.insert(
            "SHOW STATUS LIKE 'binlog_snapshot_%'".to_string(),
            super::super::models::QueryExecutionResult {
                columns: vec!["Variable_name".into(), "Value".into()],
                rows: vec![
                    vec![
                        serde_json::json!("binlog_snapshot_file"),
                        serde_json::json!("mariadb-bin.000010"),
                    ],
                    vec![
                        serde_json::json!("binlog_snapshot_position"),
                        serde_json::json!("9876"),
                    ],
                ],
                affected_rows: 0,
                execution_time_ms: 1,
                message: String::new(),
                warning: None,
            },
        );
        responses.insert(
            "SELECT BINLOG_GTID_POS('mariadb-bin.000010', 9876)".to_string(),
            super::super::models::QueryExecutionResult {
                columns: vec!["BINLOG_GTID_POS('mariadb-bin.000010', 9876)".into()],
                rows: vec![vec![serde_json::json!("0-1-777")]],
                affected_rows: 0,
                execution_time_ms: 1,
                message: String::new(),
                warning: None,
            },
        );

        let backend = MockQueryBackend::with_responses(responses);
        // Even when include_replication_coordinates is false, MariaDB always reads snapshot coordinates
        let (coords, warning) =
            detect_binlog_coordinates_atomic(&backend, "10.11.4-MariaDB-log", false).await;
        assert_eq!(
            coords,
            Some("File: mariadb-bin.000010, Position: 9876; GTID: 0-1-777".to_string())
        );
        assert!(warning.is_none());
        assert!(backend.was_executed("SELECT BINLOG_GTID_POS"));
        assert!(!backend.was_executed("SELECT @@gtid_binlog_pos"));
        assert!(!backend.was_executed("SELECT @@gtid_current_pos"));
    }

    #[tokio::test]
    async fn atomic_detection_mariadb_gtid_failure_leaves_gtid_empty_without_fallback() {
        let mut responses = std::collections::HashMap::new();
        responses.insert(
            "SHOW STATUS LIKE 'binlog_snapshot_%'".to_string(),
            super::super::models::QueryExecutionResult {
                columns: vec!["Variable_name".into(), "Value".into()],
                rows: vec![
                    vec![
                        serde_json::json!("binlog_snapshot_file"),
                        serde_json::json!("mariadb-bin.000010"),
                    ],
                    vec![
                        serde_json::json!("binlog_snapshot_position"),
                        serde_json::json!("9876"),
                    ],
                ],
                affected_rows: 0,
                execution_time_ms: 1,
                message: String::new(),
                warning: None,
            },
        );
        // BINLOG_GTID_POS returns NULL
        responses.insert(
            "SELECT BINLOG_GTID_POS('mariadb-bin.000010', 9876)".to_string(),
            super::super::models::QueryExecutionResult {
                columns: vec!["BINLOG_GTID_POS".into()],
                rows: vec![vec![serde_json::Value::Null]],
                affected_rows: 0,
                execution_time_ms: 1,
                message: String::new(),
                warning: None,
            },
        );
        // Fake dynamic vars to verify they are NEVER queried as fallback
        responses.insert(
            "SELECT @@gtid_binlog_pos".to_string(),
            super::super::models::QueryExecutionResult {
                columns: vec!["@@gtid_binlog_pos".into()],
                rows: vec![vec![serde_json::json!("9-9-999")]],
                affected_rows: 0,
                execution_time_ms: 1,
                message: String::new(),
                warning: None,
            },
        );

        let backend = MockQueryBackend::with_responses(responses);
        let (coords, warning) =
            detect_binlog_coordinates_atomic(&backend, "10.11.4-MariaDB-log", true).await;
        // File and Position are captured, but GTID is empty
        assert_eq!(
            coords,
            Some("File: mariadb-bin.000010, Position: 9876".to_string())
        );
        assert!(warning.is_none());
        assert!(backend.was_executed("SELECT BINLOG_GTID_POS"));
        assert!(!backend.was_executed("SELECT @@gtid_binlog_pos"));
        assert!(!backend.was_executed("SELECT @@gtid_current_pos"));
    }

    #[tokio::test]
    async fn atomic_detection_mysql_without_coordinates_flag_does_not_ftwrl() {
        let backend = MockQueryBackend::with_responses(std::collections::HashMap::new());
        let (coords, warning) = detect_binlog_coordinates_atomic(&backend, "8.0.35", false).await;
        assert_eq!(coords, None);
        assert_eq!(warning, None);
        assert!(!backend.was_executed("FLUSH TABLES WITH READ LOCK"));
        assert!(!backend.was_executed("ROLLBACK"));
        assert!(!backend.was_executed("UNLOCK TABLES"));
    }

    #[tokio::test]
    async fn atomic_detection_mysql_with_coordinates_flag_runs_ftwrl_and_reads_coords() {
        let mut responses = std::collections::HashMap::new();
        responses.insert(
            "SHOW BINARY LOG STATUS".to_string(),
            super::super::models::QueryExecutionResult {
                columns: vec![
                    "File".into(),
                    "Position".into(),
                    "Binlog_Do_DB".into(),
                    "Binlog_Ignore_DB".into(),
                    "Executed_Gtid_Set".into(),
                ],
                rows: vec![vec![
                    serde_json::json!("binlog.000008"),
                    serde_json::json!(4321),
                    serde_json::json!(""),
                    serde_json::json!(""),
                    serde_json::json!("3E11FA47-71CA-11E1-9E33-C80AA9E295A4:1-5"),
                ]],
                affected_rows: 0,
                execution_time_ms: 1,
                message: String::new(),
                warning: None,
            },
        );

        let backend = MockQueryBackend::with_responses(responses);
        let (coords, warning) = detect_binlog_coordinates_atomic(&backend, "8.4.0", true).await;
        assert_eq!(
            coords,
            Some("File: binlog.000008, Position: 4321; GTID: 3E11FA47-71CA-11E1-9E33-C80AA9E295A4:1-5".to_string())
        );
        assert!(warning.is_none());
        assert!(backend.was_executed("FLUSH TABLES WITH READ LOCK"));
        assert!(backend.was_executed("UNLOCK TABLES"));
    }

    #[tokio::test]
    async fn atomic_detection_mysql_ftwrl_failure_leaves_none_and_warns() {
        let mut failing_queries = std::collections::HashSet::new();
        failing_queries.insert("FLUSH TABLES WITH READ LOCK".to_string());
        let backend = MockQueryBackend {
            responses: std::collections::HashMap::new(),
            failing_queries,
            executed_queries: std::sync::Mutex::new(Vec::new()),
        };
        let (coords, warning) = detect_binlog_coordinates_atomic(&backend, "8.0.35", true).await;
        assert_eq!(coords, None);
        assert!(warning.is_some());
        assert!(warning.unwrap().contains("FLUSH TABLES WITH READ LOCK"));
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

        let backend = MockQueryBackend::with_responses(responses);
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

    #[tokio::test]
    async fn sql_dump_escapes_backticks_and_semicolons_in_table_and_view_names() {
        let table_name = "x`; DROP DATABASE prod; -- ";
        let view_name = "v`; DROP DATABASE prod; -- ";

        let mut responses = std::collections::HashMap::new();
        responses.insert(
            "SELECT VERSION()".to_string(),
            super::super::models::QueryExecutionResult {
                columns: vec!["VERSION()".into()],
                rows: vec![vec![serde_json::json!("8.0.35")]],
                affected_rows: 0,
                execution_time_ms: 1,
                message: String::new(),
                warning: None,
            },
        );
        responses.insert(
            "FROM information_schema.TABLES".to_string(),
            super::super::models::QueryExecutionResult {
                columns: vec![
                    "TABLE_NAME".into(),
                    "TABLE_TYPE".into(),
                    "ENGINE".into(),
                    "TABLE_ROWS".into(),
                    "DATA_LENGTH".into(),
                    "INDEX_LENGTH".into(),
                    "TABLE_COLLATION".into(),
                    "TABLE_COMMENT".into(),
                ],
                rows: vec![
                    vec![
                        serde_json::json!(table_name),
                        serde_json::json!("BASE TABLE"),
                        serde_json::json!("InnoDB"),
                        serde_json::json!(1),
                        serde_json::json!(16384),
                        serde_json::json!(0),
                        serde_json::json!("utf8mb4_unicode_ci"),
                        serde_json::json!(""),
                    ],
                    vec![
                        serde_json::json!(view_name),
                        serde_json::json!("VIEW"),
                        serde_json::json!(null),
                        serde_json::json!(0),
                        serde_json::json!(0),
                        serde_json::json!(0),
                        serde_json::json!(null),
                        serde_json::json!(""),
                    ],
                ],
                affected_rows: 0,
                execution_time_ms: 1,
                message: String::new(),
                warning: None,
            },
        );
        responses.insert(
            "FROM information_schema.COLUMNS".to_string(),
            super::super::models::QueryExecutionResult {
                columns: vec![
                    "COLUMN_NAME".into(),
                    "ORDINAL_POSITION".into(),
                    "COLUMN_DEFAULT".into(),
                    "IS_NULLABLE".into(),
                    "DATA_TYPE".into(),
                    "COLUMN_TYPE".into(),
                    "COLUMN_KEY".into(),
                    "EXTRA".into(),
                    "COLUMN_COMMENT".into(),
                ],
                rows: vec![vec![
                    serde_json::json!("id"),
                    serde_json::json!(1),
                    serde_json::json!(null),
                    serde_json::json!("NO"),
                    serde_json::json!("int"),
                    serde_json::json!("int(11)"),
                    serde_json::json!("PRI"),
                    serde_json::json!(""),
                    serde_json::json!(""),
                ]],
                affected_rows: 0,
                execution_time_ms: 1,
                message: String::new(),
                warning: None,
            },
        );
        responses.insert(
            "FROM information_schema.KEY_COLUMN_USAGE".to_string(),
            super::super::models::QueryExecutionResult {
                columns: vec!["COLUMN_NAME".into()],
                rows: vec![vec![serde_json::json!("id")]],
                affected_rows: 0,
                execution_time_ms: 1,
                message: String::new(),
                warning: None,
            },
        );
        responses.insert(
            "SHOW CREATE TABLE".to_string(),
            super::super::models::QueryExecutionResult {
                columns: vec!["Table".into(), "Create Table".into()],
                rows: vec![vec![
                    serde_json::json!(table_name),
                    serde_json::json!("CREATE TABLE `x``; DROP DATABASE prod; -- ` (\n  `id` int(11) NOT NULL\n) ENGINE=InnoDB"),
                ]],
                affected_rows: 0,
                execution_time_ms: 1,
                message: String::new(),
                warning: None,
            },
        );
        responses.insert(
            "SHOW CREATE VIEW".to_string(),
            super::super::models::QueryExecutionResult {
                columns: vec!["View".into(), "Create View".into()],
                rows: vec![vec![
                    serde_json::json!(view_name),
                    serde_json::json!("CREATE VIEW `v``; DROP DATABASE prod; -- ` AS select 1 AS `1`"),
                ]],
                affected_rows: 0,
                execution_time_ms: 1,
                message: String::new(),
                warning: None,
            },
        );
        responses.insert(
            "SELECT `id` FROM".to_string(),
            super::super::models::QueryExecutionResult {
                columns: vec!["id".into()],
                rows: vec![vec![serde_json::json!(42)]],
                affected_rows: 0,
                execution_time_ms: 1,
                message: String::new(),
                warning: None,
            },
        );

        let backend = MockQueryBackend::with_responses(responses);
        let req = SqlDumpRequest {
            database: "test_db".to_string(),
            tables: None,
            export_mode: "structure_and_data".to_string(),
            include_drop_table: true,
            include_routines: false,
            include_triggers: false,
            include_views: true,
            include_create_database: Some(false),
            insert_batch_size: None,
            output_file_path: None,
            include_replication_coordinates: Some(false),
        };

        let summary = write_sql_dump(&backend, req).await.unwrap();
        let sql = summary.sql_preview.expect("preview should be generated in memory");

        // Verify properly quoted identifiers with doubled backticks
        assert!(sql.contains("DROP TABLE IF EXISTS `x``; DROP DATABASE prod; -- `;"), "SQL: {sql}");
        assert!(sql.contains("LOCK TABLES `x``; DROP DATABASE prod; -- ` WRITE;"), "SQL: {sql}");
        assert!(sql.contains("INSERT INTO `x``; DROP DATABASE prod; -- ` (`id`) VALUES"), "SQL: {sql}");
        assert!(sql.contains("/*!40000 ALTER TABLE `x``; DROP DATABASE prod; -- ` ENABLE KEYS */;"), "SQL: {sql}");
        assert!(sql.contains("DROP VIEW IF EXISTS `v``; DROP DATABASE prod; -- `;"), "SQL: {sql}");

        // Ensure unescaped raw identifiers never appear in DDL/DML statements
        assert!(!sql.contains("DROP TABLE IF EXISTS `x`; DROP DATABASE prod; -- `;"), "SQL should not contain unescaped backtick");
        assert!(!sql.contains("DROP VIEW IF EXISTS `v`; DROP DATABASE prod; -- `;"), "SQL should not contain unescaped backtick");
    }
}
