use super::backend::DatabaseBackend;
use super::database;
use super::error::PyroError;
use super::index;
use super::models::{
    CellUpdateRequest, ColumnMetadata, CreateIndexRequest, DatabaseSchema, DeleteRowRequest,
    IndexMetadata, PrimaryKey, QueryExecutionResult, RoutineDetail, RoutineMetadata,
    TableDataResult, TableMetadata, TriggerDetail, TriggerMetadata,
};
use super::routine;
use super::row;
pub use super::session::get_session;
use super::state::{ActiveSession, DbState};
use super::table;
use super::trigger;

// Re-exports for backwards compatibility and cross-module consumers
pub use super::connection::{
    build_connect_options, connect, disconnect, get_connection_status, resolve_config_credentials,
    test_connection,
};
pub use super::query::{
    bind_json_value, json_value_to_sql_literal, row_to_json, DEFAULT_MAX_INTERACTIVE_ROWS,
};
pub use super::safe_mode::{
    analyze_sql_safety, clean_sql_statement, DangerLevel, SqlSafetyAnalysis,
};
pub use super::session::get_pool;

/// Executes a query on an explicit active session.
pub async fn execute_query_session(
    session: &ActiveSession,
    sql: &str,
    database: Option<&str>,
) -> Result<QueryExecutionResult, PyroError> {
    session.backend.execute_query(sql, database).await
}

/// Executes a raw SQL query using the current session in DbState.
pub async fn execute_query(
    sql: String,
    database: Option<String>,
    state: &DbState,
) -> Result<QueryExecutionResult, PyroError> {
    let session = get_session(state).await?;
    session
        .backend
        .execute_query(&sql, database.as_deref())
        .await
}

/// Lists all databases and schemas with approximate table count.
pub async fn list_databases(state: &DbState) -> Result<Vec<DatabaseSchema>, PyroError> {
    let session = get_session(state).await?;
    database::list_databases(&session.backend).await
}

/// Lists all tables in the specified database.
pub async fn list_tables(
    database: String,
    state: &DbState,
) -> Result<Vec<TableMetadata>, PyroError> {
    let session = get_session(state).await?;
    table::list_tables(&session.backend, &database).await
}

/// Retrieves all column definitions for a given table.
pub async fn get_table_columns(
    database: String,
    table: String,
    state: &DbState,
) -> Result<Vec<ColumnMetadata>, PyroError> {
    let session = get_session(state).await?;
    table::get_table_columns(&session.backend, &database, &table).await
}

/// Retrieves the primary key columns for a table.
pub async fn get_table_primary_key(
    database: String,
    table: String,
    state: &DbState,
) -> Result<PrimaryKey, PyroError> {
    let session = get_session(state).await?;
    table::get_table_primary_key(&session.backend, &database, &table).await
}

/// Queries paginated table data.
pub async fn query_table_data(
    database: String,
    table: String,
    limit: u32,
    offset: u32,
    state: &DbState,
) -> Result<TableDataResult, PyroError> {
    let session = get_session(state).await?;
    table::query_table_data(&session.backend, &database, &table, limit, offset).await
}

/// Drops a table.
pub async fn drop_table(database: String, table: String, state: &DbState) -> Result<(), PyroError> {
    let session = get_session(state).await?;
    table::drop_table(&session.backend, &database, &table).await
}

/// Truncates a table.
pub async fn truncate_table(
    database: String,
    table: String,
    state: &DbState,
) -> Result<(), PyroError> {
    let session = get_session(state).await?;
    table::truncate_table(&session.backend, &database, &table).await
}

/// Updates a single cell safely enforcing primary key constraints.
pub async fn update_cell(req: CellUpdateRequest, state: &DbState) -> Result<(), PyroError> {
    let session = get_session(state).await?;
    row::update_cell(&session.backend, req).await
}

/// Deletes a row safely using primary key conditions.
pub async fn delete_row(req: DeleteRowRequest, state: &DbState) -> Result<(), PyroError> {
    let session = get_session(state).await?;
    row::delete_row(&session.backend, req).await
}

/// Lists all stored procedures and functions in the specified database.
pub async fn list_routines(
    database: String,
    routine_type: Option<String>,
    state: &DbState,
) -> Result<Vec<RoutineMetadata>, PyroError> {
    let session = get_session(state).await?;
    routine::list_routines(&session.backend, &database, routine_type.as_deref()).await
}

/// Retrieves the DDL and parameter metadata for a stored procedure or function.
pub async fn get_routine_definition(
    database: String,
    name: String,
    routine_type: String,
    state: &DbState,
) -> Result<RoutineDetail, PyroError> {
    let session = get_session(state).await?;
    routine::get_routine_definition(&session.backend, &database, &name, &routine_type).await
}

