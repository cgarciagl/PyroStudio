use futures_util::future::BoxFuture;
use futures_util::FutureExt;
use sqlx::mysql::MySqlConnection;
use sqlx::pool::PoolConnection;
use sqlx::{Executor, MySql, MySqlPool, Row};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;

use super::export::export_row;
use super::row::{bind_json_value, bind_sql_params, MySqlRowDecoder};
use crate::db::backend::{
    BackendTransaction, DatabaseBackend, EngineError, PinnedSession, RowStream,
    TableTransactionality,
};
use crate::db::dialect::MYSQL_DIALECT;
use crate::db::engine::DbEngine;
use crate::db::error::PyroError;
use crate::db::models::{
    CellUpdateRequest, DeleteRowRequest, QueryExecutionResult, ScriptExecutionResult,
    ScriptStatementResult,
};
use crate::db::param_query::ParamQuery;
use crate::db::row_filter::{
    bound_row_filter, delete_row_conditions, target_database, update_row_conditions,
};
use crate::db::sql_utils::{qualify_table, quote_identifier};
use crate::db::sqlx_support::{
    collect_all_result_sets, collect_first_result_set, run_in_transaction, spawn_row_stream,
    statement_result,
};

pub const DEFAULT_MAX_POOL_CONNECTIONS: u32 = 10;
pub const DEFAULT_MIN_POOL_CONNECTIONS: u32 = 1;
pub const DEFAULT_MAX_BACKGROUND_CONCURRENCY: usize = 2;

/// MariaDB/MySQL backend over a direct (TCP or SSH-forwarded) SQLx pool.
#[derive(Clone)]
pub struct DirectBackend {
    pool: MySqlPool,
    /// Query id -> server `CONNECTION_ID()` running it, for `KILL QUERY`.
    active_queries: Arc<Mutex<HashMap<String, u64>>>,
    /// Limits concurrent heavy background operations (exports, backups, diffs) to prevent pool starvation.
    background_semaphore: Arc<tokio::sync::Semaphore>,
    max_background_tasks: usize,
}

impl DirectBackend {
    pub fn new(pool: MySqlPool) -> Self {
        Self::with_background_limit(pool, DEFAULT_MAX_BACKGROUND_CONCURRENCY)
    }

    pub fn with_background_limit(pool: MySqlPool, max_background_tasks: usize) -> Self {
        let max_tasks = max_background_tasks.max(1);
        Self {
            pool,
            active_queries: Arc::new(Mutex::new(HashMap::new())),
            background_semaphore: Arc::new(tokio::sync::Semaphore::new(max_tasks)),
            max_background_tasks: max_tasks,
        }
    }

    pub fn pool_stats(&self) -> crate::db::models::PoolStats {
        crate::db::models::PoolStats {
            size: self.pool.size(),
            idle: self.pool.num_idle(),
            max_connections: DEFAULT_MAX_POOL_CONNECTIONS,
            max_background_slots: self.max_background_tasks,
            available_background_slots: self.background_semaphore.available_permits(),
        }
    }

    pub async fn cancel_active_query(&self, query_id: &str) -> Result<bool, PyroError> {
        let Some(connection_id) = self.active_queries.lock().await.remove(query_id) else {
            return Ok(false);
        };
        let mut conn = self
            .acquire("Error obteniendo conexión para cancelar consulta")
            .await?;
        let kill_sql = format!("KILL QUERY {connection_id}");
        let _ = sqlx::query(&kill_sql).execute(&mut *conn).await;
        Ok(true)
    }

    async fn acquire(&self, error_context: &str) -> Result<PoolConnection<MySql>, PyroError> {
        self.pool
            .acquire()
            .await
            .map_err(|error| PyroError::Connection(format!("{error_context}: {error}")))
    }

