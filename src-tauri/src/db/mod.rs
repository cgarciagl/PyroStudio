pub mod models;
pub mod service;
pub mod state;
pub mod tunnel;

use tauri::State;
pub use models::*;
pub use state::DbState;

#[tauri::command]
pub async fn test_connection(config: ConnectionConfig) -> Result<ServerInfo, String> {
    service::test_connection(config).await
}

#[tauri::command]
pub async fn connect_db(
    config: ConnectionConfig,
    state: State<'_, DbState>,
) -> Result<ServerInfo, String> {
    service::connect(config, &state).await
}

#[tauri::command]
pub async fn disconnect_db(state: State<'_, DbState>) -> Result<(), String> {
    service::disconnect(&state).await
}

#[tauri::command]
pub async fn get_connection_status(state: State<'_, DbState>) -> Result<ConnectionStatus, String> {
    service::get_connection_status(&state).await
}

#[tauri::command]
pub async fn list_databases(state: State<'_, DbState>) -> Result<Vec<DatabaseSchema>, String> {
    service::list_databases(&state).await
}

#[tauri::command]
pub async fn list_tables(
    database: String,
    state: State<'_, DbState>,
) -> Result<Vec<TableMetadata>, String> {
    service::list_tables(database, &state).await
}

#[tauri::command]
pub async fn get_table_columns(
    database: String,
    table: String,
    state: State<'_, DbState>,
) -> Result<Vec<ColumnMetadata>, String> {
    service::get_table_columns(database, table, &state).await
}

#[tauri::command]
pub async fn drop_table(
    database: String,
    table: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    service::drop_table(database, table, &state).await
}

#[tauri::command]
pub async fn truncate_table(
    database: String,
    table: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    service::truncate_table(database, table, &state).await
}

#[tauri::command]
pub async fn query_table_data(
    database: String,
    table: String,
    limit: u32,
    offset: u32,
    state: State<'_, DbState>,
) -> Result<TableDataResult, String> {
    service::query_table_data(database, table, limit, offset, &state).await
}

#[tauri::command]
pub async fn update_cell(
    req: CellUpdateRequest,
    state: State<'_, DbState>,
) -> Result<(), String> {
    service::update_cell(req, &state).await
}

#[tauri::command]
pub async fn execute_query(
    sql: String,
    database: Option<String>,
    state: State<'_, DbState>,
) -> Result<QueryExecutionResult, String> {
    service::execute_query(sql, database, &state).await
}

#[tauri::command]
pub async fn list_routines(
    database: String,
    routine_type: Option<String>,
    state: State<'_, DbState>,
) -> Result<Vec<RoutineMetadata>, String> {
    service::list_routines(database, routine_type, &state).await
}

#[tauri::command]
pub async fn get_routine_definition(
    database: String,
    name: String,
    routine_type: String,
    state: State<'_, DbState>,
) -> Result<RoutineDetail, String> {
    service::get_routine_definition(database, name, routine_type, &state).await
}

#[tauri::command]
pub async fn list_triggers(
    database: String,
    table: Option<String>,
    state: State<'_, DbState>,
) -> Result<Vec<TriggerMetadata>, String> {
    service::list_triggers(database, table, &state).await
}

#[tauri::command]
pub async fn get_trigger_definition(
    database: String,
    name: String,
    state: State<'_, DbState>,
) -> Result<TriggerDetail, String> {
    service::get_trigger_definition(database, name, &state).await
}

#[tauri::command]
pub async fn drop_routine(
    database: String,
    name: String,
    routine_type: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    service::drop_routine(database, name, routine_type, &state).await
}

#[tauri::command]
pub async fn drop_trigger(
    database: String,
    name: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    service::drop_trigger(database, name, &state).await
}

#[tauri::command]
pub async fn save_routine(
    database: String,
    old_name: Option<String>,
    routine_type: String,
    ddl: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    service::save_routine(database, old_name, routine_type, ddl, &state).await
}

#[tauri::command]
pub async fn save_trigger(
    database: String,
    old_name: Option<String>,
    ddl: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    service::save_trigger(database, old_name, ddl, &state).await
}

#[tauri::command]
pub async fn execute_routine(
    database: String,
    name: String,
    routine_type: String,
    params: Vec<serde_json::Value>,
    state: State<'_, DbState>,
) -> Result<QueryExecutionResult, String> {
    service::execute_routine(database, name, routine_type, params, &state).await
}
