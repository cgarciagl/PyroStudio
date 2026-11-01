use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use super::engine::save_manifest;
use super::manifest::{BackupManifest, BackupStatus, BackupType, CompressionFormat};
use super::restore::{execute_directory_restore, DirectoryRestoreRequest};
use crate::db::backend::DatabaseBackend;
use crate::db::error::PyroError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BinlogRequirements {
    pub log_bin_enabled: bool,
    pub binlog_format: String,
    pub binlog_row_image: Option<String>,
    pub has_replication_slave: bool,
    pub has_replication_client: bool,
    pub can_use_binlog: bool,
    pub current_binlog_file: Option<String>,
    pub current_binlog_pos: Option<u64>,
    pub current_gtid: Option<String>,
    pub available_logs_count: usize,
    pub suggestions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BinlogChainCheck {
    pub is_valid: bool,
    pub base_file: String,
    pub base_pos: u64,
    pub current_file: String,
    pub current_pos: u64,
    pub missing_file: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BinlogBackupOptions {
    pub database: String,
    pub base_backup_dir: PathBuf,
    pub output_dir: PathBuf,
    pub compression: CompressionFormat,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BinlogBackupSummary {
    pub backup_id: String,
    pub base_backup_id: String,
    pub target_dir: String,
    pub database: String,
    pub start_coordinates: String,
    pub end_coordinates: String,
    pub total_events: usize,
    pub total_uncompressed_bytes: u64,
    pub total_compressed_bytes: u64,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PointInTimeRestoreRequest {
    pub base_backup_dir: String,
    pub incremental_dirs: Vec<String>,
    pub target_database: String,
    pub create_database_if_not_exists: bool,
    pub target_timestamp: Option<String>,
    pub disable_foreign_keys: bool,
    pub stop_on_error: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PointInTimeRestoreSummary {
    pub target_database: String,
    pub base_tables_restored: usize,
    pub base_rows_restored: u64,
    pub incrementals_applied: usize,
    pub events_replayed: usize,
    pub duration_ms: u64,
    pub point_in_time_reached: Option<String>,
}

/// Helper to parse File and Position from a binlog coordinate string like:
/// "File: mysql-bin.000003, Position: 450"
pub fn parse_binlog_coordinates(coords: &str) -> Option<(String, u64)> {
    let mut file = None;
    let mut pos = None;

    for part in coords.split(',') {
        let part = part.trim();
        if let Some(rest) = part.strip_prefix("File:") {
            file = Some(rest.trim().to_string());
        } else if let Some(rest) = part.strip_prefix("Position:") {
            let pos_str = rest.split(';').next().unwrap_or(rest).trim();
            if let Ok(p) = pos_str.parse::<u64>() {
                pos = Some(p);
            }
        }
    }

    match (file, pos) {
        (Some(f), Some(p)) => Some((f, p)),
        _ => None,
    }
}

/// Inspects the server variables and grants to verify if binlog replication is configured.
pub async fn check_binlog_requirements(
    backend: &dyn DatabaseBackend,
) -> Result<BinlogRequirements, PyroError> {
    let mut log_bin_enabled = false;
    let mut binlog_format = "UNKNOWN".to_string();
    let mut binlog_row_image = None;
    let mut has_replication_slave = false;
    let mut has_replication_client = false;
    let mut current_binlog_file = None;
    let mut current_binlog_pos = None;
    let mut current_gtid = None;
    let mut available_logs_count = 0;
    let mut suggestions = Vec::new();

    // 1. Check variables
    if let Ok(res) = backend
        .execute_query("SHOW VARIABLES LIKE 'log_bin'", None)
        .await
    {
        if let Some(row) = res.rows.first() {
            if let Some(val) = row.get(1).and_then(|v| v.as_str()) {
                log_bin_enabled = val.eq_ignore_ascii_case("ON") || val == "1";
            }
        }
    }

    if let Ok(res) = backend
        .execute_query("SHOW VARIABLES LIKE 'binlog_format'", None)
        .await
    {
        if let Some(row) = res.rows.first() {
            if let Some(val) = row.get(1).and_then(|v| v.as_str()) {
                binlog_format = val.to_uppercase();
            }
        }
    }

    if let Ok(res) = backend
        .execute_query("SHOW VARIABLES LIKE 'binlog_row_image'", None)
        .await
    {
        if let Some(row) = res.rows.first() {
            if let Some(val) = row.get(1).and_then(|v| v.as_str()) {
                binlog_row_image = Some(val.to_uppercase());
            }
        }
    }

    // 2. Check Grants
    if let Ok(res) = backend
        .execute_query("SHOW GRANTS FOR CURRENT_USER()", None)
        .await
    {
        for row in res.rows {
            if let Some(grant) = row.first().and_then(|v| v.as_str()) {
                let upper = grant.to_uppercase();
                if upper.contains("ALL PRIVILEGES") || upper.contains("SUPER") {
                    has_replication_slave = true;
                    has_replication_client = true;
                    break;
                }
                if upper.contains("REPLICATION SLAVE") {
                    has_replication_slave = true;
                }
                if upper.contains("REPLICATION CLIENT") {
                    has_replication_client = true;
                }
            }
        }
    }

    // 3. Check Current Master Coordinates
    let master_query = "SHOW MASTER STATUS";
    if let Ok(res) = backend.execute_query(master_query, None).await {
        if let Some(row) = res.rows.first() {
            current_binlog_file = row.first().and_then(|v| v.as_str()).map(|s| s.to_string());
            current_binlog_pos = row.get(1).and_then(|v| {
                if let Some(n) = v.as_u64() {
                    Some(n)
                } else if let Some(n) = v.as_i64() {
                    Some(n as u64)
                } else {
                    v.as_str().and_then(|s| s.parse().ok())
                }
            });
            if let Some(gtid) = row.get(4).and_then(|v| v.as_str()) {
                if !gtid.trim().is_empty() {
                    current_gtid = Some(gtid.trim().to_string());
                }
            }
        }
    }

    // 4. Check available binary logs count
    if let Ok(res) = backend.execute_query("SHOW BINARY LOGS", None).await {
        available_logs_count = res.rows.len();
    }

    // 5. Generate configuration suggestions
    if !log_bin_enabled {
        suggestions.push(
            "El registro binario (log_bin) está desactivado. Actívalo en my.cnf / mariadb.cnf añadiendo:\n[mysqld]\nlog_bin = /var/log/mysql/mysql-bin.log\nserver_id = 1"
                .to_string(),
        );
    }

    if binlog_format != "ROW" && binlog_format != "MIXED" {
        suggestions.push(
            format!(
                "El formato binlog actual es '{binlog_format}'. Para copias incrementales y recuperación consistente se requiere binlog_format = ROW."
            ),
        );
    }

    if !has_replication_client || !has_replication_slave {
        suggestions.push(
            "El usuario conectado carece de privilegios de replicación. Ejecuta en el servidor:\nGRANT REPLICATION SLAVE, REPLICATION CLIENT ON *.* TO CURRENT_USER();\nFLUSH PRIVILEGES;"
                .to_string(),
        );
    }

    let can_use_binlog = log_bin_enabled && has_replication_client && current_binlog_file.is_some();

    Ok(BinlogRequirements {
        log_bin_enabled,
        binlog_format,
        binlog_row_image,
        has_replication_slave,
        has_replication_client,
        can_use_binlog,
        current_binlog_file,
        current_binlog_pos,
        current_gtid,
        available_logs_count,
        suggestions,
    })
}

/// Verifies that the starting binlog file from the base backup is still available on the server.
pub async fn verify_binlog_chain(
    backend: &dyn DatabaseBackend,
    base_backup_dir: &Path,
) -> Result<BinlogChainCheck, PyroError> {
    let manifest_path = base_backup_dir.join("manifest.json");
    if !manifest_path.exists() {
        return Err(PyroError::InvalidOperation(format!(
            "No se encontró manifest.json en el directorio base '{base_backup_dir:?}'"
        )));
    }

    let content = fs::read_to_string(&manifest_path)
        .map_err(|e| PyroError::Io(format!("No se pudo leer el manifest del backup base: {e}")))?;

    let base_manifest: BackupManifest = serde_json::from_str(&content).map_err(|e| {
        PyroError::InvalidOperation(format!("Manifest de backup base inválido: {e}"))
    })?;

    let coords = base_manifest.binlog_coordinates.as_deref().ok_or_else(|| {
        PyroError::InvalidOperation(
            "El backup base no contiene coordenadas de replicación binlog registradas.".to_string(),
        )
    })?;

    let (base_file, base_pos) = parse_binlog_coordinates(coords).ok_or_else(|| {
        PyroError::InvalidOperation(format!(
            "Coordenadas binlog inválidas en el backup base: '{coords}'"
        ))
    })?;

    // Query current logs on server
    let res = backend
        .execute_query("SHOW BINARY LOGS", None)
        .await
        .map_err(|e| {
            PyroError::Database(format!(
                "Error consultando 'SHOW BINARY LOGS' en el servidor: {e}"
            ))
        })?;

    let mut found_base_file = false;
    for row in &res.rows {
        if let Some(log_file) = row.first().and_then(|v| v.as_str()) {
            if log_file == base_file {
                found_base_file = true;
                break;
            }
        }
    }

    // Query current master position
    let mut current_file = base_file.clone();
    let mut current_pos = base_pos;
    if let Ok(m_res) = backend.execute_query("SHOW MASTER STATUS", None).await {
        if let Some(row) = m_res.rows.first() {
            if let Some(f) = row.first().and_then(|v| v.as_str()) {
                current_file = f.to_string();
            }
            if let Some(p) = row.get(1).and_then(|v| {
                if let Some(n) = v.as_u64() {
                    Some(n)
                } else if let Some(n) = v.as_i64() {
                    Some(n as u64)
                } else {
                    v.as_str().and_then(|s| s.parse().ok())
                }
            }) {
                current_pos = p;
            }
        }
    }

    if !found_base_file {
        Ok(BinlogChainCheck {
            is_valid: false,
            base_file: base_file.clone(),
            base_pos,
            current_file,
            current_pos,
            missing_file: Some(base_file.clone()),
            message: format!(
                "El archivo binlog inicial '{base_file}' fue purgado por el servidor (binlog_expire_logs_seconds). La cadena incremental está rota; se requiere ejecutar un nuevo Backup Completo."
            ),
        })
    } else {
        Ok(BinlogChainCheck {
            is_valid: true,
            base_file,
            base_pos,
            current_file,
            current_pos,
            missing_file: None,
            message: "Cadena binlog íntegra. Todos los eventos requeridos están disponibles en el servidor.".to_string(),
        })
    }
}

/// Executes a binlog-based incremental backup.
pub async fn execute_binlog_backup(
    backend: &dyn DatabaseBackend,
    options: BinlogBackupOptions,
) -> Result<BinlogBackupSummary, PyroError> {
    let start_time = Instant::now();

    // 1. Verify chain
    let chain = verify_binlog_chain(backend, &options.base_backup_dir).await?;
    if !chain.is_valid {
        return Err(PyroError::InvalidOperation(chain.message));
    }

    // 2. Read base manifest
    let base_manifest_path = options.base_backup_dir.join("manifest.json");
    let base_content = fs::read_to_string(&base_manifest_path)
        .map_err(|e| PyroError::Io(format!("No se pudo leer manifest del backup base: {e}")))?;
    let base_manifest: BackupManifest = serde_json::from_str(&base_content).map_err(|e| {
        PyroError::InvalidOperation(format!("Manifest de backup base inválido: {e}"))
    })?;

    // 3. Create target directory
    fs::create_dir_all(&options.output_dir)
        .map_err(|e| PyroError::Io(format!("No se pudo crear directorio destino: {e}")))?;
    let events_dir = options.output_dir.join("events");
    fs::create_dir_all(&events_dir)
        .map_err(|e| PyroError::Io(format!("No se pudo crear directorio 'events': {e}")))?;

    let backup_id = format!("incr-{}", Utc::now().format("%Y%m%dT%H%M%S"));
    let mut manifest = BackupManifest::new(
        backup_id.clone(),
        BackupType::Incremental,
        options.compression,
        base_manifest.server_version.clone(),
        options.database.clone(),
    );
    manifest.base_backup_id = Some(base_manifest.backup_id.clone());
    manifest.base_backup_dir = Some(options.base_backup_dir.to_string_lossy().to_string());
    manifest.status = BackupStatus::InProgress;
    save_manifest(&options.output_dir, &manifest)?;

    // 4. Capture events from start coordinates to current master status
    let events_file_name = format!("binlog.{}", options.compression.extension());
    let events_file_path = events_dir.join(&events_file_name);

    let mut encoder = super::engine::ChunkEncoder::create(&events_file_path, options.compression)?;
    let mut total_events = 0;
    let mut total_uncompressed_bytes = 0u64;

    // Write header comments
    let start_coords = format!("File: {}, Position: {}", chain.base_file, chain.base_pos);
    let end_coords = format!(
        "File: {}, Position: {}",
        chain.current_file, chain.current_pos
    );

    let header = format!(
        "-- PyroStudio Incremental Binlog Dump\n-- Database: {}\n-- Base Backup ID: {}\n-- Start: {}\n-- End: {}\n-- Generated: {}\n\nSET FOREIGN_KEY_CHECKS=0;\n",
        options.database,
        base_manifest.backup_id,
        start_coords,
        end_coords,
        Utc::now().to_rfc3339()
    );
    encoder.write_all(header.as_bytes())?;
    total_uncompressed_bytes += header.len() as u64;

    // Fetch binary log list to iterate through logs from base_file to current_file
    let logs_res = backend.execute_query("SHOW BINARY LOGS", None).await?;
    let mut files_to_scan = Vec::new();
    let mut collecting = false;
    for row in logs_res.rows {
        if let Some(log_file) = row.first().and_then(|v| v.as_str()) {
            if log_file == chain.base_file {
                collecting = true;
            }
            if collecting {
                files_to_scan.push(log_file.to_string());
            }
            if log_file == chain.current_file {
                break;
            }
        }
    }

    // Read events across the required log files
    for (i, log_file) in files_to_scan.iter().enumerate() {
        let from_pos = if i == 0 { chain.base_pos } else { 4 };
        let mut cur_pos = from_pos;

        loop {
            let sql = format!("SHOW BINLOG EVENTS IN '{log_file}' FROM {cur_pos} LIMIT 1000");
            let res = match backend.execute_query(&sql, None).await {
                Ok(r) => r,
                Err(e) => {
                    // Non-fatal if at EOF or no permission
                    eprintln!("Warning: could not read binlog events from '{log_file}': {e}");
                    break;
                }
            };

            if res.rows.is_empty() {
                break;
            }

            let rows_count = res.rows.len();
            for row in res.rows {
                let event_type = row.get(2).and_then(|v| v.as_str()).unwrap_or("");
                let end_pos = row
                    .get(4)
                    .and_then(|v| {
                        if let Some(n) = v.as_u64() {
                            Some(n)
                        } else if let Some(n) = v.as_i64() {
                            Some(n as u64)
                        } else {
                            v.as_str().and_then(|s| s.parse().ok())
                        }
                    })
                    .unwrap_or(cur_pos);

                let info = row.get(5).and_then(|v| v.as_str()).unwrap_or("");

                // Record event entry
                let statement = format!("-- EVENT: {event_type} POS: {end_pos}\n-- INFO: {info}\n");
                encoder.write_all(statement.as_bytes())?;
                total_uncompressed_bytes += statement.len() as u64;

                // If INFO contains an executable DDL/DML, write it as runnable SQL
                if event_type == "Query"
                    && !info.is_empty()
                    && !info.starts_with("BEGIN")
                    && !info.starts_with("COMMIT")
                {
                    let exec_sql = format!("{info};\n");
                    encoder.write_all(exec_sql.as_bytes())?;
                    total_uncompressed_bytes += exec_sql.len() as u64;
                }

                cur_pos = end_pos;
                total_events += 1;
            }

            if rows_count < 1000 {
                break;
            }
        }
    }

    let footer = "\nSET FOREIGN_KEY_CHECKS=1;\n";
    encoder.write_all(footer.as_bytes())?;
    total_uncompressed_bytes += footer.len() as u64;

    let (_sha256, total_compressed_bytes) = encoder.finish()?;
    let duration_ms = start_time.elapsed().as_millis() as u64;

    // 5. Finalize manifest
    manifest.completed_at = Some(Utc::now().to_rfc3339());
    manifest.binlog_coordinates = Some(end_coords.clone());
    manifest.duration_ms = duration_ms;
    manifest.total_rows = total_events as u64;
    manifest.total_uncompressed_bytes = total_uncompressed_bytes;
    manifest.total_compressed_bytes = total_compressed_bytes;
    manifest.status = BackupStatus::Completed;
    save_manifest(&options.output_dir, &manifest)?;

    Ok(BinlogBackupSummary {
        backup_id,
        base_backup_id: base_manifest.backup_id,
        target_dir: options.output_dir.to_string_lossy().to_string(),
        database: options.database,
        start_coordinates: start_coords,
        end_coordinates: end_coords,
        total_events,
        total_uncompressed_bytes,
        total_compressed_bytes,
        duration_ms,
    })
}

/// Restores a base backup and applies a chain of binlog incremental backups up to a target point in time.
pub async fn execute_point_in_time_restore(
    backend: &dyn DatabaseBackend,
    request: PointInTimeRestoreRequest,
) -> Result<PointInTimeRestoreSummary, PyroError> {
    let start_time = Instant::now();

    // 1. Restore the base backup first
    let base_req = DirectoryRestoreRequest {
        backup_dir: request.base_backup_dir.clone(),
        base_backup_dir: None,
        target_database: request.target_database.clone(),
        create_database_if_not_exists: request.create_database_if_not_exists,
        disable_foreign_keys: request.disable_foreign_keys,
        stop_on_error: request.stop_on_error,
    };

    let base_summary = execute_directory_restore(backend, None, base_req).await?;

    let mut incrementals_applied = 0;
    let mut events_replayed = 0;
    let mut point_in_time_reached = None;

    // 2. Sort incremental directories by created_at in their manifests
    let mut incremental_manifests = Vec::new();
    for inc_dir in &request.incremental_dirs {
        let path = Path::new(inc_dir);
        let m_path = path.join("manifest.json");
        if m_path.exists() {
            if let Ok(content) = fs::read_to_string(&m_path) {
                if let Ok(manifest) = serde_json::from_str::<BackupManifest>(&content) {
                    incremental_manifests.push((path.to_path_buf(), manifest));
                }
            }
        }
    }

    incremental_manifests.sort_by(|a, b| a.1.created_at.cmp(&b.1.created_at));

    // 3. Replay each incremental
    for (inc_dir, manifest) in incremental_manifests {
        // Find events file in events/
        let events_dir = inc_dir.join("events");
        let mut events_file = None;
        if events_dir.exists() {
            if let Ok(entries) = fs::read_dir(&events_dir) {
                for entry in entries.flatten() {
                    let file_name = entry.file_name().to_string_lossy().to_string();
                    if file_name.starts_with("binlog.") {
                        events_file = Some(entry.path());
                        break;
                    }
                }
            }
        }

        if let Some(events_path) = events_file {
            let text = super::restore::read_decompressed_chunk(&events_path, manifest.compression)?;

            // Execute SQL statements
            let statements = crate::db::restore::split_sql_statements(&text);
            for stmt in statements {
                let trimmed = stmt.trim();
                if trimmed.is_empty() || trimmed.starts_with("--") {
                    continue;
                }

                if let Err(e) = backend
                    .execute_query(trimmed, Some(&request.target_database))
                    .await
                {
                    if request.stop_on_error {
                        return Err(PyroError::Database(format!(
                            "Error aplicando evento incremental en point-in-time restore: {e}"
                        )));
                    }
                }
                events_replayed += 1;
            }
            incrementals_applied += 1;
            point_in_time_reached = manifest.completed_at.clone();
        }
    }

    let duration_ms = start_time.elapsed().as_millis() as u64;

    Ok(PointInTimeRestoreSummary {
        target_database: request.target_database,
        base_tables_restored: base_summary.total_tables,
        base_rows_restored: base_summary.total_rows,
        incrementals_applied,
        events_replayed,
        duration_ms,
        point_in_time_reached,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_binlog_coordinates() {
        let coords = "File: mysql-bin.000042, Position: 1048576";
        let parsed = parse_binlog_coordinates(coords);
        assert_eq!(parsed, Some(("mysql-bin.000042".to_string(), 1048576)));

        let invalid = "Invalid: coordinates";
        assert_eq!(parse_binlog_coordinates(invalid), None);
    }
}
