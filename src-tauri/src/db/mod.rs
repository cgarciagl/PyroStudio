pub mod advisor;
pub mod assistant;
pub mod backend;
pub mod connection;
pub mod credentials;
pub mod database;
pub mod diff;
pub mod error;
pub mod explain;
pub mod health;
pub mod index;
pub mod inspector;
pub mod migration;
pub mod models;
pub mod operations;
pub mod query;
pub mod restore;
pub mod routine;
pub mod row;
pub mod safe_mode;
pub mod service;
pub mod session;
pub mod sql_dump;
pub mod sql_utils;
pub mod ssh;
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

// ─── P3: Operational Intelligence & Advanced Administration Commands ────────

#[tauri::command]
pub async fn get_database_dashboard(
    database: String,
    state: State<'_, DbState>,
) -> Result<DatabaseDashboardInfo, PyroError> {
    service::get_database_dashboard(database, &state).await
}

#[tauri::command]
pub async fn get_health_report(
    database: String,
    state: State<'_, DbState>,
) -> Result<HealthReport, PyroError> {
    service::get_health_report(database, &state).await
}

#[tauri::command]
pub async fn analyze_slow_query(
    sql: String,
    database: Option<String>,
    state: State<'_, DbState>,
) -> Result<SlowQueryAnalysis, PyroError> {
    service::analyze_slow_query(sql, database, &state).await
}

#[tauri::command]
pub async fn analyze_database_indexes(
    database: String,
    state: State<'_, DbState>,
) -> Result<IndexAdvisorReport, PyroError> {
    service::analyze_database_indexes(database, &state).await
}

#[tauri::command]
pub async fn compare_schemas(
    source_database: String,
    target_database: String,
    state: State<'_, DbState>,
) -> Result<SchemaDiffResult, PyroError> {
    service::compare_schemas(source_database, target_database, &state).await
}

#[tauri::command]
pub async fn compare_cross_connection_schemas(
    source_config: ConnectionConfig,
    source_database: String,
    target_config: ConnectionConfig,
    target_database: String,
) -> Result<SchemaDiffResult, PyroError> {
    service::compare_cross_connection_schemas(
        source_config,
        source_database,
        target_config,
        target_database,
    )
    .await
}

#[tauri::command]
pub fn generate_migration_plan(diff: SchemaDiffResult) -> MigrationPlan {
    service::generate_migration_plan(diff)
}

#[tauri::command]
pub async fn get_table_inspector_details(
    database: String,
    table: String,
    state: State<'_, DbState>,
) -> Result<TableInspectorDetails, PyroError> {
    service::get_table_inspector_details(database, table, &state).await
}

#[tauri::command]
pub async fn execute_table_operation(
    database: String,
    table: String,
    operation: String,
    state: State<'_, DbState>,
) -> Result<TableOperationResult, PyroError> {
    service::execute_table_operation(database, table, operation, &state).await
}

#[tauri::command]
pub async fn execute_maintenance_flush(
    flush_type: String,
    state: State<'_, DbState>,
) -> Result<String, PyroError> {
    service::execute_maintenance_flush(flush_type, &state).await
}

#[tauri::command]
pub async fn diagnose_query_with_metadata(
    sql: String,
    database: Option<String>,
    state: State<'_, DbState>,
) -> Result<SqlAssistantDiagnosis, PyroError> {
    service::diagnose_query_with_metadata(sql, database, &state).await
}

#[tauri::command]
pub async fn build_sanitized_ai_context(
    database: String,
    tables: Vec<String>,
    query: Option<String>,
    error_message: Option<String>,
    include_indexes: bool,
    state: State<'_, DbState>,
) -> Result<AiDatabaseContext, PyroError> {
    service::build_sanitized_ai_context(
        database,
        tables,
        query,
        error_message,
        include_indexes,
        &state,
    )
    .await
}

#[tauri::command]
pub async fn get_server_slow_queries(
    database: Option<String>,
    state: State<'_, DbState>,
) -> Result<ServerSlowQueriesReport, PyroError> {
    service::get_server_slow_queries(database, &state).await
}

#[tauri::command]
pub async fn get_database_tables_overview(
    database: String,
    state: State<'_, DbState>,
) -> Result<DatabaseTablesOverview, PyroError> {
    service::get_database_tables_overview(database, &state).await
}

#[tauri::command]
pub async fn export_sql_dump(
    req: SqlDumpRequest,
    state: State<'_, DbState>,
) -> Result<SqlDumpSummary, PyroError> {
    service::export_sql_dump(req, &state).await
}

#[tauri::command]
pub async fn save_sql_dialog(
    default_name: Option<String>,
    default_filename: Option<String>,
) -> Result<Option<String>, String> {
    let raw_name = default_name
        .or(default_filename)
        .unwrap_or_else(|| "database_dump.sql".to_string());

    let file_name = if raw_name.trim().is_empty() {
        "database_dump.sql".to_string()
    } else {
        raw_name
    };

    let file = rfd::AsyncFileDialog::new()
        .add_filter("SQL Script (*.sql)", &["sql"])
        .set_file_name(&file_name)
        .set_title("Guardar Script SQL exportado")
        .save_file()
        .await;

    Ok(file.map(|f| f.path().to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn open_sql_dialog() -> Result<Option<String>, String> {
    let file = rfd::AsyncFileDialog::new()
        .add_filter("SQL Script (*.sql)", &["sql"])
        .set_title("Seleccionar Archivo SQL de Respaldo")
        .pick_file()
        .await;

    Ok(file.map(|f| f.path().to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn execute_sql_restore(
    req: SqlRestoreRequest,
    app_handle: tauri::AppHandle,
    state: State<'_, DbState>,
) -> Result<SqlRestoreSummary, PyroError> {
    service::execute_sql_restore(req, Some(&app_handle), &state).await
}