/// Drops a stored procedure or function.
pub async fn drop_routine(
    database: String,
    name: String,
    routine_type: String,
    state: &DbState,
) -> Result<(), PyroError> {
    let session = get_session(state).await?;
    routine::drop_routine(&session.backend, &database, &name, &routine_type).await
}

/// Saves a stored procedure or function.
pub async fn save_routine(
    database: String,
    old_name: Option<String>,
    routine_type: String,
    ddl: String,
    state: &DbState,
) -> Result<(), PyroError> {
    let session = get_session(state).await?;
    routine::save_routine(
        &session.backend,
        &database,
        old_name.as_deref(),
        &routine_type,
        &ddl,
    )
    .await
}

/// Executes a stored procedure or function.
pub async fn execute_routine(
    database: String,
    name: String,
    routine_type: String,
    params: Vec<serde_json::Value>,
    state: &DbState,
) -> Result<QueryExecutionResult, PyroError> {
    let session = get_session(state).await?;
    routine::execute_routine(&session.backend, &database, &name, &routine_type, &params).await
}

/// Lists triggers for a database or table.
pub async fn list_triggers(
    database: String,
    table: Option<String>,
    state: &DbState,
) -> Result<Vec<TriggerMetadata>, PyroError> {
    let session = get_session(state).await?;
    trigger::list_triggers(&session.backend, &database, table.as_deref()).await
}

/// Retrieves the DDL and configuration details of a trigger.
pub async fn get_trigger_definition(
    database: String,
    name: String,
    state: &DbState,
) -> Result<TriggerDetail, PyroError> {
    let session = get_session(state).await?;
    trigger::get_trigger_definition(&session.backend, &database, &name).await
}

/// Drops a trigger.
pub async fn drop_trigger(
    database: String,
    name: String,
    state: &DbState,
) -> Result<(), PyroError> {
    let session = get_session(state).await?;
    trigger::drop_trigger(&session.backend, &database, &name).await
}

/// Saves a trigger.
pub async fn save_trigger(
    database: String,
    old_name: Option<String>,
    ddl: String,
    state: &DbState,
) -> Result<(), PyroError> {
    let session = get_session(state).await?;
    trigger::save_trigger(&session.backend, &database, old_name.as_deref(), &ddl).await
}

/// Lists all indexes for a specific table.
pub async fn list_indexes(
    database: String,
    table: String,
    state: &DbState,
) -> Result<Vec<IndexMetadata>, PyroError> {
    let session = get_session(state).await?;
    index::list_indexes(&session.backend, &database, &table).await
}

/// Creates a new index on a table.
pub async fn create_index(req: CreateIndexRequest, state: &DbState) -> Result<(), PyroError> {
    let session = get_session(state).await?;
    index::create_index(&session.backend, req).await
}

/// Drops an index by name or PRIMARY key.
pub async fn drop_index(
    database: String,
    table: String,
    index_name: String,
    state: &DbState,
) -> Result<(), PyroError> {
    let session = get_session(state).await?;
    index::drop_index(&session.backend, &database, &table, &index_name).await
}

// ─── P3 Operational Intelligence & Admin Services ────────────────────────────

/// Retrieves comprehensive database dashboard metrics.
pub async fn get_database_dashboard(
    database: String,
    state: &DbState,
) -> Result<crate::db::models::DatabaseDashboardInfo, PyroError> {
    let session = get_session(state).await?;
    crate::db::health::get_database_dashboard(&session.backend, &database).await
}

/// Gathers actionable database and server health diagnostics.
pub async fn get_health_report(
    database: String,
    state: &DbState,
) -> Result<crate::db::models::HealthReport, PyroError> {
    let session = get_session(state).await?;
    crate::db::health::get_health_report(&session.backend, &database).await
}

/// Analyzes a query plan with EXPLAIN / EXPLAIN ANALYZE and detects bottlenecks.
pub async fn analyze_slow_query(
    sql: String,
    database: Option<String>,
    state: &DbState,
) -> Result<crate::db::models::SlowQueryAnalysis, PyroError> {
    let session = get_session(state).await?;
    crate::db::explain::analyze_slow_query(&session.backend, database.as_deref(), &sql).await
}

/// Analyzes database indexes for redundancies and missing foreign key indexes.
pub async fn analyze_database_indexes(
    database: String,
    state: &DbState,
) -> Result<crate::db::models::IndexAdvisorReport, PyroError> {
    let session = get_session(state).await?;
    crate::db::advisor::analyze_database_indexes(&session.backend, &database).await
}

