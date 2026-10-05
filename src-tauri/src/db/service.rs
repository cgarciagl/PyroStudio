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
