use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Instant;
use tauri::Emitter;

use super::manifest::{BackupManifest, CompressionFormat};
use crate::db::backend::DatabaseBackend;
use crate::db::error::PyroError;
use crate::db::restore::split_sql_statements;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectoryRestoreRequest {
    pub backup_dir: String,
    pub target_database: String,
    pub create_database_if_not_exists: bool,
    pub disable_foreign_keys: bool,
    pub stop_on_error: bool,
    pub base_backup_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectoryRestoreProgressEvent {
    pub stage: String,
    pub current_table: Option<String>,
    pub tables_completed: usize,
    pub total_tables: usize,
    pub chunks_completed: usize,
    pub total_chunks: usize,
    pub rows_restored: u64,
    pub percent_complete: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectoryRestoreSummary {
    pub target_database: String,
    pub backup_id: String,
    pub total_tables: usize,
    pub total_chunks: usize,
    pub total_rows: u64,
    pub successful_statements: u64,
    pub failed_statements: u64,
    pub errors: Vec<String>,
    pub duration_ms: u64,
    pub bytes_processed: u64,
}

/// Helper function to open and decompress a chunk file into a String of SQL statements.
pub fn read_decompressed_chunk(
    path: &Path,
    compression: CompressionFormat,
) -> Result<String, PyroError> {
    let file = File::open(path)
        .map_err(|e| PyroError::Io(format!("No se pudo abrir el archivo '{path:?}': {e}")))?;

    let mut sql = String::new();
    match compression {
        CompressionFormat::Zstd => {
            let mut decoder = zstd::Decoder::new(file).map_err(|e| {
                PyroError::Io(format!(
                    "Error inicializando descompresión zstd para '{path:?}': {e}"
                ))
            })?;
            decoder.read_to_string(&mut sql).map_err(|e| {
                PyroError::Io(format!("Error descomprimiendo chunk zstd '{path:?}': {e}"))
            })?;
        }
        CompressionFormat::Gzip => {
            let mut decoder = flate2::read::GzDecoder::new(file);
            decoder.read_to_string(&mut sql).map_err(|e| {
                PyroError::Io(format!("Error descomprimiendo chunk gzip '{path:?}': {e}"))
            })?;
        }
        CompressionFormat::None => {
            let mut reader = file;
            reader
                .read_to_string(&mut sql)
                .map_err(|e| PyroError::Io(format!("Error leyendo chunk '{path:?}': {e}")))?;
        }
    }
    Ok(sql)
}

/// Executes a database restoration from a structured directory backup.
pub async fn execute_directory_restore(
    backend: &dyn DatabaseBackend,
    app_handle: Option<&tauri::AppHandle>,
    req: DirectoryRestoreRequest,
) -> Result<DirectoryRestoreSummary, PyroError> {
    let start_time = Instant::now();
    let backup_dir = Path::new(&req.backup_dir);
    let manifest_path = backup_dir.join("manifest.json");

    if !manifest_path.exists() {
        return Err(PyroError::InvalidOperation(format!(
            "No se encontró 'manifest.json' en '{:?}'. ¿Es un directorio de respaldo válido?",
            req.backup_dir
        )));
    }

    let manifest_content = std::fs::read_to_string(&manifest_path)
        .map_err(|e| PyroError::Io(format!("Error leyendo el manifiesto: {e}")))?;

    let manifest: BackupManifest = serde_json::from_str(&manifest_content).map_err(|e| {
        PyroError::InvalidOperation(format!("El archivo de manifiesto es inválido: {e}"))
    })?;

    let target_db = req.target_database.trim();
    if target_db.is_empty() {
        return Err(PyroError::InvalidOperation(
            "La base de datos de destino no puede estar vacía.".into(),
        ));
    }

    let base_dir_buf: Option<PathBuf> = req
        .base_backup_dir
        .as_deref()
        .or(manifest.base_backup_dir.as_deref())
        .map(PathBuf::from);

    // 1. Create target database if requested
    if req.create_database_if_not_exists {
        let create_sql = format!(
            "CREATE DATABASE /*!32312 IF NOT EXISTS*/ `{target_db}` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci */;"
        );
        backend.execute_query(&create_sql, None).await?;
    }

    // 2. Disable foreign key checks if requested
    if req.disable_foreign_keys {
        backend
            .execute_query(
                "SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0; SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0;",
                Some(target_db),
            )
            .await?;
    }

    let total_tables = manifest.tables.len();
    let total_chunks: usize = manifest.tables.iter().map(|t| t.chunks.len()).sum();
    let mut chunks_completed = 0;
    let mut tables_completed = 0;
    let mut rows_restored = 0u64;
    let mut successful_statements = 0u64;
    let mut failed_statements = 0u64;
    let mut bytes_processed = 0u64;
    let mut errors = Vec::new();

    // 3. Restore table schemas
    for tbl in &manifest.tables {
        let schema_path = backup_dir.join(&tbl.schema_file);
        if schema_path.exists() {
            if let Ok(ddl) = std::fs::read_to_string(&schema_path) {
                bytes_processed += ddl.len() as u64;
                let statements = split_sql_statements(&ddl);
                for stmt in statements {
                    let trimmed = stmt.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    match backend.execute_query(trimmed, Some(target_db)).await {
                        Ok(_) => successful_statements += 1,
                        Err(e) => {
                            failed_statements += 1;
                            let msg = format!("Error en esquema de '{}': {e}", tbl.name);
                            errors.push(msg);
                            if req.stop_on_error {
                                if req.disable_foreign_keys {
                                    let _ = backend
                                        .execute_query(
                                            "SET FOREIGN_KEY_CHECKS=1; SET UNIQUE_CHECKS=1;",
                                            Some(target_db),
                                        )
                                        .await;
                                }
                                return Err(PyroError::Database(format!(
                                    "Restauración abortada en esquema '{}': {e}",
                                    tbl.name
                                )));
                            }
                        }
                    }
                }
            }
        }
    }

    // 4. Restore views if present
    if let Some(ref views_file) = manifest.views_file {
        let views_path = backup_dir.join(views_file);
        if views_path.exists() {
            if let Ok(sql) = std::fs::read_to_string(&views_path) {
                bytes_processed += sql.len() as u64;
                for stmt in split_sql_statements(&sql) {
                    let trimmed = stmt.trim();
                    if !trimmed.is_empty() {
                        let _ = backend.execute_query(trimmed, Some(target_db)).await;
                    }
                }
            }
        }
    }

    // 5. Restore stored procedures and functions if present
    if let Some(ref routines_file) = manifest.routines_file {
        let routines_path = backup_dir.join(routines_file);
        if routines_path.exists() {
            if let Ok(sql) = std::fs::read_to_string(&routines_path) {
                bytes_processed += sql.len() as u64;
                for stmt in split_sql_statements(&sql) {
                    let trimmed = stmt.trim();
                    if !trimmed.is_empty() {
                        let _ = backend.execute_query(trimmed, Some(target_db)).await;
                    }
                }
            }
        }
    }

    // 6. Restore data chunks
    for tbl in &manifest.tables {
        let is_differential_unchanged = tbl.is_differential_unchanged;

        for chunk in &tbl.chunks {
            let chunk_path = if is_differential_unchanged {
                if let Some(ref base_dir) = base_dir_buf {
                    base_dir.join(&chunk.file_name)
                } else {
                    backup_dir.join(&chunk.file_name)
                }
            } else {
                backup_dir.join(&chunk.file_name)
            };

            if !chunk_path.exists() {
                let err_msg = format!(
                    "Falta el archivo de chunk '{}' para la tabla '{}'.",
                    chunk.file_name, tbl.name
                );
                errors.push(err_msg.clone());
                if req.stop_on_error {
                    if req.disable_foreign_keys {
                        let _ = backend
                            .execute_query(
                                "SET FOREIGN_KEY_CHECKS=1; SET UNIQUE_CHECKS=1;",
                                Some(target_db),
                            )
                            .await;
                    }
                    return Err(PyroError::InvalidOperation(err_msg));
                }
                continue;
            }

            match read_decompressed_chunk(&chunk_path, manifest.compression) {
                Ok(sql) => {
                    bytes_processed += sql.len() as u64;
                    let statements = split_sql_statements(&sql);
                    for stmt in statements {
                        let trimmed = stmt.trim();
                        if trimmed.is_empty() {
                            continue;
                        }
                        match backend.execute_query(trimmed, Some(target_db)).await {
                            Ok(_) => successful_statements += 1,
                            Err(e) => {
                                failed_statements += 1;
                                let msg = format!(
                                    "Error insertando datos en '{}' (chunk {}): {e}",
                                    tbl.name, chunk.chunk_index
                                );
                                errors.push(msg);
                                if req.stop_on_error {
                                    if req.disable_foreign_keys {
                                        let _ = backend
                                            .execute_query(
                                                "SET FOREIGN_KEY_CHECKS=1; SET UNIQUE_CHECKS=1;",
                                                Some(target_db),
                                            )
                                            .await;
                                    }
                                    return Err(PyroError::Database(format!(
                                        "Restauración abortada en tabla '{}': {e}",
                                        tbl.name
                                    )));
                                }
                            }
                        }
                    }
                    rows_restored += chunk.rows;
                }
                Err(e) => {
                    failed_statements += 1;
                    errors.push(format!(
                        "Error descomprimiendo chunk '{}': {e}",
                        chunk.file_name
                    ));
                }
            }

            chunks_completed += 1;

            if let Some(app) = app_handle {
                let pct = if total_chunks > 0 {
                    ((chunks_completed as f64) / (total_chunks as f64)) * 100.0
                } else {
                    100.0
                };
                let _ = app.emit(
                    "directory-restore-progress",
                    DirectoryRestoreProgressEvent {
                        stage: format!(
                            "Restaurando tabla '{}' (bloque {}/{})...",
                            tbl.name, chunks_completed, total_chunks
                        ),
                        current_table: Some(tbl.name.clone()),
                        tables_completed,
                        total_tables,
                        chunks_completed,
                        total_chunks,
                        rows_restored,
                        percent_complete: pct,
                    },
                );
            }
        }

        tables_completed += 1;
    }

    // 7. Restore triggers AFTER data is restored so triggers don't alter imported rows
    if let Some(ref triggers_file) = manifest.triggers_file {
        let triggers_path = backup_dir.join(triggers_file);
        if triggers_path.exists() {
            if let Ok(sql) = std::fs::read_to_string(&triggers_path) {
                bytes_processed += sql.len() as u64;
                for stmt in split_sql_statements(&sql) {
                    let trimmed = stmt.trim();
                    if !trimmed.is_empty() {
                        let _ = backend.execute_query(trimmed, Some(target_db)).await;
                    }
                }
            }
        }
    }

    // 8. Re-enable foreign keys if disabled
    if req.disable_foreign_keys {
        let _ = backend
            .execute_query(
                "SET FOREIGN_KEY_CHECKS=1; SET UNIQUE_CHECKS=1;",
                Some(target_db),
            )
            .await;
    }

    // Final completion event
    if let Some(app) = app_handle {
        let _ = app.emit(
            "directory-restore-progress",
            DirectoryRestoreProgressEvent {
                stage: "Restauración completada con éxito.".to_string(),
                current_table: None,
                tables_completed,
                total_tables,
                chunks_completed,
                total_chunks,
                rows_restored,
                percent_complete: 100.0,
            },
        );
    }

    Ok(DirectoryRestoreSummary {
        target_database: target_db.to_string(),
        backup_id: manifest.backup_id,
        total_tables,
        total_chunks,
        total_rows: rows_restored,
        successful_statements,
        failed_statements,
        errors,
        duration_ms: start_time.elapsed().as_millis() as u64,
        bytes_processed,
    })
}