    /// Records which server connection runs `query_id` so it can be killed.
    async fn register_cancellable(
        &self,
        conn: &mut MySqlConnection,
        query_id: &str,
    ) -> Option<String> {
        let row = sqlx::query("SELECT CONNECTION_ID() AS cid")
            .fetch_one(&mut *conn)
            .await
            .ok()?;
        let connection_id: u64 = row.try_get("cid").unwrap_or(0);
        if connection_id == 0 {
            return None;
        }
        self.active_queries
            .lock()
            .await
            .insert(query_id.to_string(), connection_id);
        Some(query_id.to_string())
    }

    async fn unregister_cancellable(&self, query_id: Option<String>) {
        if let Some(query_id) = query_id {
            self.active_queries.lock().await.remove(&query_id);
        }
    }
}

impl DatabaseBackend for DirectBackend {
    fn engine(&self) -> DbEngine {
        DbEngine::MySql
    }

    fn execute_query<'a>(
        &'a self,
        sql: &'a str,
        database: Option<&'a str>,
    ) -> BoxFuture<'a, Result<QueryExecutionResult, PyroError>> {
        self.execute_query_cancellable(sql, database, None)
    }

    fn execute_query_cancellable<'a>(
        &'a self,
        sql: &'a str,
        database: Option<&'a str>,
        query_id: Option<&'a str>,
    ) -> BoxFuture<'a, Result<QueryExecutionResult, PyroError>> {
        async move {
            let start = Instant::now();
            let mut conn = self.acquire("Error obteniendo conexión del pool").await?;
            let registered = match query_id {
                Some(query_id) => self.register_cancellable(&mut conn, query_id).await,
                None => None,
            };
            let result = run_query(&mut conn, sql, database, start).await;
            self.unregister_cancellable(registered).await;
            result
        }
        .boxed()
    }

    fn execute_script<'a>(
        &'a self,
        statements: &'a [String],
        database: Option<&'a str>,
        query_id: Option<&'a str>,
        stop_on_error: bool,
    ) -> BoxFuture<'a, Result<ScriptExecutionResult, PyroError>> {
        async move {
            let start = Instant::now();
            let mut conn = self.acquire("Error obteniendo conexión del pool").await?;
            let registered = match query_id {
                Some(query_id) => self.register_cancellable(&mut conn, query_id).await,
                None => None,
            };
            let result =
                run_script_on_conn(&mut conn, statements, database, stop_on_error, start).await;
            self.unregister_cancellable(registered).await;

            // Decisión de arquitectura (prevención de fuga de estado de sesión):
            // Si el script ejecutó o contuvo sentencias que alteran el estado de sesión (SET @var,
            // SET SESSION, USE, CREATE TEMPORARY TABLE, etc.), desprendemos la conexión
            // del pool con `detach()` y la cerramos explícitamente en lugar de devolverla.
            // Aunque MySQL 8+ soporta `RESET CONNECTION`, MariaDB y versiones heredadas
            // tienen comportamientos dispares con variables de usuario o tablas temporales.
            // Descartar la conexión física garantiza aislamiento estricto y seguro: el pool
            // creará una conexión limpia y libre de estado residual cuando sea requerida.
            let alters_session = statements
                .iter()
                .any(|s| crate::db::sql_utils::statement_alters_session_state(s));
            if alters_session {
                let raw_conn = sqlx::pool::PoolConnection::detach(conn);
                let _ = sqlx::Connection::close(raw_conn).await;
            }

            result
        }
        .boxed()
    }

    fn cancel_query<'a>(&'a self, query_id: &'a str) -> BoxFuture<'a, Result<bool, PyroError>> {
        async move { self.cancel_active_query(query_id).await }.boxed()
    }

    fn update_cell<'a>(
        &'a self,
        req: &'a CellUpdateRequest,
    ) -> BoxFuture<'a, Result<(), PyroError>> {
        async move {
            let conditions = update_row_conditions(req)?;
            let database = target_database(&req.database);
            let table_ref = qualify_table(database, &req.table)?;
            let column = quote_identifier(&req.column_name)?;
            let filter = bound_row_filter(&MYSQL_DIALECT, &conditions)?;
            let sql = format!(
                "UPDATE {table_ref} SET {column} = ? WHERE {} LIMIT 1",
                filter.clause
            );

            let mut conn = self.acquire("Error obteniendo conexión").await?;
            if let Some(database) = database {
                use_database(&mut conn, database, |error| {
                    PyroError::Database(error.to_string())
                })
                .await?;
            }
            let query = bind_json_value(sqlx::query(&sql), &req.new_value);
            filter
                .values
                .into_iter()
                .fold(query, bind_json_value)
                .execute(&mut *conn)
                .await
                .map_err(|error| {
                    PyroError::Database(format!("Error actualizando celda: {error}"))
                })?;
            Ok(())
        }
        .boxed()
    }

    fn delete_row<'a>(&'a self, req: &'a DeleteRowRequest) -> BoxFuture<'a, Result<(), PyroError>> {
        async move {
            let conditions = delete_row_conditions(req)?;
            let database = target_database(&req.database);
            let table_ref = qualify_table(database, &req.table)?;
            let filter = bound_row_filter(&MYSQL_DIALECT, &conditions)?;
            let sql = format!("DELETE FROM {table_ref} WHERE {} LIMIT 1", filter.clause);

            let mut conn = self.acquire("Error obteniendo conexión").await?;
            if let Some(database) = database {
                use_database(&mut conn, database, |error| {
                    PyroError::Database(error.to_string())
                })
                .await?;
            }
            filter
                .values
                .into_iter()
                .fold(sqlx::query(&sql), bind_json_value)
                .execute(&mut *conn)
                .await
                .map_err(|error| PyroError::Database(format!("Error eliminando fila: {error}")))?;
            Ok(())
        }
        .boxed()
    }

    fn execute_transaction<'a>(
        &'a self,
        statements: &'a [String],
        database: Option<&'a str>,
    ) -> BoxFuture<'a, Result<usize, PyroError>> {
        async move {
            if statements.is_empty() {
                return Ok(0);
            }
            let mut conn = self
                .acquire("Error obteniendo conexión para transacción")
                .await?;
            if let Some(database) = non_blank(database) {
                use_database(&mut conn, database, |error| {
                    PyroError::Database(format!(
                        "Error seleccionando base de datos '{database}': {error}"
                    ))
                })
                .await?;
            }
            run_in_transaction::<MySql>(&mut conn, "START TRANSACTION", statements).await
        }
        .boxed()
    }

    fn stream_rows<'a>(
        &'a self,
        sql: &'a str,
        database: Option<&'a str>,
    ) -> BoxFuture<'a, Result<RowStream, EngineError>> {
        async move {
            let slot = self.acquire_background_slot().await.map_err(|e| {
                EngineError::new(format!(
                    "Error adquiriendo ranura de ejecución en segundo plano: {e}"
                ))
            })?;
            let mut conn = self.pool.acquire().await.map_err(|error| {
                EngineError::from(error).with_context("Error adquiriendo conexión para exportación")
            })?;
            if let Some(database) = database {
                use_database(&mut conn, database, |error| {
                    EngineError::from(error)
                        .with_context("Error cambiando base de datos para exportar")
                })
                .await?;
            }
            // A slow export (or a slow disk on our side) must not make the server
            // drop the connection mid-stream. Best effort: the defaults still work.
            let _ = conn
                .execute("SET SESSION net_read_timeout = 3600, net_write_timeout = 3600")
                .await;
            let stream = spawn_row_stream(conn, sql.to_string(), export_row);
            Ok(crate::db::backend::attach_slot_to_stream(stream, slot))
        }
        .boxed()
    }

    fn supports_transactions(&self) -> bool {
        true
    }

    fn begin_transaction(&self) -> BoxFuture<'_, Result<Box<dyn BackendTransaction>, EngineError>> {
        async move {
            let transaction = self.pool.begin().await?;
            Ok(Box::new(MySqlTransaction(transaction)) as Box<dyn BackendTransaction>)
        }
        .boxed()
    }

    fn execute_params<'a>(
        &'a self,
        query: &'a ParamQuery,
    ) -> BoxFuture<'a, Result<u64, EngineError>> {
        async move {
            let result = bind_sql_params(sqlx::query(query.sql()), query.params())
                .execute(&self.pool)
                .await?;
            Ok(result.rows_affected())
        }
        .boxed()
    }

    /// Only InnoDB guarantees rollback among the common MariaDB/MySQL engines.
    fn table_transactionality<'a>(
        &'a self,
        database: &'a str,
        table: &'a str,
    ) -> BoxFuture<'a, Result<TableTransactionality, EngineError>> {
        async move {
            let engine = sqlx::query_scalar::<_, String>(
                "SELECT COALESCE(ENGINE, '') FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
            )
            .bind(database)
            .bind(table)
            .fetch_optional(&self.pool)
            .await?;
            Ok(match engine {
                Some(engine) if engine.eq_ignore_ascii_case("InnoDB") => {
                    TableTransactionality::Transactional
                }
                Some(_) => TableTransactionality::NonTransactional,
                None => TableTransactionality::NotFound,
            })
        }
        .boxed()
    }

    fn open_pinned_session(&self) -> BoxFuture<'_, Result<Box<dyn PinnedSession>, PyroError>> {
        async move {
            let mut conn = self
                .acquire("Error reservando conexión para la transacción")
                .await?;
            conn.execute("SET autocommit = 0").await.map_err(|error| {
                PyroError::Database(format!("No se pudo iniciar la transacción: {error}"))
            })?;
            Ok(Box::new(MySqlPinnedSession(conn)) as Box<dyn PinnedSession>)
        }
        .boxed()
    }

    fn open_snapshot_session(&self) -> BoxFuture<'_, Result<Box<dyn PinnedSession>, PyroError>> {
        async move {
            let slot = self.acquire_background_slot().await?;
            let mut conn = self
                .acquire("Error reservando conexión para el volcado consistente")
                .await?;
            conn.execute("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ")
                .await
                .map_err(|error| {
                    PyroError::Database(format!(
                        "No se pudo configurar el nivel de aislamiento REPEATABLE READ: {error}"
                    ))
                })?;
            conn.execute("START TRANSACTION WITH CONSISTENT SNAPSHOT")
                .await
                .map_err(|error| {
                    PyroError::Database(format!(
                        "No se pudo iniciar la transacción consistente: {error}"
                    ))
                })?;
            Ok(Box::new(MySqlSnapshotSession { conn, _slot: slot }) as Box<dyn PinnedSession>)
        }
        .boxed()
    }

    fn acquire_background_slot(
        &self,
    ) -> BoxFuture<'_, Result<crate::db::backend::BackgroundSlotGuard, PyroError>> {
        let sem = self.background_semaphore.clone();
        async move {
            let permit = sem.acquire_owned().await.map_err(|e| {
                PyroError::InvalidOperation(format!(
                    "Error adquiriendo ranura de conexión en segundo plano: {e}"
                ))
            })?;
            Ok(crate::db::backend::BackgroundSlotGuard::from_permit(permit))
        }
        .boxed()
    }

    fn pool_stats(&self) -> Option<crate::db::models::PoolStats> {
        Some(DirectBackend::pool_stats(self))
    }

    fn close<'a>(&'a self) -> BoxFuture<'a, ()> {
        async move {
            self.pool.close().await;
        }
        .boxed()
    }
}

