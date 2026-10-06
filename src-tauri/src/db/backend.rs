use futures_util::future::BoxFuture;
use futures_util::FutureExt;
use sqlx::{Executor, MySqlPool, Row};
use std::time::Instant;

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

    fn update_cell<'a>(
        &'a self,
        req: &'a CellUpdateRequest,
    ) -> BoxFuture<'a, Result<(), PyroError>>;

    fn delete_row<'a>(&'a self, req: &'a DeleteRowRequest) -> BoxFuture<'a, Result<(), PyroError>>;

    fn close<'a>(&'a self) -> BoxFuture<'a, ()>;
}

/// Direct TCP connection pool backend powered by SQLx.
#[derive(Clone)]
pub struct DirectBackend {
    pool: MySqlPool,
}

impl DirectBackend {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &MySqlPool {
        &self.pool
    }
}

impl DatabaseBackend for DirectBackend {
    fn execute_query<'a>(
        &'a self,
        sql: &'a str,
        database: Option<&'a str>,
    ) -> BoxFuture<'a, Result<QueryExecutionResult, PyroError>> {
        async move {
            let start = Instant::now();
            let mut conn = self.pool.acquire().await.map_err(|e| {
                PyroError::Connection(format!("Error obteniendo conexión del pool: {e}"))
            })?;

            if let Some(db) = database {
                let db_trim = db.trim();
                if !db_trim.is_empty() {
                    let quoted_db = quote_identifier(db_trim)?;
                    let use_sql = format!("USE {quoted_db}");
                    (&mut *conn)
                        .execute(use_sql.as_str())
                        .await
                        .map_err(|e| {
                            PyroError::Database(format!(
                                "Error cambiando a base de datos '{db_trim}': {e}"
                            ))
                        })?;
                }
            }

            let trimmed = sql.trim();
            let upper = trimmed.to_uppercase();
            if upper.starts_with("SELECT")
                || upper.starts_with("SHOW")
                || upper.starts_with("DESCRIBE")
                || upper.starts_with("EXPLAIN")
            {
                use futures_util::StreamExt;
                use sqlx::Column;
                let mut stream = sqlx::query(sql).fetch(&mut *conn);

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
                let affected = match sqlx::query(sql).execute(&mut *conn).await {
                    Ok(result) => result.rows_affected(),
                    Err(e) => {
                        // Fallback to text protocol if prepared statement protocol is not supported (e.g. error 1295)
                        if e.to_string().contains("1295") || upper.starts_with("USE") || upper.starts_with("SET") {
                            let raw_result = (&mut *conn)
                                .execute(sql)
                                .await
                                .map_err(|raw_err| PyroError::Database(format!("Error de ejecución: {raw_err}")))?;
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
        .boxed()
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
            for cond in &pk_conditions {
                let pk_col_quoted = quote_identifier(&cond.column)?;
                where_clauses.push(format!("{pk_col_quoted} = ?"));
            }
            let where_str = where_clauses.join(" AND ");
            let sql_str = format!("UPDATE {table_ref} SET {col_quoted} = ? WHERE {where_str}");

            let mut query = sqlx::query(&sql_str);
            query = bind_json_value(query, &req.new_value);
            for cond in &pk_conditions {
                query = bind_json_value(query, &cond.value);
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
            for cond in &req.primary_keys {
                let pk_col_quoted = quote_identifier(&cond.column)?;
                where_clauses.push(format!("{pk_col_quoted} = ?"));
            }
            let where_str = where_clauses.join(" AND ");
            let sql_str = format!("DELETE FROM {table_ref} WHERE {where_str}");

            let mut query = sqlx::query(&sql_str);
            for cond in &req.primary_keys {
                query = bind_json_value(query, &cond.value);
            }

            query
                .execute(&mut *conn)
                .await
                .map_err(|e| PyroError::Database(format!("Error eliminando fila: {e}")))?;

            Ok(())
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

/// HTTP Tunnel backend communicating through Navicat-compatible `ntunnel_mysql.php`.
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
                let pk_val_sql = json_value_to_sql_literal(&cond.value);
                where_clauses.push(format!("{pk_col_quoted} = {pk_val_sql}"));
            }
            let where_str = where_clauses.join(" AND ");
            let sql_str =
                format!("UPDATE {table_ref} SET {col_quoted} = {val_sql} WHERE {where_str}");

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
                let pk_val_sql = json_value_to_sql_literal(&cond.value);
                where_clauses.push(format!("{pk_col_quoted} = {pk_val_sql}"));
            }
            let where_str = where_clauses.join(" AND ");
            let sql_str = format!("DELETE FROM {table_ref} WHERE {where_str}");

            self.client.execute_query(&sql_str, db_arg).await?;
            Ok(())
        }
        .boxed()
    }

    fn close<'a>(&'a self) -> BoxFuture<'a, ()> {
        async move {}.boxed()
    }
}
