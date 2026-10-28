use futures_util::future::BoxFuture;
use futures_util::FutureExt;
use sqlx::{Executor, MySqlPool, Row};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;

use super::error::PyroError;
use super::models::{
    CellUpdateRequest, DeleteRowRequest, PrimaryKeyCondition, QueryExecutionResult,
};
use super::query::{
    bind_json_value, json_value_to_sql_literal, row_to_json, DEFAULT_MAX_INTERACTIVE_ROWS,
};
use super::sql_utils::{qualify_table, quote_identifier};
use super::tunnel::TunnelClient;

/// Unified abstraction for executing database operations.
/// Shields higher-level services from transport mechanisms (Direct TCP pool vs HTTP tunnel).
pub trait DatabaseBackend: Send + Sync {
    fn execute_query<'a>(
        &'a self,
        sql: &'a str,
        database: Option<&'a str>,
    ) -> BoxFuture<'a, Result<QueryExecutionResult, PyroError>>;

    fn execute_query_cancellable<'a>(
        &'a self,
        sql: &'a str,
        database: Option<&'a str>,
        _query_id: Option<&'a str>,
    ) -> BoxFuture<'a, Result<QueryExecutionResult, PyroError>> {
        self.execute_query(sql, database)
    }

    fn execute_batch<'a>(
        &'a self,
        queries: &'a [&'a str],
        database: Option<&'a str>,
    ) -> BoxFuture<'a, Result<Vec<QueryExecutionResult>, PyroError>> {
        async move {
            let mut results = Vec::with_capacity(queries.len());
            for sql in queries {
                results.push(self.execute_query(sql, database).await?);
            }
            Ok(results)
        }
        .boxed()
    }

    fn cancel_query<'a>(&'a self, _query_id: &'a str) -> BoxFuture<'a, Result<bool, PyroError>> {
        async move { Ok(false) }.boxed()
    }

    fn update_cell<'a>(
        &'a self,
        req: &'a CellUpdateRequest,
    ) -> BoxFuture<'a, Result<(), PyroError>>;

    fn delete_row<'a>(&'a self, req: &'a DeleteRowRequest) -> BoxFuture<'a, Result<(), PyroError>>;

    fn execute_transaction<'a>(
        &'a self,
        statements: &'a [String],
        database: Option<&'a str>,
    ) -> BoxFuture<'a, Result<usize, PyroError>>;

    fn close<'a>(&'a self) -> BoxFuture<'a, ()>;
}

/// Direct TCP connection pool backend powered by SQLx.
#[derive(Clone)]
pub struct DirectBackend {
    pool: MySqlPool,
    active_queries: Arc<Mutex<HashMap<String, u64>>>,
}

