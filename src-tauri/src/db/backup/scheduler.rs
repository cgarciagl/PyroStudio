use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Emitter;
use tokio::time::{sleep, Duration};

use super::engine::execute_backup;
use super::history::{append_history, BackupExecutionRecord};
use super::manifest::{BackupType, CompressionFormat};
use super::profile::{load_profiles, update_profile_status, BackupProfile};
use super::retention::{enforce_retention, RetentionPolicy};
use crate::db::backend::DatabaseBackend;
use crate::db::backup::BackupOptions;
use crate::db::error::PyroError;
use crate::db::state::DbState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchedulerEventPayload {
    pub profile_id: String,
    pub profile_name: String,
    pub event_type: String, // "started" | "completed" | "failed"
    pub message: String,
    pub timestamp: String,
}

/// Evaluates whether a profile is due for execution.
pub fn should_run_now(profile: &BackupProfile) -> bool {
    if !profile.schedule_enabled {
        return false;
    }

    let last_run = match &profile.last_run_at {
        Some(ts) => match DateTime::parse_from_rfc3339(ts) {
            Ok(dt) => dt.with_timezone(&Utc),
            Err(_) => return true,
        },
        None => return true,
    };

    let now = Utc::now();
    let hours_elapsed = (now - last_run).num_hours();
    hours_elapsed >= i64::from(profile.schedule_interval_hours)
}

/// Executes a backup profile using a provided DatabaseBackend.
pub async fn execute_profile_with_backend(
    profile: &BackupProfile,
    backend: &dyn DatabaseBackend,
) -> Result<BackupExecutionRecord, PyroError> {
    let now = Utc::now();
    let started_at = now.to_rfc3339();
    let timestamp_folder = now.format("%Y%m%d_%H%M%S").to_string();

    let target_base = PathBuf::from(&profile.target_dir);
    crate::file_grants::grant(&target_base);

    let output_dir = target_base.join(format!("{}_backup_{}", profile.database, timestamp_folder));
    crate::file_grants::grant(&output_dir);

    let btype = match profile.structured_type.as_deref() {
        Some("differential") => BackupType::Differential,
        _ => BackupType::Full,
    };

    let compression = match profile.compression.as_deref() {
        Some("gzip") => CompressionFormat::Gzip,
        Some("none") => CompressionFormat::None,
        _ => CompressionFormat::Zstd,
    };

    let options = BackupOptions {
        database: profile.database.clone(),
        output_dir: output_dir.clone(),
        backup_type: Some(btype),
        base_backup_dir: profile.base_backup_dir.as_ref().map(PathBuf::from),
        compression,
        chunk_size_bytes: profile.chunk_size_rows.map(|r| (r as u64) * 500),
        tables: profile.tables.clone(),
        include_routines: profile.include_routines,
        include_triggers: profile.include_triggers,
        include_replication_coordinates: None,
    };

    let exec_res = execute_backup(backend, options).await;

    let completed_at = Utc::now().to_rfc3339();
    let duration_ms = (Utc::now() - now).num_milliseconds().max(0) as u64;

    match exec_res {
        Ok(summary) => {
            // Apply retention if configured
            if profile.retention_max_backups.is_some() || profile.retention_max_days.is_some() {
                let policy = RetentionPolicy {
                    max_backups: profile.retention_max_backups,
                    max_days: profile.retention_max_days,
                };
                let _ = enforce_retention(&target_base, &policy);
            }

            let _ = update_profile_status(&profile.id, "success");

            let record = BackupExecutionRecord {
                id: format!("rec-{}", Utc::now().timestamp_millis()),
                profile_id: Some(profile.id.clone()),
                profile_name: profile.name.clone(),
                database: profile.database.clone(),
                backup_format: profile.backup_format.clone(),
                target_path: output_dir.to_string_lossy().to_string(),
                started_at,
                completed_at,
                duration_ms,
                status: "success".to_string(),
                error_message: None,
                total_tables: summary.total_tables,
                total_rows: summary.total_rows,
                total_bytes: summary.total_compressed_bytes,
            };

            let _ = append_history(&record);
            Ok(record)
        }
        Err(err) => {
            let err_msg = err.to_string();
            let _ = update_profile_status(&profile.id, "failed");

            let record = BackupExecutionRecord {
                id: format!("rec-{}", Utc::now().timestamp_millis()),
                profile_id: Some(profile.id.clone()),
                profile_name: profile.name.clone(),
                database: profile.database.clone(),
                backup_format: profile.backup_format.clone(),
                target_path: output_dir.to_string_lossy().to_string(),
                started_at,
                completed_at,
                duration_ms,
                status: "failed".to_string(),
                error_message: Some(err_msg),
                total_tables: 0,
                total_rows: 0,
                total_bytes: 0,
            };

            let _ = append_history(&record);
            Err(err)
        }
    }
}

/// Spawns a background task that periodically checks and executes scheduled backups.
pub fn start_scheduler_task(state: DbState, app_handle: Option<tauri::AppHandle>) {
    // `setup` de Tauri corre fuera de un runtime de Tokio: usar el runtime de Tauri.
    tauri::async_runtime::spawn(async move {
        tracing::info!("Iniciando planificador de backups en segundo plano.");
        loop {
            sleep(Duration::from_secs(60)).await;

            let profiles = match load_profiles() {
                Ok(p) => p,
                Err(_) => continue,
            };

            for profile in profiles {
                if should_run_now(&profile) {
                    tracing::info!("Ejecutando backup programado para perfil: {}", profile.name);

                    if let Some(ref handle) = app_handle {
                        let _ = handle.emit(
                            "backup-scheduler-event",
                            SchedulerEventPayload {
                                profile_id: profile.id.clone(),
                                profile_name: profile.name.clone(),
                                event_type: "started".to_string(),
                                message: format!(
                                    "Iniciando respaldo programado de {}",
                                    profile.database
                                ),
                                timestamp: Utc::now().to_rfc3339(),
                            },
                        );
                    }

                    // Try to execute using the active session backend if available
                    let session_opt = state.session.read().await.clone();
                    if let Some(session) = session_opt {
                        if session.config.database.as_deref() == Some(&profile.database) {
                            let res =
                                execute_profile_with_backend(&profile, &session.backend).await;
                            if let Some(ref handle) = app_handle {
                                let (event_type, msg) = match &res {
                                    Ok(_) => (
                                        "completed".to_string(),
                                        "Respaldo completado con éxito".to_string(),
                                    ),
                                    Err(e) => {
                                        ("failed".to_string(), format!("Error en respaldo: {e}"))
                                    }
                                };
                                let _ = handle.emit(
                                    "backup-scheduler-event",
                                    SchedulerEventPayload {
                                        profile_id: profile.id.clone(),
                                        profile_name: profile.name.clone(),
                                        event_type,
                                        message: msg,
                                        timestamp: Utc::now().to_rfc3339(),
                                    },
                                );
                            }
                        }
                    }
                }
            }
        }
    });
}
