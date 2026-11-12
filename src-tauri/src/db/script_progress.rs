//! Progress of a running editor script, sent to the UI as the `script-progress`
//! event after each statement. The UI uses it to show "statement N of M" and
//! to restart its time limit, which counts per statement, not per script.

use serde::Serialize;
use std::sync::OnceLock;
use tauri::Emitter;

pub const EVENT: &str = "script-progress";

static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

/// Called once at startup; without it (unit tests) progress is not emitted.
pub fn init(app: tauri::AppHandle) {
    let _ = APP.set(app);
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScriptProgress {
    pub query_id: String,
    /// Statements finished so far (the next one, if any, is running).
    pub completed: usize,
    pub total: usize,
    /// Time since the script started.
    pub elapsed_ms: u64,
}

/// Reports that `completed` of `total` statements have finished.
pub fn report(query_id: Option<&str>, completed: usize, total: usize, elapsed_ms: u64) {
    let (Some(query_id), Some(app)) = (query_id, APP.get()) else {
        return;
    };
    let _ = app.emit(
        EVENT,
        ScriptProgress {
            query_id: query_id.to_string(),
            completed,
            total,
            elapsed_ms,
        },
    );
}