impl DirectBackend {
    pub fn new(pool: MySqlPool) -> Self {
        Self {
            pool,
            active_queries: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn pool(&self) -> &MySqlPool {
        &self.pool
    }

    pub async fn cancel_active_query(&self, query_id: &str) -> Result<bool, PyroError> {
        let cid = self.active_queries.lock().await.remove(query_id);
        if let Some(cid) = cid {
            let mut kill_conn = self.pool.acquire().await.map_err(|e| {
                PyroError::Connection(format!(
                    "Error obteniendo conexión para cancelar consulta: {e}"
                ))
            })?;
            let kill_sql = format!("KILL QUERY {cid}");
            let _ = sqlx::query(&kill_sql).execute(&mut *kill_conn).await;
            return Ok(true);
        }
        Ok(false)
    }

    async fn execute_query_internal(
        &self,
        conn: &mut sqlx::pool::PoolConnection<sqlx::MySql>,
        sql: &str,
        database: Option<&str>,
        start: Instant,
    ) -> Result<QueryExecutionResult, PyroError> {
        if let Some(db) = database {
            let db_trim = db.trim();
            if !db_trim.is_empty() {
                let quoted_db = quote_identifier(db_trim)?;
                let use_sql = format!("USE {quoted_db}");
                (&mut **conn).execute(use_sql.as_str()).await.map_err(|e| {
                    PyroError::Database(format!("Error cambiando a base de datos '{db_trim}': {e}"))
                })?;
            }
        }

        if crate::db::safe_mode::returns_result_set(sql) {
            use futures_util::StreamExt;
            use sqlx::Column;
            let mut stream = sqlx::query(sql).fetch(&mut **conn);

            let mut rows = Vec::new();
            let mut columns = Vec::new();
            let mut truncated = false;

            while let Some(row_result) = stream.next().await {
                let row = row_result
                    .map_err(|e| PyroError::Database(format!("Error en consulta SQL: {e}")))?;
                if columns.is_empty() {
                    columns = row.columns().iter().map(|c| c.name().to_string()).collect();
                }
                if rows.len() < DEFAULT_MAX_INTERACTIVE_ROWS {
                    rows.push(row_to_json(&row));
                } else {
                    truncated = true;
                    break;
                }
            }

            let elapsed = start.elapsed().as_millis() as u64;
            let count = rows.len() as u64;

            let message = if truncated {
                format!(
                    "{count} fila(s) retornada(s) en {elapsed} ms (Límite interactivo de {DEFAULT_MAX_INTERACTIVE_ROWS} filas alcanzado para proteger la memoria)"
                )
            } else {
                format!("{count} fila(s) retornada(s) en {elapsed} ms")
            };

            Ok(QueryExecutionResult {
                columns,
                rows,
                affected_rows: count,
                execution_time_ms: elapsed,
                message,
            })
        } else {
            let upper = sql.trim().to_uppercase();
            let affected = match sqlx::query(sql).execute(&mut **conn).await {
                Ok(result) => result.rows_affected(),
                Err(e) => {
                    if e.to_string().contains("1295")
                        || upper.starts_with("USE")
                        || upper.starts_with("SET")
                    {
                        let raw_result = (&mut **conn).execute(sql).await.map_err(|raw_err| {
                            PyroError::Database(format!("Error de ejecución: {raw_err}"))
                        })?;
                        raw_result.rows_affected()
                    } else {
                        return Err(PyroError::Database(format!("Error de ejecución: {e}")));
                    }
                }
            };

            let elapsed = start.elapsed().as_millis() as u64;

            Ok(QueryExecutionResult {
                columns: vec![],
                rows: vec![],
                affected_rows: affected,
                execution_time_ms: elapsed,
                message: format!(
                    "Sentencia ejecutada con éxito. {affected} fila(s) afectada(s) en {elapsed} ms"
                ),
            })
        }
    }
}

impl DatabaseBackend for DirectBackend {
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
            let mut conn = self.pool.acquire().await.map_err(|e| {
                PyroError::Connection(format!("Error obteniendo conexión del pool: {e}"))
            })?;

            let mut registered_qid: Option<String> = None;
            if let Some(qid) = query_id {
                let row = sqlx::query("SELECT CONNECTION_ID() AS cid")
                    .fetch_one(&mut *conn)
                    .await
                    .ok();
                if let Some(r) = row {
                    let cid: u64 = r.try_get("cid").unwrap_or(0);
                    if cid > 0 {
                        self.active_queries
                            .lock()
                            .await
                            .insert(qid.to_string(), cid);
                        registered_qid = Some(qid.to_string());
                    }
                }
            }

            let result = self
                .execute_query_internal(&mut conn, sql, database, start)
                .await;

            if let Some(qid) = registered_qid {
                self.active_queries.lock().await.remove(&qid);
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
            let mut pk_conditions = req.primary_keys.clone();
            if pk_conditions.is_empty() {
                if let (Some(ref pk_col), Some(ref pk_val)) =
                    (&req.primary_key_column, &req.primary_key_value)
                {
                    if !pk_col.trim().is_empty() {
                        pk_conditions.push(PrimaryKeyCondition {
                            column: pk_col.clone(),
                            value: pk_val.clone(),
                        });
                    }
                }
            }

            if pk_conditions.is_empty() {
                return Err(PyroError::NoPrimaryKey);
            }

            let db_arg = if req.database.trim().is_empty() {
                None
            } else {
                Some(req.database.as_str())
            };

            let table_ref = qualify_table(db_arg, &req.table)?;
            let col_quoted = quote_identifier(&req.column_name)?;

            let mut conn =
                self.pool.acquire().await.map_err(|e| {
                    PyroError::Connection(format!("Error obteniendo conexión: {e}"))
                })?;

            if let Some(db) = db_arg {
                let quoted_db = quote_identifier(db)?;
                let use_sql = format!("USE {quoted_db}");
                (&mut *conn)
                    .execute(use_sql.as_str())
                    .await
                    .map_err(|e| PyroError::Database(e.to_string()))?;
            }

            let mut where_clauses = Vec::new();
            let mut non_null_conditions = Vec::new();
            for cond in &pk_conditions {
                let pk_col_quoted = quote_identifier(&cond.column)?;
                if cond.value.is_null() {
                    where_clauses.push(format!("{pk_col_quoted} IS NULL"));
                } else {
                    where_clauses.push(format!("{pk_col_quoted} = ?"));
                    non_null_conditions.push(&cond.value);
                }
            }
            let where_str = where_clauses.join(" AND ");
            let sql_str =
                format!("UPDATE {table_ref} SET {col_quoted} = ? WHERE {where_str} LIMIT 1");

            let mut query = sqlx::query(&sql_str);
            query = bind_json_value(query, &req.new_value);
            for val in non_null_conditions {
                query = bind_json_value(query, val);
            }

            query
                .execute(&mut *conn)
                .await
                .map_err(|e| PyroError::Database(format!("Error actualizando celda: {e}")))?;

            Ok(())
        }
        .boxed()
    }

    fn delete_row<'a>(&'a self, req: &'a DeleteRowRequest) -> BoxFuture<'a, Result<(), PyroError>> {
        async move {
            if req.primary_keys.is_empty() {
                return Err(PyroError::NoPrimaryKey);
            }

            let db_arg = if req.database.trim().is_empty() {
                None
            } else {
                Some(req.database.as_str())
            };

            let table_ref = qualify_table(db_arg, &req.table)?;

            let mut conn =
                self.pool.acquire().await.map_err(|e| {
                    PyroError::Connection(format!("Error obteniendo conexión: {e}"))
                })?;

            if let Some(db) = db_arg {
                let quoted_db = quote_identifier(db)?;
                let use_sql = format!("USE {quoted_db}");
                (&mut *conn)
                    .execute(use_sql.as_str())
                    .await
                    .map_err(|e| PyroError::Database(e.to_string()))?;
            }

            let mut where_clauses = Vec::new();
            let mut non_null_conditions = Vec::new();
            for cond in &req.primary_keys {
                let pk_col_quoted = quote_identifier(&cond.column)?;
                if cond.value.is_null() {
                    where_clauses.push(format!("{pk_col_quoted} IS NULL"));
                } else {
                    where_clauses.push(format!("{pk_col_quoted} = ?"));
                    non_null_conditions.push(&cond.value);
                }
            }
            let where_str = where_clauses.join(" AND ");
            let sql_str = format!("DELETE FROM {table_ref} WHERE {where_str} LIMIT 1");

            let mut query = sqlx::query(&sql_str);
            for val in non_null_conditions {
                query = bind_json_value(query, val);
            }

            query
                .execute(&mut *conn)
                .await
                .map_err(|e| PyroError::Database(format!("Error eliminando fila: {e}")))?;

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

            let mut conn = self.pool.acquire().await.map_err(|e| {
                PyroError::Connection(format!("Error obteniendo conexión para transacción: {e}"))
            })?;

            if let Some(db) = database {
                let db_trim = db.trim();
                if !db_trim.is_empty() {
                    let quoted_db = quote_identifier(db_trim)?;
                    let use_sql = format!("USE {quoted_db}");
                    (&mut *conn).execute(use_sql.as_str()).await.map_err(|e| {
                        PyroError::Database(format!("Error seleccionando base de datos '{db_trim}': {e}"))
                    })?;
                }
            }

            // Iniciar transacción de forma explícita en la misma conexión
            (&mut *conn)
                .execute("START TRANSACTION")
                .await
                .map_err(|e| PyroError::Database(format!("Error iniciando transacción: {e}")))?;

            let mut executed_count = 0;
            for stmt in statements {
                let trimmed = stmt.trim().trim_end_matches(';');
                if trimmed.is_empty() {
                    continue;
                }
                if let Err(e) = (&mut *conn).execute(trimmed).await {
                    let _ = (&mut *conn).execute("ROLLBACK").await;
                    return Err(PyroError::Database(format!(
                        "Error ejecutando sentencia en transacción: {e}. Transacción revertida (ROLLBACK)."
                    )));
                }
                executed_count += 1;
            }

            // Confirmar transacción
            (&mut *conn)
                .execute("COMMIT")
                .await
                .map_err(|e| PyroError::Database(format!("Error confirmando transacción (COMMIT): {e}")))?;

            Ok(executed_count)
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

/// HTTP Tunnel backend communicating through PHP `pyro_tunnel.php` (PyroTunnel v1).
#[derive(Clone)]
pub struct TunnelBackend {
    client: TunnelClient,
}

impl TunnelBackend {
    pub fn new(client: TunnelClient) -> Self {
        Self { client }
    }

    pub fn client(&self) -> &TunnelClient {
        &self.client
    }
}

impl DatabaseBackend for TunnelBackend {
    fn execute_query<'a>(
        &'a self,
        sql: &'a str,
        database: Option<&'a str>,
    ) -> BoxFuture<'a, Result<QueryExecutionResult, PyroError>> {
        async move { self.client.execute_query(sql, database).await }.boxed()
    }

    fn execute_query_cancellable<'a>(
        &'a self,
        sql: &'a str,
        database: Option<&'a str>,
        query_id: Option<&'a str>,
    ) -> BoxFuture<'a, Result<QueryExecutionResult, PyroError>> {
        async move {
            self.client
                .execute_query_cancellable(sql, database, query_id)
                .await
        }
        .boxed()
    }

