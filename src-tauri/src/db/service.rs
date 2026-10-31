use super::backend::DatabaseBackend;
use super::database;
use super::engine::DbEngine;
use super::error::PyroError;
use super::index;
use super::models::{
    CellUpdateRequest, ColumnMetadata, CreateIndexRequest, DatabaseSchema, DeleteRowRequest,
    IndexMetadata, PrimaryKey, QueryExecutionResult, RoutineDetail, RoutineMetadata,
    TableDataRequest, TableDataResult, TableMetadata, TriggerDetail, TriggerMetadata,
};
use super::routine;
use super::row;
pub use super::session::get_session;
use super::sqlite::alter::ColumnChangeRequest;
use super::state::{ActiveSession, DbState};
use super::table;
use super::trigger;

// Re-exports for backwards compatibility and cross-module consumers
pub use super::connection::{
    connect, disconnect, get_connection_status, resolve_config_credentials, test_connection,
};
pub use super::query::{json_value_to_sql_literal, DEFAULT_MAX_INTERACTIVE_ROWS};
pub use super::safe_mode::{
    analyze_sql_safety, clean_sql_statement, DangerLevel, SqlSafetyAnalysis,
};

/// Executes a query on an explicit active session.
pub async fn execute_query_session(
    session: &ActiveSession,
    sql: &str,
    database: Option<&str>,
) -> Result<QueryExecutionResult, PyroError> {
    session.backend.execute_query(sql, database).await
}

/// Executes a raw SQL query using the current session in DbState, optionally tracking query_id for cancellation.
pub async fn execute_query(
    sql: String,
    database: Option<String>,
    query_id: Option<String>,
    guard: SafeModeGuard,
    state: &DbState,
) -> Result<QueryExecutionResult, PyroError> {
    let session = get_session(state).await?;
    super::safe_mode_gate::enforce(
        &sql,
        guard.enabled,
        session.config.environment.as_deref(),
        guard.confirmation_token.as_deref(),
        super::safe_mode_gate::ConfirmationStore::global(),
    )?;
    session
        .backend
        .execute_query_cancellable(&sql, database.as_deref(), query_id.as_deref())
        .await
}

/// Safe Mode parameters sent with a user-supplied SQL execution.
pub struct SafeModeGuard {
    /// User preference; forced on by the backend in Production.
    pub enabled: bool,
    /// Single-use token from `confirm_sql_execution`.
    pub confirmation_token: Option<String>,
}

/// Cancels an active query running on the database server.
pub async fn cancel_query(query_id: String, state: &DbState) -> Result<bool, PyroError> {
    let session = get_session(state).await?;
    session.backend.cancel_query(&query_id).await
}

