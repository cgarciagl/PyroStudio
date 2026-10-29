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
use super::row::{bind_json_value, bind_sql_params, row_to_json};
use crate::db::backend::{
    BackendTransaction, DatabaseBackend, EngineError, RowStream, TableTransactionality,
};
use crate::db::dialect::MYSQL_DIALECT;
use crate::db::engine::DbEngine;
use crate::db::error::PyroError;
use crate::db::models::{CellUpdateRequest, DeleteRowRequest, QueryExecutionResult};
use crate::db::param_query::ParamQuery;
use crate::db::row_filter::{
    bound_row_filter, delete_row_conditions, target_database, update_row_conditions,
};
use crate::db::sql_utils::{qualify_table, quote_identifier};
use crate::db::sqlx_support::{
    collect_first_result_set, run_in_transaction, spawn_row_stream, statement_result,
};

/// MariaDB/MySQL backend over a direct (TCP or SSH-forwarded) SQLx pool.
#[derive(Clone)]
pub struct DirectBackend {
    pool: MySqlPool,
    /// Query id -> server `CONNECTION_ID()` running it, for `KILL QUERY`.
    active_queries: Arc<Mutex<HashMap<String, u64>>>,
}

impl DirectBackend {
    pub fn new(pool: MySqlPool) -> Self {
        Self {
            pool,
            active_queries: Arc::new(Mutex::new(HashMap::new())),
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
            Ok(spawn_row_stream(conn, sql.to_string(), export_row))
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

    fn close<'a>(&'a self) -> BoxFuture<'a, ()> {
        async move {
            self.pool.close().await;
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
        collect_first_result_set::<MySql>(stream, row_to_json, start).await
    } else {
        execute_statement(conn, sql, start).await
    }
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
