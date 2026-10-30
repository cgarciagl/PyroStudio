//! System facts for the diagnostics panel. Paths only; never secrets.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticsInfo {
    pub os: String,
    pub arch: String,
    /// Local settings (`workspace.local.json`) live here.
    pub config_dir: String,
    /// Where the audit log is written right now (workspace or app data).
    pub audit_dir: String,
}

#[tauri::command]
pub fn get_diagnostics_info() -> DiagnosticsInfo {
    let config_path = crate::workspace::service::default_config_path();
    DiagnosticsInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        config_dir: config_path
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        audit_dir: crate::db::audit::audit_dir().to_string_lossy().to_string(),
    }
}
