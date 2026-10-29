use futures_util::future::BoxFuture;
use futures_util::FutureExt;
use sqlx::pool::PoolConnection;
use sqlx::sqlite::SqliteConnection;
use sqlx::{Executor, Sqlite, SqlitePool};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;

use super::row::{bind_sql_params, export_row, row_to_json};
use crate::db::backend::{
    BackendTransaction, DatabaseBackend, EngineError, RowStream, TableTransactionality,
};
use crate::db::dialect::{Dialect, SQLITE_DIALECT};
use crate::db::engine::DbEngine;
use crate::db::error::PyroError;
use crate::db::models::{CellUpdateRequest, DeleteRowRequest, QueryExecutionResult};
use crate::db::param_query::ParamQuery;
use crate::db::row_filter::{cell_update_query, row_delete_query};
use crate::db::sqlx_support::{
    collect_first_result_set, run_in_transaction, spawn_row_stream, statement_result,
};

/// Virtual machine steps between checks of the cancellation flag.
const INTERRUPT_CHECK_STEPS: i32 = 1_000;

/// Local SQLite database file opened through SQLx (bundled SQLite).
#[derive(Clone)]
pub struct SqliteBackend {
    pool: SqlitePool,
    file_path: String,
    /// Query id -> flag that interrupts it when set.
    interrupt_flags: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl SqliteBackend {
    pub fn new(pool: SqlitePool, file_path: String) -> Self {
        Self {
            pool,
            file_path,
            interrupt_flags: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn file_path(&self) -> &str {
        &self.file_path
    }

    async fn acquire(&self) -> Result<PoolConnection<Sqlite>, PyroError> {
        self.pool.acquire().await.map_err(|error| {
            PyroError::Connection(format!("Error obteniendo la conexión SQLite: {error}"))
        })
    }

    /// Installs a progress handler that aborts the running statement (the
    /// equivalent of `sqlite3_interrupt`) once `cancel_query(query_id)` runs.
    async fn arm_interrupt(
        &self,
        conn: &mut SqliteConnection,
        query_id: &str,
    ) -> Result<(), PyroError> {
        let flag = Arc::new(AtomicBool::new(false));
        let keep_running = Arc::clone(&flag);
        conn.lock_handle()
            .await
            .map_err(|error| PyroError::Database(error.to_string()))?
            .set_progress_handler(INTERRUPT_CHECK_STEPS, move || {
                !keep_running.load(Ordering::Relaxed)
            });
        self.interrupt_flags
            .lock()
            .await
            .insert(query_id.to_string(), flag);
        Ok(())
    }

    async fn disarm_interrupt(&self, conn: &mut SqliteConnection, query_id: &str) {
        self.interrupt_flags.lock().await.remove(query_id);
        if let Ok(mut handle) = conn.lock_handle().await {
            handle.remove_progress_handler();
        }
    }
}

impl DatabaseBackend for SqliteBackend {
    fn engine(&self) -> DbEngine {
        DbEngine::Sqlite
    }

    fn execute_query<'a>(
        &'a self,
        sql: &'a str,
        database: Option<&'a str>,
    ) -> BoxFuture<'a, Result<QueryExecutionResult, PyroError>> {
        self.execute_query_cancellable(sql, database, None)
    }

    /// Schemas (`main`, attached files) are addressed by qualified names, so
    /// `database` needs no `USE`.
    fn execute_query_cancellable<'a>(
        &'a self,
        sql: &'a str,
        _database: Option<&'a str>,
        query_id: Option<&'a str>,
    ) -> BoxFuture<'a, Result<QueryExecutionResult, PyroError>> {
        async move {
            let start = Instant::now();
            let mut conn = self.acquire().await?;
            if let Some(query_id) = query_id {
                self.arm_interrupt(&mut conn, query_id).await?;
            }
            let result = run_query(&mut conn, sql, start).await;
            if let Some(query_id) = query_id {
                self.disarm_interrupt(&mut conn, query_id).await;
            }
            result
        }
        .boxed()
    }

    fn cancel_query<'a>(&'a self, query_id: &'a str) -> BoxFuture<'a, Result<bool, PyroError>> {
        async move {
            let flag = self.interrupt_flags.lock().await.get(query_id).cloned();
            Ok(flag
                .map(|flag| flag.store(true, Ordering::Relaxed))
                .is_some())
        }
        .boxed()
    }

    fn update_cell<'a>(
        &'a self,
        req: &'a CellUpdateRequest,
    ) -> BoxFuture<'a, Result<(), PyroError>> {
        async move {
            let query = cell_update_query(&SQLITE_DIALECT, req)?;
            self.execute_params(&query).await.map_err(|error| {
                PyroError::Database(format!("Error actualizando celda: {error}"))
            })?;
            Ok(())
        }
        .boxed()
    }

    fn delete_row<'a>(&'a self, req: &'a DeleteRowRequest) -> BoxFuture<'a, Result<(), PyroError>> {
        async move {
            let query = row_delete_query(&SQLITE_DIALECT, req)?;
            self.execute_params(&query)
                .await
                .map_err(|error| PyroError::Database(format!("Error eliminando fila: {error}")))?;
            Ok(())
        }
        .boxed()
    }

    fn execute_transaction<'a>(
        &'a self,
        statements: &'a [String],
        _database: Option<&'a str>,
    ) -> BoxFuture<'a, Result<usize, PyroError>> {
        async move {
            if statements.is_empty() {
                return Ok(0);
            }
            let mut conn = self.acquire().await?;
            run_in_transaction::<Sqlite>(&mut conn, "BEGIN", statements).await
        }
        .boxed()
    }

    fn stream_rows<'a>(
        &'a self,
        sql: &'a str,
        _database: Option<&'a str>,
    ) -> BoxFuture<'a, Result<RowStream, EngineError>> {
        async move {
            let conn = self.pool.acquire().await.map_err(|error| {
                EngineError::from(error).with_context("Error adquiriendo conexión para exportación")
            })?;
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
            Ok(Box::new(SqliteTransaction(transaction)) as Box<dyn BackendTransaction>)
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

    /// Every SQLite table supports rollback; only its existence is checked.
    fn table_transactionality<'a>(
        &'a self,
        database: &'a str,
        table: &'a str,
    ) -> BoxFuture<'a, Result<TableTransactionality, EngineError>> {
        async move {
            let schema = if database.trim().is_empty() {
                "main"
            } else {
                database
            };
            let catalog = SQLITE_DIALECT.qualify_table(Some(schema), "sqlite_master")?;
            let sql = format!("SELECT count(*) FROM {catalog} WHERE type = 'table' AND name = ?");
            let count: i64 = sqlx::query_scalar(&sql)
                .bind(table)
                .fetch_one(&self.pool)
                .await?;
            Ok(if count > 0 {
                TableTransactionality::Transactional
            } else {
                TableTransactionality::NotFound
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

struct SqliteTransaction(sqlx::Transaction<'static, Sqlite>);

impl BackendTransaction for SqliteTransaction {
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

async fn run_query(
    conn: &mut SqliteConnection,
    sql: &str,
    start: Instant,
) -> Result<QueryExecutionResult, PyroError> {
    if crate::db::safe_mode::returns_result_set(sql) {
        let stream = conn.fetch_many(sql);
        return collect_first_result_set::<Sqlite>(stream, row_to_json, start).await;
    }
    // Scripts run statement by statement and stop at the first error, like
    // the `sqlite3` shell with `.bail on`.
    let result = conn
        .execute(sql)
        .await
        .map_err(|error| PyroError::Database(format!("Error de ejecución: {error}")))?;
    Ok(statement_result(result.rows_affected(), start))
}