struct MySqlSnapshotSession {
    conn: PoolConnection<MySql>,
    _slot: crate::db::backend::BackgroundSlotGuard,
}

impl PinnedSession for MySqlSnapshotSession {
    fn query<'a>(
        &'a mut self,
        sql: &'a str,
        database: Option<&'a str>,
    ) -> BoxFuture<'a, Result<QueryExecutionResult, PyroError>> {
        async move { run_query(&mut self.conn, sql, database, Instant::now()).await }.boxed()
    }

    fn release(self: Box<Self>) -> BoxFuture<'static, ()> {
        async move {
            let mut conn = self.conn;
            let _ = conn.execute("ROLLBACK").await;
        }
        .boxed()
    }
}

struct MySqlPinnedSession(PoolConnection<MySql>);

impl PinnedSession for MySqlPinnedSession {
    fn query<'a>(
        &'a mut self,
        sql: &'a str,
        database: Option<&'a str>,
    ) -> BoxFuture<'a, Result<QueryExecutionResult, PyroError>> {
        async move { run_query(&mut self.0, sql, database, Instant::now()).await }.boxed()
    }

    fn release(self: Box<Self>) -> BoxFuture<'static, ()> {
        async move {
            let mut conn = self.0;
            let restored = conn.execute("ROLLBACK").await.is_ok()
                && conn.execute("SET autocommit = 1").await.is_ok();
            if !restored {
                // Never hand a connection in an unknown transaction state back to the pool.
                conn.close_on_drop();
            }
        }
        .boxed()
    }
}