/// Pings the active database connection and returns latency in milliseconds.
pub async fn ping_database(state: &DbState) -> Result<u64, PyroError> {
    let session = get_session(state).await?;
    let start = std::time::Instant::now();
    let _ = session.backend.execute_query("SELECT 1", None).await?;
    let elapsed = start.elapsed().as_millis() as u64;
    Ok(elapsed)
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

/// Retrieves a map of all tables and columns in a database for autocompletion.
pub async fn get_database_completion_schema(
    database: String,
    state: &DbState,
) -> Result<std::collections::HashMap<String, Vec<String>>, PyroError> {
    let session = get_session(state).await?;
    table::get_database_completion_schema(&session.backend, &database).await
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
    req: TableDataRequest,
    state: &DbState,
) -> Result<TableDataResult, PyroError> {
    let session = get_session(state).await?;
    table::query_table_data(&session.backend, req).await
}

/// Renames a table inside its database.
pub async fn rename_table(
    database: String,
    table: String,
    new_name: String,
    state: &DbState,
) -> Result<(), PyroError> {
    let session = get_session(state).await?;
    table::rename_table(&session.backend, &database, &table, &new_name).await
}

/// Statements that would change a SQLite column (shown before applying).
pub async fn plan_sqlite_column_change(
    req: ColumnChangeRequest,
    state: &DbState,
) -> Result<Vec<String>, PyroError> {
    let session = sqlite_session(state).await?;
    super::sqlite::alter::plan_column_change(&session.backend, &req).await
}

/// Plans the change again and applies it atomically.
pub async fn apply_sqlite_column_change(
    req: ColumnChangeRequest,
    state: &DbState,
) -> Result<(), PyroError> {
    let session = sqlite_session(state).await?;
    let script = super::sqlite::alter::plan_column_change(&session.backend, &req).await?;
    super::sqlite::alter::apply_script(&session.backend, &script).await
}

/// Active session, which must be a SQLite one.
async fn sqlite_session(state: &DbState) -> Result<ActiveSession, PyroError> {
    let session = get_session(state).await?;
    if session.backend.engine() != DbEngine::Sqlite {
        return Err(PyroError::InvalidOperation(
            "La operación solo aplica a bases SQLite.".into(),
        ));
    }
    Ok(session)
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

/// Analyzes indexes for a single table specifically.
pub async fn analyze_table_indexes(
    database: String,
    table: String,
    state: &DbState,
) -> Result<crate::db::models::IndexAdvisorReport, PyroError> {
    let session = get_session(state).await?;
    crate::db::advisor::analyze_table_indexes(&session.backend, &database, &table).await
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

/// Terminates an active query or kills an entire server session/process.
pub async fn execute_kill_process(
    process_id: u64,
    kill_type: String,
    state: &DbState,
) -> Result<String, PyroError> {
    let session = get_session(state).await?;
    crate::db::operations::execute_kill_process(&session.backend, process_id, &kill_type).await
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

/// Backs up a local SQLite database file using VACUUM INTO.
///
/// The copy is written to a temporary sibling file and renamed over the
/// destination only after it succeeds, so a failed backup never destroys an
/// existing file. Tunnel connections are rejected: `VACUUM INTO` would write
/// on the remote server, not on this machine.
pub async fn backup_sqlite(destination_path: &str, state: &DbState) -> Result<(), PyroError> {
    let session = get_session(state).await?;
    let crate::db::state::SessionTransport::Sqlite(backend) = &session.backend.transport else {
        return Err(PyroError::InvalidOperation(
            "El respaldo por archivo (VACUUM INTO) solo está disponible en conexiones SQLite locales."
                .into(),
        ));
    };

    let dest_path = std::path::Path::new(destination_path);
    if is_same_file(dest_path, std::path::Path::new(backend.file_path())) {
        return Err(PyroError::InvalidOperation(
            "El destino del respaldo no puede ser la base de datos abierta.".into(),
        ));
    }

    let mut tmp_name = dest_path.file_name().unwrap_or_default().to_os_string();
    tmp_name.push(format!(".pyro-tmp-{}", std::process::id()));
    let tmp_path = dest_path.with_file_name(tmp_name);
    let _ = std::fs::remove_file(&tmp_path);

    let tmp_str = tmp_path.to_string_lossy();
    let sql = format!("VACUUM INTO '{}';", tmp_str.replace('\'', "''"));
    if let Err(error) = session.backend.execute_query(&sql, None).await {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(error);
    }

    if dest_path.exists() {
        // `rename` does not overwrite existing files on every platform.
        if let Err(e) = std::fs::remove_file(dest_path) {
            let _ = std::fs::remove_file(&tmp_path);
            return Err(PyroError::InvalidOperation(format!(
                "No se pudo reemplazar el archivo de respaldo existente: {e}"
            )));
        }
    }
    std::fs::rename(&tmp_path, dest_path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path);
        PyroError::InvalidOperation(format!("No se pudo guardar el archivo de respaldo: {e}"))
    })
}

/// Compares two paths after resolving them; a destination that does not exist
/// yet is compared through its canonical parent directory.
fn is_same_file(a: &std::path::Path, b: &std::path::Path) -> bool {
    fn resolve(path: &std::path::Path) -> Option<std::path::PathBuf> {
        path.canonicalize().ok().or_else(|| {
            let parent = path.parent()?.canonicalize().ok()?;
            Some(parent.join(path.file_name()?))
        })
    }
    match (resolve(a), resolve(b)) {
        (Some(a), Some(b)) => a == b,
        _ => false,
    }
}

/// Exports SQL dump with DDL and multi-row INSERT statements.
pub async fn export_sql_dump(
    req: crate::db::models::SqlDumpRequest,
    state: &DbState,
) -> Result<crate::db::models::SqlDumpSummary, PyroError> {
    let session = get_session(state).await?;
    crate::db::sql_dump::export_sql_dump(&session.backend, req).await
}

/// Executes a high-performance structured backup in directory format.
pub async fn execute_directory_backup(
    options: crate::db::backup::BackupOptions,
    state: &DbState,
) -> Result<crate::db::backup::BackupSummary, PyroError> {
    let session = get_session(state).await?;
    crate::db::backup::execute_backup(&session.backend, options).await
}

/// Verifies integrity and checksums of an existing structured backup directory.
pub fn verify_directory_backup(
    backup_dir: String,
) -> Result<crate::db::backup::BackupVerificationResult, PyroError> {
    crate::db::backup::verify_backup(std::path::Path::new(&backup_dir))
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

// ─── P4: AI Intelligence & Automation Service Layer ─────────────────────────

/// Explains a SQL query using AI combined with execution plan.
pub async fn explain_sql_ai(
    database: String,
    sql: String,
    config: crate::db::ai::AiConfig,
    state: &DbState,
) -> Result<crate::db::ai::SqlExplanationResult, PyroError> {
    let session = get_session(state).await?;
    let provider = crate::db::ai::create_ai_provider(&config)?;
    crate::db::ai::explain_sql(&session.backend, &database, &sql, provider.as_ref()).await
}

/// Generates SQL query from natural language with schema context.
pub async fn generate_sql_ai(
    database: String,
    prompt: String,
    config: crate::db::ai::AiConfig,
    state: &DbState,
) -> Result<crate::db::ai::SqlGenerationResult, PyroError> {
    let session = get_session(state).await?;
    let provider = crate::db::ai::create_ai_provider(&config)?;
    crate::db::ai::generate_sql(&session.backend, &database, &prompt, provider.as_ref()).await
}

/// Optimizes a SQL query and suggests index enhancements.
pub async fn optimize_sql_ai(
    database: String,
    sql: String,
    config: crate::db::ai::AiConfig,
    state: &DbState,
) -> Result<crate::db::ai::SqlOptimizationResult, PyroError> {
    let session = get_session(state).await?;
    let provider = crate::db::ai::create_ai_provider(&config)?;
    crate::db::ai::optimize_sql(&session.backend, &database, &sql, provider.as_ref()).await
}

/// Diagnoses execution errors and proposes corrected SQL.
pub async fn fix_sql_error_ai(
    database: String,
    sql: String,
    error_message: String,
    sqlstate: Option<String>,
    error_code: Option<u32>,
    config: crate::db::ai::AiConfig,
    state: &DbState,
) -> Result<crate::db::ai::SqlErrorFixResult, PyroError> {
    let session = get_session(state).await?;
    let provider = crate::db::ai::create_ai_provider(&config)?;
    crate::db::ai::fix_sql_error(
        &session.backend,
        &database,
        &sql,
        &error_message,
        sqlstate,
        error_code,
        provider.as_ref(),
    )
    .await
}

/// Generates SQL edge-case tests.
pub async fn generate_sql_tests_ai(
    database: String,
    sql: String,
    config: crate::db::ai::AiConfig,
    state: &DbState,
) -> Result<crate::db::ai::SqlTestCasesResult, PyroError> {
    let session = get_session(state).await?;
    let provider = crate::db::ai::create_ai_provider(&config)?;
    crate::db::ai::generate_sql_tests(&session.backend, &database, &sql, provider.as_ref()).await
}

/// Generates technical documentation for schema objects.
pub async fn generate_documentation_ai(
    database: String,
    target_type: String,
    target_name: String,
    config: crate::db::ai::AiConfig,
    state: &DbState,
) -> Result<crate::db::ai::SqlDocumentationResult, PyroError> {
    let session = get_session(state).await?;
    let provider = crate::db::ai::create_ai_provider(&config)?;
    crate::db::ai::generate_documentation(
        &session.backend,
        &database,
        &target_type,
        &target_name,
        provider.as_ref(),
    )
    .await
}

/// Runs the multi-step Database Agent reasoning loop.
pub async fn run_database_agent_ai(
    database: String,
    question: String,
    config: crate::db::ai::AiConfig,
    max_steps: Option<usize>,
    state: &DbState,
) -> Result<crate::db::ai::AgentRunResult, PyroError> {
    let session = get_session(state).await?;
    let provider = crate::db::ai::create_ai_provider(&config)?;
    crate::db::ai::run_database_agent(
        &session.backend,
        &database,
        &question,
        provider.as_ref(),
        max_steps,
    )
    .await
}

/// Searches the schema with keyword and natural language.
pub async fn smart_search_schema_ai(
    database: String,
    query: String,
    config: Option<crate::db::ai::AiConfig>,
    state: &DbState,
) -> Result<crate::db::ai::SmartSearchResult, PyroError> {
    let session = get_session(state).await?;
    let provider_opt = if let Some(ref cfg) = config {
        if cfg.enabled {
            crate::db::ai::create_ai_provider(cfg).ok()
        } else {
            None
        }
    } else {
        None
    };
    crate::db::ai::smart_search(&session.backend, &database, &query, provider_opt.as_deref()).await
}

/// Generates Database Health summary separating facts from AI interpretation.
pub async fn get_database_health_summary_ai(
    database: String,
    config: Option<crate::db::ai::AiConfig>,
    state: &DbState,
) -> Result<crate::db::ai::DatabaseHealthSummaryResult, PyroError> {
    let session = get_session(state).await?;
    let provider_opt = if let Some(ref cfg) = config {
        if cfg.enabled {
            crate::db::ai::create_ai_provider(cfg).ok()
        } else {
            None
        }
    } else {
        None
    };
    crate::db::ai::summarize_database_health(&session.backend, &database, provider_opt.as_deref())
        .await
}

/// Reviews schema diff / migration for risks.
pub async fn review_schema_migration_ai(
    diff: crate::db::models::SchemaDiffResult,
    config: crate::db::ai::AiConfig,
) -> Result<crate::db::ai::MigrationReviewResult, PyroError> {
    let provider = crate::db::ai::create_ai_provider(&config)?;
    crate::db::ai::review_schema_migration(&diff, provider.as_ref()).await
}

/// Generates Markdown, HTML, JSON reports.
pub async fn generate_database_report_ai(
    database: String,
    report_type: String,
    config: Option<crate::db::ai::AiConfig>,
    state: &DbState,
) -> Result<crate::db::ai::GeneratedReport, PyroError> {
    let session = get_session(state).await?;
    let provider_opt = if let Some(ref cfg) = config {
        if cfg.enabled {
            crate::db::ai::create_ai_provider(cfg).ok()
        } else {
            None
        }
    } else {
        None
    };
    crate::db::ai::generate_database_report(
        &session.backend,
        &database,
        &report_type,
        provider_opt.as_deref(),
    )
    .await
}

/// Tests AI provider connection and model response.
pub async fn test_ai_provider(
    config: crate::db::ai::AiConfig,
) -> Result<crate::db::ai::AiCompletionResponse, PyroError> {
    let provider = crate::db::ai::create_ai_provider(&config)?;
    let req = crate::db::ai::AiCompletionRequest {
        system_prompt: Some(
            "You are a connection test agent. Respond with 'PyroStudio AI Connected Successfully.'"
                .into(),
        ),
        messages: vec![crate::db::ai::AiMessage::user("Ping")],
        tools: vec![],
        temperature: Some(0.0),
        max_tokens: Some(50),
    };
    provider.complete(&req).await
}

/// Executes a batch of SQL statements sequentially in a transaction.
pub async fn execute_transaction(
    database: String,
    statements: Vec<String>,
    state: &DbState,
) -> Result<usize, PyroError> {
    if statements.is_empty() {
        return Ok(0);
    }
    let session = get_session(state).await?;
    let db_arg = if database.trim().is_empty() {
        None
    } else {
        Some(database.as_str())
    };
    session
        .backend
        .execute_transaction(&statements, db_arg)
        .await
}

/// Row-level comparison of two tables; either side may use another saved connection.
pub async fn compare_table_data(
    request: super::data_compare::DataCompareRequest,
    state: &DbState,
) -> Result<super::data_compare::DataCompareResult, PyroError> {
    use super::data_compare::compare_table_data as compare;
    let open = |config: Option<super::models::ConnectionConfig>| async move {
        match config {
            Some(config) => crate::db::connection::create_standalone_session(config)
                .await
                .map(Some),
            None => Ok(None),
        }
    };
    let source_standalone = open(request.source.connection.clone()).await?;
    let target_standalone = match open(request.target.connection.clone()).await {
        Ok(session) => session,
        Err(err) => {
            if let Some(session) = &source_standalone {
                session.backend.close().await;
            }
            return Err(err);
        }
    };
    let active = if source_standalone.is_none() || target_standalone.is_none() {
        Some(get_session(state).await?)
    } else {
        None
    };
    let source = source_standalone
        .as_ref()
        .map(|s| &s.backend)
        .or(active.as_ref().map(|s| &s.backend))
        .unwrap();
    let target = target_standalone
        .as_ref()
        .map(|s| &s.backend)
        .or(active.as_ref().map(|s| &s.backend))
        .unwrap();

    let result = compare(source, target, &request).await;

    for session in [source_standalone, target_standalone].into_iter().flatten() {
        session.backend.close().await;
    }
    result
}

/// Suggested generator per column plus a few sample rows (never on PROD or read-only).
pub async fn plan_test_data(
    database: String,
    table: String,
    state: &DbState,
) -> Result<super::test_data::TestDataPlan, PyroError> {
    let session = get_session(state).await?;
    super::test_data::ensure_allowed(&session.config)?;
    super::test_data::plan_test_data(&session.backend, &database, &table).await
}

/// Inserts synthetic rows (never on PROD or read-only connections).
pub async fn generate_test_data(
    request: super::test_data::TestDataRequest,
    state: &DbState,
) -> Result<super::test_data::TestDataSummary, PyroError> {
    let session = get_session(state).await?;
    super::test_data::ensure_allowed(&session.config)?;
    super::test_data::generate_test_data(&session.backend, &request).await
}

/// Tables, columns and foreign keys of a database for the ER diagram.
pub async fn get_er_schema(
    database: String,
    state: &DbState,
) -> Result<super::er::ErSchema, PyroError> {
    let session = get_session(state).await?;
    super::er::fetch_er_schema(&session.backend, &database).await
}

/// Foreign keys elsewhere in the database that reference `table`.
pub async fn get_referencing_foreign_keys(
    database: String,
    table: String,
    state: &DbState,
) -> Result<Vec<super::er::ErRelation>, PyroError> {
    let session = get_session(state).await?;
    super::er::fetch_referencing_relations(&session.backend, &database, &table).await
}

/// Retrieves foreign key constraints for a specific table.
pub async fn get_table_foreign_keys(
    database: String,
    table: String,
    state: &DbState,
) -> Result<Vec<super::models::ForeignKeyMetadata>, PyroError> {
    let session = get_session(state).await?;
    let all_fks = crate::db::diff::fetch_schema_foreign_keys(&session.backend, &database).await?;
    Ok(all_fks.get(&table).cloned().unwrap_or_default())
}

/// Previews the number of rows affected by an UPDATE or DELETE statement using a safe COUNT query.
pub async fn preview_affected_rows(
    database: String,
    sql: String,
    state: &DbState,
) -> Result<Option<u64>, PyroError> {
    if let Some(count_sql) = crate::db::safe_mode::build_affected_count_query(&sql) {
        let session = get_session(state).await?;
        let res = session
            .backend
            .execute_query(&count_sql, Some(&database))
            .await?;
        if let Some(first_row) = res.rows.first() {
            if let Some(val) = first_row.first() {
                let count = crate::db::query::value_to_u64(val).unwrap_or(0);
                return Ok(Some(count));
            }
        }
        return Ok(Some(0));
    }
    Ok(None)
}

// ─── MariaDB Modern Capabilities & Diagnostics Services ─────────────────────

pub async fn get_server_capabilities(
    state: &DbState,
) -> Result<crate::db::capabilities::ServerCapabilities, PyroError> {
    let session = get_session(state).await?;
    crate::db::capabilities::detect_server_capabilities(&session.backend).await
}

pub async fn execute_analyze_format_json(
    sql: String,
    database: Option<String>,
    allow_execution: bool,
    state: &DbState,
) -> Result<crate::db::models::AnalyzeExecutionResult, PyroError> {
    let session = get_session(state).await?;
    crate::db::explain::execute_analyze_format_json(
        &session.backend,
        database.as_deref(),
        &sql,
        allow_execution,
    )
    .await
}

pub async fn list_events(
    database: String,
    state: &DbState,
) -> Result<Vec<crate::db::models::EventMetadata>, PyroError> {
    let session = get_session(state).await?;
    crate::db::event::list_events(&session.backend, &database).await
}

pub async fn get_event_definition(
    database: String,
    event_name: String,
    state: &DbState,
) -> Result<crate::db::models::EventDetail, PyroError> {
    let session = get_session(state).await?;
    crate::db::event::get_event_definition(&session.backend, &database, &event_name).await
}

pub async fn toggle_event(
    database: String,
    event_name: String,
    enable: bool,
    state: &DbState,
) -> Result<(), PyroError> {
    let session = get_session(state).await?;
    crate::db::event::toggle_event(&session.backend, &database, &event_name, enable).await
}

pub async fn drop_event(
    database: String,
    event_name: String,
    state: &DbState,
) -> Result<(), PyroError> {
    let session = get_session(state).await?;
    crate::db::event::drop_event(&session.backend, &database, &event_name).await
}

pub async fn list_sequences(
    database: String,
    state: &DbState,
) -> Result<Vec<crate::db::models::SequenceMetadata>, PyroError> {
    let session = get_session(state).await?;
    crate::db::sequence::list_sequences(&session.backend, &database).await
}

pub async fn get_sequence_definition(
    database: String,
    sequence_name: String,
    state: &DbState,
) -> Result<crate::db::models::SequenceDetail, PyroError> {
    let session = get_session(state).await?;
    crate::db::sequence::get_sequence_definition(&session.backend, &database, &sequence_name).await
}

pub async fn drop_sequence(
    database: String,
    sequence_name: String,
    state: &DbState,
) -> Result<(), PyroError> {
    let session = get_session(state).await?;
    crate::db::sequence::drop_sequence(&session.backend, &database, &sequence_name).await
}

pub async fn get_table_partitions(
    database: String,
    table: String,
    state: &DbState,
) -> Result<crate::db::models::TablePartitioningInfo, PyroError> {
    let session = get_session(state).await?;
    crate::db::partition::get_table_partitions(&session.backend, &database, &table).await
}

pub async fn inspect_system_versioning(
    database: String,
    table: String,
    state: &DbState,
) -> Result<crate::db::models::SystemVersionedTableInfo, PyroError> {
    let session = get_session(state).await?;
    crate::db::temporal::inspect_system_versioning(&session.backend, &database, &table).await
}

pub async fn list_database_users(
    state: &DbState,
) -> Result<Vec<crate::db::models::DatabaseUserMetadata>, PyroError> {
    let session = get_session(state).await?;
    crate::db::user::list_database_users(&session.backend).await
}

pub async fn get_user_grants(
    user: String,
    host: String,
    state: &DbState,
) -> Result<crate::db::models::UserPrivilegeInfo, PyroError> {
    let session = get_session(state).await?;
    crate::db::user::get_user_grants(&session.backend, &user, &host).await
}

#[cfg(test)]
mod tests {
    use super::is_same_file;

    #[test]
    fn is_same_file_detects_the_open_database_even_through_relative_segments() {
        let dir = std::env::temp_dir();
        let db = dir.join(format!("pyro-same-file-{}.db", std::process::id()));
        std::fs::write(&db, b"").unwrap();
        let roundabout = dir.join(".").join(db.file_name().unwrap());

        assert!(is_same_file(&roundabout, &db));
        assert!(!is_same_file(&dir.join("pyro-other-backup.db"), &db));
        let _ = std::fs::remove_file(&db);
    }
}
