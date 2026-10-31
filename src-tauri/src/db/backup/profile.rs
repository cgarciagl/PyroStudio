use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::db::error::PyroError;

/// Storage directory for backup automation and profiles.
pub fn backup_meta_dir() -> PathBuf {
    let workspace = crate::workspace::service::WorkspaceManager::new(
        crate::workspace::service::default_config_path(),
    );
    match workspace.root() {
        Ok(root) => root.join(".pyro").join("backups"),
        Err(_) => dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("PyroStudio")
            .join("backups"),
    }
}

pub fn profiles_file_path() -> PathBuf {
    backup_meta_dir().join("profiles.json")
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BackupProfile {
    pub id: String,
    pub name: String,
    pub connection_id: String,
    pub database: String,
    pub target_dir: String,
    pub backup_format: String,           // "directory" | "sql"
    pub structured_type: Option<String>, // "full" | "differential"
    pub base_backup_dir: Option<String>,
    pub compression: Option<String>, // "zstd" | "gzip" | "none"
    pub zstd_level: Option<u32>,
    pub chunk_size_rows: Option<usize>,
    pub tables: Option<Vec<String>>,
    pub include_views: bool,
    pub include_routines: bool,
    pub include_triggers: bool,
    pub schedule_enabled: bool,
    pub schedule_interval_hours: u32,
    pub retention_max_backups: Option<usize>,
    pub retention_max_days: Option<u32>,
    pub last_run_at: Option<String>,
    pub last_status: Option<String>,
    pub created_at: String,
}

impl BackupProfile {
    pub fn new(name: &str, connection_id: &str, database: &str, target_dir: &str) -> Self {
        let now = chrono::Local::now().to_rfc3339();
        Self {
            id: format!("bp-{}", chrono::Utc::now().timestamp_millis()),
            name: name.to_string(),
            connection_id: connection_id.to_string(),
            database: database.to_string(),
            target_dir: target_dir.to_string(),
            backup_format: "directory".to_string(),
            structured_type: Some("full".to_string()),
            base_backup_dir: None,
            compression: Some("zstd".to_string()),
            zstd_level: Some(3),
            chunk_size_rows: Some(50000),
            tables: None,
            include_views: true,
            include_routines: true,
            include_triggers: true,
            schedule_enabled: false,
            schedule_interval_hours: 24,
            retention_max_backups: Some(7),
            retention_max_days: Some(30),
            last_run_at: None,
            last_status: None,
            created_at: now,
        }
    }
}

pub fn load_profiles() -> Result<Vec<BackupProfile>, PyroError> {
    let path = profiles_file_path();
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| PyroError::Io(format!("Error leyendo perfiles de backup: {e}")))?;

    if content.trim().is_empty() {
        return Ok(Vec::new());
    }

    let profiles: Vec<BackupProfile> = serde_json::from_str(&content)
        .map_err(|e| PyroError::InvalidOperation(format!("Perfiles de backup corruptos: {e}")))?;

    Ok(profiles)
}

pub fn save_profile(profile: BackupProfile) -> Result<(), PyroError> {
    let dir = backup_meta_dir();
    fs::create_dir_all(&dir)
        .map_err(|e| PyroError::Io(format!("No se pudo crear carpeta de backups: {e}")))?;

    let mut profiles = load_profiles().unwrap_or_default();
    if let Some(existing) = profiles.iter_mut().find(|p| p.id == profile.id) {
        *existing = profile;
    } else {
        profiles.push(profile);
    }

    let json = serde_json::to_string_pretty(&profiles)
        .map_err(|e| PyroError::InvalidOperation(format!("Error serializando perfiles: {e}")))?;

    let tmp_path = dir.join("profiles.tmp");
    fs::write(&tmp_path, json.as_bytes()).map_err(|e| {
        PyroError::Io(format!(
            "No se pudo escribir archivo temporal de perfiles: {e}"
        ))
    })?;

    fs::rename(&tmp_path, profiles_file_path())
        .map_err(|e| PyroError::Io(format!("No se pudo guardar perfiles de backup: {e}")))?;

    Ok(())
}

pub fn delete_profile(id: &str) -> Result<(), PyroError> {
    let dir = backup_meta_dir();
    let mut profiles = load_profiles().unwrap_or_default();
    let len_before = profiles.len();
    profiles.retain(|p| p.id != id);

    if profiles.len() == len_before {
        return Ok(());
    }

    let json = serde_json::to_string_pretty(&profiles)
        .map_err(|e| PyroError::InvalidOperation(format!("Error serializando perfiles: {e}")))?;

    let tmp_path = dir.join("profiles.tmp");
    fs::write(&tmp_path, json.as_bytes()).map_err(|e| {
        PyroError::Io(format!(
            "No se pudo escribir archivo temporal de perfiles: {e}"
        ))
    })?;

    fs::rename(&tmp_path, profiles_file_path())
        .map_err(|e| PyroError::Io(format!("No se pudo actualizar perfiles: {e}")))?;

    Ok(())
}

pub fn find_profile(id: &str) -> Result<BackupProfile, PyroError> {
    let profiles = load_profiles()?;
    profiles.into_iter().find(|p| p.id == id).ok_or_else(|| {
        PyroError::InvalidOperation(format!("Perfil de backup con ID {id} no encontrado."))
    })
}

pub fn update_profile_status(id: &str, status: &str) -> Result<(), PyroError> {
    let mut profiles = load_profiles()?;
    if let Some(profile) = profiles.iter_mut().find(|p| p.id == id) {
        profile.last_run_at = Some(chrono::Local::now().to_rfc3339());
        profile.last_status = Some(status.to_string());

        let json = serde_json::to_string_pretty(&profiles).map_err(|e| {
            PyroError::InvalidOperation(format!("Error serializando perfiles: {e}"))
        })?;

        let dir = backup_meta_dir();
        let tmp_path = dir.join("profiles.tmp");
        fs::write(&tmp_path, json.as_bytes())
            .map_err(|e| PyroError::Io(format!("Error escribiendo temporal: {e}")))?;

        fs::rename(&tmp_path, profiles_file_path())
            .map_err(|e| PyroError::Io(format!("Error guardando perfiles: {e}")))?;
    }
    Ok(())
}