struct MySqlTransaction(sqlx::Transaction<'static, MySql>);

impl BackendTransaction for MySqlTransaction {
    fn execute<'a>(&'a mut self, query: &'a ParamQuery) -> BoxFuture<'a, Result<u64, EngineError>> {
        async move {
            let result = bind_sql_params(sqlx::query(query.sql()), query.params())
                .execute(&mut *self.0)
                .await?;
            Ok(result.rows_affected())
        }
        .boxed()
    }

    fn commit(self: Box<Self>) -> BoxFuture<'static, Result<(), EngineError>> {
        async move { Ok(self.0.commit().await?) }.boxed()
    }

    fn rollback(self: Box<Self>) -> BoxFuture<'static, Result<(), EngineError>> {
        async move { Ok(self.0.rollback().await?) }.boxed()
    }
}

fn non_blank(database: Option<&str>) -> Option<&str> {
    database.map(str::trim).filter(|name| !name.is_empty())
}

/// Runs `USE database` on a reserved connection; `on_error` lets each caller
/// keep its own error message.
async fn use_database<E: From<PyroError>>(
    conn: &mut MySqlConnection,
    database: &str,
    on_error: impl FnOnce(sqlx::Error) -> E,
) -> Result<(), E> {
    let statement = format!("USE {}", quote_identifier(database)?);
    conn.execute(statement.as_str())
        .await
        .map(|_| ())
        .map_err(on_error)
}