/// Compares two schemas in the active connection.
pub async fn compare_schemas(
    source_database: String,
    target_database: String,
    state: &DbState,
) -> Result<crate::db::models::SchemaDiffResult, PyroError> {
    let session = get_session(state).await?;
    crate::db::diff::compare_schemas(
        &session.backend,
        &source_database,
        &session.backend,
        &target_database,
    )
    .await
}

/// Compares schemas across two different database connections.
pub async fn compare_cross_connection_schemas(
    source_config: crate::db::models::ConnectionConfig,
    source_database: String,
    target_config: crate::db::models::ConnectionConfig,
    target_database: String,
) -> Result<crate::db::models::SchemaDiffResult, PyroError> {
    let src_session = crate::db::connection::create_standalone_session(source_config).await?;
    let tgt_session = crate::db::connection::create_standalone_session(target_config).await?;

    let diff = crate::db::diff::compare_schemas(
        &src_session.backend,
        &source_database,
        &tgt_session.backend,
        &target_database,
    )
    .await;

    src_session.backend.close().await;
    tgt_session.backend.close().await;

    diff
}

/// Generates executable SQL migration scripts from a SchemaDiffResult.
pub fn generate_migration_plan(
    diff: crate::db::models::SchemaDiffResult,
) -> crate::db::models::MigrationPlan {
    crate::db::migration::generate_migration_plan(&diff)
}

/// Retrieves advanced table inspector details including structure, FKs, triggers, stats, and DDL.
pub async fn get_table_inspector_details(
    database: String,
    table: String,
    state: &DbState,
) -> Result<crate::db::models::TableInspectorDetails, PyroError> {
    let session = get_session(state).await?;
    crate::db::inspector::get_table_inspector_details(&session.backend, &database, &table).await
}

/// Executes table maintenance operations (ANALYZE, OPTIMIZE, CHECK, REPAIR).
pub async fn execute_table_operation(
    database: String,
    table: String,
    operation: String,
    state: &DbState,
) -> Result<crate::db::models::TableOperationResult, PyroError> {
    let session = get_session(state).await?;
    crate::db::operations::execute_table_operation(&session.backend, &database, &table, &operation)
        .await
}

/// Executes safe flush maintenance operations.
pub async fn execute_maintenance_flush(
    flush_type: String,
    state: &DbState,
) -> Result<String, PyroError> {
    let session = get_session(state).await?;
    crate::db::operations::execute_maintenance_flush(&session.backend, &flush_type).await
}

/// Offline metadata-based query diagnosis.
pub async fn diagnose_query_with_metadata(
    sql: String,
    database: Option<String>,
    state: &DbState,
) -> Result<crate::db::models::SqlAssistantDiagnosis, PyroError> {
    let session = get_session(state).await?;
    crate::db::assistant::diagnose_query_with_metadata(&session.backend, database.as_deref(), &sql)
        .await
}

/// Builds sanitized AI database context.
pub async fn build_sanitized_ai_context(
    database: String,
    tables: Vec<String>,
    query: Option<String>,
    error_message: Option<String>,
    include_indexes: bool,
    state: &DbState,
) -> Result<crate::db::models::AiDatabaseContext, PyroError> {
    let session = get_session(state).await?;
    crate::db::assistant::build_sanitized_ai_context(
        &session.backend,
        &database,
        &tables,
        query,
        error_message,
        include_indexes,
    )
    .await
}

/// Gathers server slow queries report.
pub async fn get_server_slow_queries(
    database: Option<String>,
    state: &DbState,
) -> Result<crate::db::models::ServerSlowQueriesReport, PyroError> {
    let session = get_session(state).await?;
    crate::db::health::get_server_slow_queries(&session.backend, database.as_deref()).await
}

/// Gathers comprehensive database tables overview with sizes and stats.
pub async fn get_database_tables_overview(
    database: String,
    state: &DbState,
) -> Result<crate::db::models::DatabaseTablesOverview, PyroError> {
    let session = get_session(state).await?;
    crate::db::health::get_database_tables_overview(&session.backend, &database).await
}

/// Exports SQL dump with DDL and multi-row INSERT statements.
pub async fn export_sql_dump(
    req: crate::db::models::SqlDumpRequest,
    state: &DbState,
) -> Result<crate::db::models::SqlDumpSummary, PyroError> {
    let session = get_session(state).await?;
    crate::db::sql_dump::export_sql_dump(&session.backend, req).await
}

/// Executes database restore from a SQL file.
pub async fn execute_sql_restore(
    req: crate::db::models::SqlRestoreRequest,
    app_handle: Option<&tauri::AppHandle>,
    state: &DbState,
) -> Result<crate::db::models::SqlRestoreSummary, PyroError> {
    let session = get_session(state).await?;
    crate::db::restore::execute_sql_restore(&session.backend, app_handle, req).await
}