    fn execute_batch<'a>(
        &'a self,
        queries: &'a [&'a str],
        database: Option<&'a str>,
    ) -> BoxFuture<'a, Result<Vec<QueryExecutionResult>, PyroError>> {
        async move { self.client.execute_queries(queries, database).await }.boxed()
    }

    fn cancel_query<'a>(&'a self, query_id: &'a str) -> BoxFuture<'a, Result<bool, PyroError>> {
        async move { self.client.cancel_query(query_id).await }.boxed()
    }

    fn update_cell<'a>(
        &'a self,
        req: &'a CellUpdateRequest,
    ) -> BoxFuture<'a, Result<(), PyroError>> {
        async move {
            let mut pk_conditions = req.primary_keys.clone();
            if pk_conditions.is_empty() {
                if let (Some(ref pk_col), Some(ref pk_val)) =
                    (&req.primary_key_column, &req.primary_key_value)
                {
                    if !pk_col.trim().is_empty() {
                        pk_conditions.push(PrimaryKeyCondition {
                            column: pk_col.clone(),
                            value: pk_val.clone(),
                        });
                    }
                }
            }

            if pk_conditions.is_empty() {
                return Err(PyroError::NoPrimaryKey);
            }

            let db_arg = if req.database.trim().is_empty() {
                None
            } else {
                Some(req.database.as_str())
            };

            let table_ref = qualify_table(db_arg, &req.table)?;
            let col_quoted = quote_identifier(&req.column_name)?;
            let val_sql = json_value_to_sql_literal(&req.new_value);

            let mut where_clauses = Vec::new();
            for cond in &pk_conditions {
                let pk_col_quoted = quote_identifier(&cond.column)?;
                if cond.value.is_null() {
                    where_clauses.push(format!("{pk_col_quoted} IS NULL"));
                } else {
                    let pk_val_sql = json_value_to_sql_literal(&cond.value);
                    where_clauses.push(format!("{pk_col_quoted} = {pk_val_sql}"));
                }
            }
            let where_str = where_clauses.join(" AND ");
            let sql_str = format!(
                "UPDATE {table_ref} SET {col_quoted} = {val_sql} WHERE {where_str} LIMIT 1"
            );

            self.client.execute_query(&sql_str, db_arg).await?;
            Ok(())
        }
        .boxed()
    }

    fn delete_row<'a>(&'a self, req: &'a DeleteRowRequest) -> BoxFuture<'a, Result<(), PyroError>> {
        async move {
            if req.primary_keys.is_empty() {
                return Err(PyroError::NoPrimaryKey);
            }

            let db_arg = if req.database.trim().is_empty() {
                None
            } else {
                Some(req.database.as_str())
            };

            let table_ref = qualify_table(db_arg, &req.table)?;

            let mut where_clauses = Vec::new();
            for cond in &req.primary_keys {
                let pk_col_quoted = quote_identifier(&cond.column)?;
                if cond.value.is_null() {
                    where_clauses.push(format!("{pk_col_quoted} IS NULL"));
                } else {
                    let pk_val_sql = json_value_to_sql_literal(&cond.value);
                    where_clauses.push(format!("{pk_col_quoted} = {pk_val_sql}"));
                }
            }
            let where_str = where_clauses.join(" AND ");
            let sql_str = format!("DELETE FROM {table_ref} WHERE {where_str} LIMIT 1");

            self.client.execute_query(&sql_str, db_arg).await?;
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

            let mut queries: Vec<&str> = Vec::with_capacity(statements.len() + 2);
            queries.push("START TRANSACTION");
            for stmt in statements {
                let trimmed = stmt.trim().trim_end_matches(';');
                if !trimmed.is_empty() {
                    queries.push(trimmed);
                }
            }
            queries.push("COMMIT");

            let res = self.client.execute_queries(&queries, database).await;
            match res {
                Ok(_) => Ok(statements.len()),
                Err(e) => {
                    let _ = self.client.execute_query("ROLLBACK", database).await;
                    Err(PyroError::Database(format!(
                        "Error en transacción vía túnel: {e}. Transacción revertida (ROLLBACK)."
                    )))
                }
            }
        }
        .boxed()
    }

    fn close<'a>(&'a self) -> BoxFuture<'a, ()> {
        async move {}.boxed()
    }
}
