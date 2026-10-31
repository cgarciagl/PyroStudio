use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;

use super::profile::backup_meta_dir;
use crate::db::error::PyroError;

pub fn history_file_path() -> PathBuf {
    backup_meta_dir().join("history.jsonl")
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BackupExecutionRecord {
    pub id: String,
    pub profile_id: Option<String>,
    pub profile_name: String,
    pub database: String,
    pub backup_format: String,
    pub target_path: String,
    pub started_at: String,
    pub completed_at: String,
    pub duration_ms: u64,
    pub status: String, // "success" | "failed"
    pub error_message: Option<String>,
    pub total_tables: usize,
    pub total_rows: u64,
    pub total_bytes: u64,
}

pub fn append_history(record: &BackupExecutionRecord) -> Result<(), PyroError> {
    let dir = backup_meta_dir();
    fs::create_dir_all(&dir).map_err(|e| {
        PyroError::Io(format!(
            "Error creando carpeta para historial de backups: {e}"
        ))
    })?;

    let path = history_file_path();
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| PyroError::Io(format!("Error abriendo historial de backups: {e}")))?;

    let line = serde_json::to_string(record).map_err(|e| {
        PyroError::InvalidOperation(format!("Error serializando registro de backup: {e}"))
    })?;

    writeln!(file, "{line}")
        .map_err(|e| PyroError::Io(format!("Error escribiendo registro de historial: {e}")))?;

    Ok(())
}

pub fn load_history(limit: Option<usize>) -> Result<Vec<BackupExecutionRecord>, PyroError> {
    let path = history_file_path();
    if !path.exists() {
        return Ok(Vec::new());
    }

    let file = fs::File::open(&path).map_err(|e| {
        PyroError::Io(format!(
            "Error leyendo archivo de historial de backups: {e}"
        ))
    })?;

    let reader = BufReader::new(file);
    let mut records: Vec<BackupExecutionRecord> = Vec::new();

    for line_res in reader.lines() {
        if let Ok(line) = line_res {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Ok(rec) = serde_json::from_str::<BackupExecutionRecord>(trimmed) {
                records.push(rec);
            }
        }
    }

    // Newest first
    records.reverse();

    if let Some(lim) = limit {
        if records.len() > lim {
            records.truncate(lim);
        }
    }

    Ok(records)
}

pub fn clear_history() -> Result<(), PyroError> {
    let path = history_file_path();
    if path.exists() {
        let _ = fs::remove_file(&path);
    }
    Ok(())
}