async fn run_query(
    conn: &mut MySqlConnection,
    sql: &str,
    database: Option<&str>,
    start: Instant,
) -> Result<QueryExecutionResult, PyroError> {
    if let Some(database) = non_blank(database) {
        use_database(conn, database, |error| {
            PyroError::Database(format!(
                "Error cambiando a base de datos '{database}': {error}"
            ))
        })
        .await?;
    }
    if crate::db::safe_mode::returns_result_set(sql) {
        let stream = sqlx::raw_sql(sql).fetch_many(&mut *conn);
        let mut decoder = MySqlRowDecoder::new();
        collect_first_result_set::<MySql>(stream, move |row| decoder.decode_row(row), start).await
    } else {
        execute_statement(conn, sql, start).await
    }
}

async fn run_script_on_conn(
    conn: &mut MySqlConnection,
    statements: &[String],
    database: Option<&str>,
    stop_on_error: bool,
    start: Instant,
) -> Result<ScriptExecutionResult, PyroError> {
    if let Some(database) = non_blank(database) {
        use_database(conn, database, |error| {
            PyroError::Database(format!(
                "Error cambiando a base de datos '{database}': {error}"
            ))
        })
        .await?;
    }

    let mut results = Vec::with_capacity(statements.len());
    let mut failed_idx = None;
    let mut overall_error = None;

    for (idx, sql) in statements.iter().enumerate() {
        let stmt_start = Instant::now();
        let res = if crate::db::safe_mode::returns_result_set(sql) {
            let stream = sqlx::raw_sql(sql.as_str()).fetch_many(&mut *conn);
            let mut decoder = MySqlRowDecoder::new();
            collect_all_result_sets::<MySql>(stream, move |row| decoder.decode_row(row), stmt_start)
                .await
        } else {
            execute_statement(conn, sql, stmt_start)
                .await
                .map(|r| vec![r])
        };

        match res {
            Ok(query_results) => {
                if query_results.is_empty() {
                    results.push(ScriptStatementResult {
                        statement_index: idx,
                        sql: sql.clone(),
                        columns: vec![],
                        rows: vec![],
                        affected_rows: 0,
                        execution_time_ms: stmt_start.elapsed().as_millis() as u64,
                        message: "Sentencia ejecutada con éxito.".into(),
                        warning: None,
                        is_result_set: false,
                        error: None,
                    });
                } else {
                    for qr in query_results {
                        results.push(ScriptStatementResult::from_query_result(
                            idx,
                            sql.clone(),
                            qr,
                        ));
                    }
                }
            }
            Err(err) => {
                let err_msg = err.to_string();
                let is_result = crate::db::safe_mode::returns_result_set(sql);
                results.push(ScriptStatementResult {
                    statement_index: idx,
                    sql: sql.clone(),
                    columns: vec![],
                    rows: vec![],
                    affected_rows: 0,
                    execution_time_ms: stmt_start.elapsed().as_millis() as u64,
                    message: format!("Error: {err_msg}"),
                    warning: None,
                    is_result_set: is_result,
                    error: Some(err_msg.clone()),
                });
                failed_idx = Some(idx);
                overall_error = Some(err_msg);
                if stop_on_error {
                    break;
                }
            }
        }
    }

    let total_time_ms = start.elapsed().as_millis() as u64;
    let success = overall_error.is_none();
    Ok(ScriptExecutionResult {
        statements: results,
        total_time_ms,
        success,
        error: overall_error,
        failed_statement_index: failed_idx,
    })
}

