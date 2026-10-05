pub mod backend;
pub mod connection;
pub mod credentials;
pub mod database;
pub mod error;
pub mod index;
pub mod models;
pub mod query;
pub mod routine;
pub mod row;
pub mod safe_mode;
pub mod service;
pub mod session;
pub mod sql_utils;
pub mod state;
pub mod table;
pub mod trigger;
pub mod tunnel;

pub use backend::{DatabaseBackend, DirectBackend, TunnelBackend};
pub use error::PyroError;
pub use models::*;
pub use safe_mode::{DangerLevel, SqlSafetyAnalysis};
pub use state::DbState;
use tauri::State;

// ─── Keyring credential commands (P0.1, P0.2) ────────────────────────────────

#[tauri::command]
pub async fn save_credential(id: String, secret: String) -> Result<(), PyroError> {
    credentials::save_credential(&id, &secret)
}

#[tauri::command]
pub async fn get_credential(id: String) -> Result<bool, PyroError> {
    // Verifies whether credential exists in the secure store
    // NEVER returns the plaintext secret to the frontend (P0.1, P0.2)
    Ok(credentials::has_credential(&id))
}

#[tauri::command]
pub async fn has_credential(id: String) -> Result<bool, PyroError> {
    Ok(credentials::has_credential(&id))
}

#[tauri::command]
pub async fn delete_credential(id: String) -> Result<(), PyroError> {
    credentials::delete_credential(&id)
}

// ─── Database connection & metadata commands ─────────────────────────────────

#[tauri::command]
pub async fn test_connection(config: ConnectionConfig) -> Result<ServerInfo, PyroError> {
    connection::test_connection(config).await
}

#[tauri::command]
pub async fn connect_db(
    config: ConnectionConfig,
    state: State<'_, DbState>,
) -> Result<ServerInfo, PyroError> {
    connection::connect(config, &state).await
}

#[tauri::command]
pub async fn disconnect_db(state: State<'_, DbState>) -> Result<(), PyroError> {
    connection::disconnect(&state).await
}

#[tauri::command]
pub async fn get_connection_status(
    state: State<'_, DbState>,
) -> Result<ConnectionStatus, PyroError> {
    connection::get_connection_status(&state).await
}

#[tauri::command]
pub async fn list_databases(state: State<'_, DbState>) -> Result<Vec<DatabaseSchema>, PyroError> {
    service::list_databases(&state).await
}

#[tauri::command]
pub async fn list_tables(
    database: String,
    state: State<'_, DbState>,
) -> Result<Vec<TableMetadata>, PyroError> {
    service::list_tables(database, &state).await
}

#[tauri::command]
pub async fn get_table_columns(
    database: String,
    table: String,
    state: State<'_, DbState>,
) -> Result<Vec<ColumnMetadata>, PyroError> {
    service::get_table_columns(database, table, &state).await
}

#[tauri::command]
pub async fn get_table_primary_key(
    database: String,
    table: String,
    state: State<'_, DbState>,
) -> Result<PrimaryKey, PyroError> {
    service::get_table_primary_key(database, table, &state).await
}

#[tauri::command]
pub async fn drop_table(
    database: String,
    table: String,
    state: State<'_, DbState>,
) -> Result<(), PyroError> {
    service::drop_table(database, table, &state).await
}

#[tauri::command]
pub async fn truncate_table(
    database: String,
    table: String,
    state: State<'_, DbState>,
) -> Result<(), PyroError> {
    service::truncate_table(database, table, &state).await
}

#[tauri::command]
pub async fn query_table_data(
    database: String,
    table: String,
    limit: u32,
    offset: u32,
    state: State<'_, DbState>,
) -> Result<TableDataResult, PyroError> {
    service::query_table_data(database, table, limit, offset, &state).await
}

#[tauri::command]
pub async fn update_cell(
    req: CellUpdateRequest,
    state: State<'_, DbState>,
) -> Result<(), PyroError> {
    service::update_cell(req, &state).await
}

#[tauri::command]
pub async fn delete_row(req: DeleteRowRequest, state: State<'_, DbState>) -> Result<(), PyroError> {
    service::delete_row(req, &state).await
}

#[tauri::command]
pub async fn execute_query(
    sql: String,
    database: Option<String>,
    state: State<'_, DbState>,
) -> Result<QueryExecutionResult, PyroError> {
    service::execute_query(sql, database, &state).await
}

#[tauri::command]
pub async fn list_routines(
    database: String,
    routine_type: Option<String>,
    state: State<'_, DbState>,
) -> Result<Vec<RoutineMetadata>, PyroError> {
    service::list_routines(database, routine_type, &state).await
}

#[tauri::command]
pub async fn get_routine_definition(
    database: String,
    name: String,
    routine_type: String,
    state: State<'_, DbState>,
) -> Result<RoutineDetail, PyroError> {
    service::get_routine_definition(database, name, routine_type, &state).await
}

#[tauri::command]
pub async fn list_triggers(
    database: String,
    table: Option<String>,
    state: State<'_, DbState>,
) -> Result<Vec<TriggerMetadata>, PyroError> {
    service::list_triggers(database, table, &state).await
}

#[tauri::command]
pub async fn get_trigger_definition(
    database: String,
    name: String,
    state: State<'_, DbState>,
) -> Result<TriggerDetail, PyroError> {
    service::get_trigger_definition(database, name, &state).await
}

#[tauri::command]
pub async fn drop_routine(
    database: String,
    name: String,
    routine_type: String,
    state: State<'_, DbState>,
) -> Result<(), PyroError> {
    service::drop_routine(database, name, routine_type, &state).await
}

#[tauri::command]
pub async fn drop_trigger(
    database: String,
    name: String,
    state: State<'_, DbState>,
) -> Result<(), PyroError> {
    service::drop_trigger(database, name, &state).await
}

#[tauri::command]
pub async fn save_routine(
    database: String,
    old_name: Option<String>,
    routine_type: String,
    ddl: String,
    state: State<'_, DbState>,
) -> Result<(), PyroError> {
    service::save_routine(database, old_name, routine_type, ddl, &state).await
}

#[tauri::command]
pub async fn save_trigger(
    database: String,
    old_name: Option<String>,
    ddl: String,
    state: State<'_, DbState>,
) -> Result<(), PyroError> {
    service::save_trigger(database, old_name, ddl, &state).await
}

#[tauri::command]
pub async fn execute_routine(
    database: String,
    name: String,
    routine_type: String,
    params: Vec<serde_json::Value>,
    state: State<'_, DbState>,
) -> Result<QueryExecutionResult, PyroError> {
    service::execute_routine(database, name, routine_type, params, &state).await
}

// ─── Index management ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_indexes(
    database: String,
    table: String,
    state: State<'_, DbState>,
) -> Result<Vec<IndexMetadata>, PyroError> {
    service::list_indexes(database, table, &state).await
}

#[tauri::command]
pub async fn create_index(
    req: CreateIndexRequest,
    state: State<'_, DbState>,
) -> Result<(), PyroError> {
    service::create_index(req, &state).await
}

#[tauri::command]
pub async fn drop_index(
    database: String,
    table: String,
    index_name: String,
    state: State<'_, DbState>,
) -> Result<(), PyroError> {
    service::drop_index(database, table, index_name, &state).await
}

// ─── Safe Mode Analysis ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn check_sql_safety(sql: String) -> Result<safe_mode::SqlSafetyAnalysis, PyroError> {
    Ok(safe_mode::analyze_sql_safety(&sql))
}
