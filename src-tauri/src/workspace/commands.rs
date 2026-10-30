//! Tauri commands for workspaces. Folder paths are only obtained through the native
//! directory picker in Rust — the frontend never sends a filesystem path, and every
//! resource is addressed by a validated id.

use super::error::{WorkspaceError, WsResult};
use super::models::*;
use super::service::WorkspaceManager;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;

pub type WorkspaceState = Arc<WorkspaceManager>;

/// Runs blocking filesystem work off the async runtime: a synced folder
/// (e.g. Google Drive streaming) may stall on first access.
async fn blocking<T, F>(state: &State<'_, WorkspaceState>, f: F) -> WsResult<T>
where
    T: Send + 'static,
    F: FnOnce(&WorkspaceManager) -> WsResult<T> + Send + 'static,
{
    let mgr = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || f(&mgr))
        .await
        .map_err(|_| WorkspaceError::Io("tarea interrumpida".into()))?
}

async fn pick_folder(title: &str) -> Option<PathBuf> {
    rfd::AsyncFileDialog::new()
        .set_title(title)
        .pick_folder()
        .await
        .map(|h| h.path().to_path_buf())
}

#[tauri::command]
pub async fn workspace_get_status(state: State<'_, WorkspaceState>) -> WsResult<WorkspaceStatus> {
    blocking(&state, |m| Ok(m.status())).await
}

/// Returns `None` if the user cancelled the dialog.
#[tauri::command]
pub async fn workspace_create_dialog(
    name: String,
    state: State<'_, WorkspaceState>,
) -> WsResult<Option<WorkspaceStatus>> {
    let Some(folder) = pick_folder("Elegir carpeta para el nuevo workspace").await else {
        return Ok(None);
    };
    blocking(&state, move |m| m.create(&folder, &name).map(Some)).await
}

#[tauri::command]
pub async fn workspace_open_dialog(
    state: State<'_, WorkspaceState>,
) -> WsResult<Option<WorkspaceStatus>> {
    let Some(folder) = pick_folder("Abrir carpeta de workspace de PyroStudio").await else {
        return Ok(None);
    };
    blocking(&state, move |m| m.open(&folder).map(Some)).await
}

#[tauri::command]
pub async fn workspace_relocate_dialog(
    state: State<'_, WorkspaceState>,
) -> WsResult<Option<WorkspaceStatus>> {
    let Some(folder) = pick_folder("Localizar la carpeta del workspace").await else {
        return Ok(None);
    };
    blocking(&state, move |m| m.relocate(&folder).map(Some)).await
}

#[tauri::command]
pub async fn workspace_use_local(state: State<'_, WorkspaceState>) -> WsResult<WorkspaceStatus> {
    blocking(&state, |m| m.use_local()).await
}

#[tauri::command]
pub async fn workspace_list_connections(
    state: State<'_, WorkspaceState>,
) -> WsResult<ConnectionListing> {
    blocking(&state, |m| m.list_connections()).await
}

#[tauri::command]
pub async fn workspace_save_connection(
    connection: serde_json::Value,
    state: State<'_, WorkspaceState>,
) -> WsResult<serde_json::Value> {
    blocking(&state, move |m| m.save_connection(&connection)).await
}

#[tauri::command]
pub async fn workspace_delete_connection(
    id: String,
    state: State<'_, WorkspaceState>,
) -> WsResult<()> {
    blocking(&state, move |m| m.delete_connection(&id)).await
}

#[tauri::command]
pub async fn workspace_list_queries(state: State<'_, WorkspaceState>) -> WsResult<QueryListing> {
    blocking(&state, |m| m.list_queries()).await
}

#[tauri::command]
pub async fn workspace_read_query(
    id: String,
    state: State<'_, WorkspaceState>,
) -> WsResult<WorkspaceQuery> {
    blocking(&state, move |m| m.read_query(&id)).await
}

#[tauri::command]
pub async fn workspace_save_query(
    query: SaveQueryInput,
    state: State<'_, WorkspaceState>,
) -> WsResult<WorkspaceQuery> {
    blocking(&state, move |m| m.save_query(&query)).await
}

#[tauri::command]
pub async fn workspace_delete_query(
    id: String,
    expected_hash: Option<String>,
    state: State<'_, WorkspaceState>,
) -> WsResult<()> {
    blocking(&state, move |m| {
        m.delete_query(&id, expected_hash.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn workspace_import_legacy(
    data: LegacyImport,
    state: State<'_, WorkspaceState>,
) -> WsResult<MigrationReport> {
    blocking(&state, move |m| m.import_legacy(&data)).await
}

#[tauri::command]
pub async fn workspace_get_snippets(
    state: State<'_, WorkspaceState>,
) -> WsResult<super::snippets::SnippetsSnapshot> {
    blocking(&state, move |m| m.read_snippets()).await
}

#[tauri::command]
pub async fn workspace_save_snippets(
    snippets: Vec<super::snippets::SqlSnippet>,
    expected_hash: String,
    state: State<'_, WorkspaceState>,
) -> WsResult<super::snippets::SnippetsSnapshot> {
    blocking(&state, move |m| m.save_snippets(&snippets, &expected_hash)).await
}

#[tauri::command]
pub async fn workspace_get_object_groups(
    connection_id: String,
    state: State<'_, WorkspaceState>,
) -> WsResult<super::groups::GroupsSnapshot> {
    blocking(&state, move |m| m.read_groups(&connection_id)).await
}

#[tauri::command]
pub async fn workspace_save_object_groups(
    connection_id: String,
    databases: super::groups::DatabaseGroups,
    expected_hash: String,
    state: State<'_, WorkspaceState>,
) -> WsResult<super::groups::GroupsSnapshot> {
    blocking(&state, move |m| {
        m.save_groups(&connection_id, &databases, &expected_hash)
    })
    .await
}