async fn execute_statement(
    conn: &mut MySqlConnection,
    sql: &str,
    start: Instant,
) -> Result<QueryExecutionResult, PyroError> {
    let affected = match sqlx::query(sql).execute(&mut *conn).await {
        Ok(result) => result.rows_affected(),
        Err(error) if requires_text_protocol(sql, &error) => conn
            .execute(sql)
            .await
            .map_err(|raw_error| PyroError::Database(format!("Error de ejecución: {raw_error}")))?
            .rows_affected(),
        Err(error) => return Err(PyroError::Database(format!("Error de ejecución: {error}"))),
    };

    Ok(statement_result(affected, start))
}

/// Statements the binary (prepared) protocol rejects — server error 1295,
/// `ER_UNSUPPORTED_PS` — or that must affect the session, such as `USE`/`SET`.
fn requires_text_protocol(sql: &str, error: &sqlx::Error) -> bool {
    let upper = sql.trim().to_uppercase();
    error.to_string().contains("1295") || upper.starts_with("USE") || upper.starts_with("SET")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn background_concurrency_defaults_and_custom_limits() {
        let sem = Arc::new(tokio::sync::Semaphore::new(
            DEFAULT_MAX_BACKGROUND_CONCURRENCY,
        ));
        assert_eq!(sem.available_permits(), 2);

        let custom_sem = Arc::new(tokio::sync::Semaphore::new(4));
        assert_eq!(custom_sem.available_permits(), 4);
    }
}
