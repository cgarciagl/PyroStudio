use futures_util::future::BoxFuture;
use futures_util::stream::{self, BoxStream};
use futures_util::{FutureExt, StreamExt};
use std::fmt;

use super::engine::DbEngine;
use super::error::PyroError;
use super::models::{CellUpdateRequest, DeleteRowRequest, QueryExecutionResult};
use super::param_query::ParamQuery;
use super::row_filter::{
    delete_row_conditions, literal_row_filter, target_database, update_row_conditions,
};
use super::tunnel::TunnelClient;

pub use super::mysql::DirectBackend;

/// Unified abstraction for executing database operations.
/// Shields higher-level services from the engine (MariaDB/MySQL, SQLite) and
/// from the transport (Direct TCP pool vs HTTP tunnel).
pub trait DatabaseBackend: Send + Sync {
    /// Engine that runs the statements, which selects the dialect and the
    /// schema introspector.
    fn engine(&self) -> DbEngine;

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

    /// Streams every row of `sql` without the interactive row limit (bulk export).
    /// The default materializes the result first; engines with a native cursor
    /// should override it.
    fn stream_rows<'a>(
        &'a self,
        sql: &'a str,
        database: Option<&'a str>,
    ) -> BoxFuture<'a, Result<RowStream, EngineError>> {
        async move {
            let result = self.execute_query(sql, database).await?;
            Ok(rows_from_result(result))
        }
        .boxed()
    }

    /// Whether the backend supports bound parameters and real transactions
    /// with rollback (`execute_params` and `begin_transaction`).
    fn supports_transactions(&self) -> bool {
        false
    }

    fn begin_transaction(&self) -> BoxFuture<'_, Result<Box<dyn BackendTransaction>, EngineError>> {
        async move { Err(transactions_unsupported()) }.boxed()
    }

    fn execute_params<'a>(
        &'a self,
        _query: &'a ParamQuery,
    ) -> BoxFuture<'a, Result<u64, EngineError>> {
        async move { Err(transactions_unsupported()) }.boxed()
    }

    /// Reports whether writes to `table` can be rolled back.
    fn table_transactionality<'a>(
        &'a self,
        _database: &'a str,
        _table: &'a str,
    ) -> BoxFuture<'a, Result<TableTransactionality, EngineError>> {
        async move { Err(transactions_unsupported()) }.boxed()
    }

    /// Reserves a connection for manual-commit mode. Only engines whose pool
    /// can spare a connection support it.
    fn open_pinned_session(&self) -> BoxFuture<'_, Result<Box<dyn PinnedSession>, PyroError>> {
        async move {
            Err(PyroError::InvalidOperation(
                "El modo de transacción manual no está disponible para esta conexión.".into(),
            ))
        }
        .boxed()
    }

    /// Reserves a dedicated connection running inside a consistent snapshot transaction
    /// (`SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ; START TRANSACTION WITH CONSISTENT SNAPSHOT`).
    /// Used by SQL dump / backup to ensure consistent read views across all dumped tables.
    fn open_snapshot_session(&self) -> BoxFuture<'_, Result<Box<dyn PinnedSession>, PyroError>> {
        async move {
            Err(PyroError::InvalidOperation(
                "El snapshot consistente no está soportado para este tipo de conexión.".into(),
            ))
        }
        .boxed()
    }

    fn close<'a>(&'a self) -> BoxFuture<'a, ()>;
}

/// Connection reserved for one editor tab in manual-commit mode
/// (`autocommit = 0`). Statements run on it in order; `release` rolls back
/// anything uncommitted and restores autocommit before the connection goes
/// back to the pool.
pub trait PinnedSession: Send {
    fn query<'a>(
        &'a mut self,
        sql: &'a str,
        database: Option<&'a str>,
    ) -> BoxFuture<'a, Result<QueryExecutionResult, PyroError>>;

    fn release(self: Box<Self>) -> BoxFuture<'static, ()>;
}

/// Open transaction on a dedicated connection. Dropping it without `commit`
/// rolls it back.
pub trait BackendTransaction: Send {
    fn execute<'a>(&'a mut self, query: &'a ParamQuery) -> BoxFuture<'a, Result<u64, EngineError>>;

    fn commit(self: Box<Self>) -> BoxFuture<'static, Result<(), EngineError>>;

    fn rollback(self: Box<Self>) -> BoxFuture<'static, Result<(), EngineError>>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TableTransactionality {
    Transactional,
    NonTransactional,
    NotFound,
}

/// Error reported by the engine or its driver. `message` is the text shown to
/// users; `code` and `server_message` keep the engine diagnostics so callers
/// can point at the offending column without parsing `message`.
#[derive(Debug, Clone, PartialEq)]
pub struct EngineError {
    pub message: String,
    pub code: Option<String>,
    pub server_message: Option<String>,
}

impl EngineError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            code: None,
            server_message: None,
        }
    }

    /// Prefixes the message as `"{context}: {message}"`, keeping diagnostics.
    pub fn with_context(mut self, context: &str) -> Self {
        self.message = format!("{context}: {}", self.message);
        self
    }
}

impl From<sqlx::Error> for EngineError {
    fn from(error: sqlx::Error) -> Self {
        let database_error = error.as_database_error();
        Self {
            code: database_error
                .and_then(|database_error| database_error.code())
                .map(|code| code.into_owned()),
            server_message: database_error
                .map(|database_error| database_error.message().to_string()),
            message: error.to_string(),
        }
    }
}

impl fmt::Display for EngineError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl From<PyroError> for EngineError {
    fn from(error: PyroError) -> Self {
        Self::new(error.to_string())
    }
}

fn transactions_unsupported() -> EngineError {
    EngineError::new("La conexión actual no admite transacciones ni parámetros enlazados.")
}

/// Cell already converted to the representation a spreadsheet needs.
#[derive(Debug, Clone, PartialEq)]
pub enum ExportCell {
    Blank,
    Bool(bool),
    Number(f64),
    /// `autosize` marks text that should widen its column.
    Text {
        value: String,
        autosize: bool,
    },
}

impl ExportCell {
    /// Largest integer magnitude a spreadsheet stores without losing precision
    /// (15 significant digits); bigger values are exported as text.
    pub const EXACT_INTEGER_LIMIT: u64 = 999_999_999_999_999;

    pub fn integer(value: i64) -> Self {
        if value.unsigned_abs() <= Self::EXACT_INTEGER_LIMIT {
            Self::Number(value as f64)
        } else {
            Self::unsized_text(value.to_string())
        }
    }

    pub fn unsigned(value: u64) -> Self {
        if value <= Self::EXACT_INTEGER_LIMIT {
            Self::Number(value as f64)
        } else {
            Self::unsized_text(value.to_string())
        }
    }

    pub fn unsized_text(value: String) -> Self {
        Self::Text {
            value,
            autosize: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum RowStreamItem {
    /// Column names, sent once before the first row.
    Columns(Vec<String>),
    Row(Vec<ExportCell>),
}

pub type RowStream = BoxStream<'static, Result<RowStreamItem, EngineError>>;

/// Adapts an already materialized result to a row stream. Columns are always
/// announced, even when there are no rows.
pub fn rows_from_result(result: QueryExecutionResult) -> RowStream {
    let columns = RowStreamItem::Columns(result.columns);
    let rows = result
        .rows
        .into_iter()
        .map(|row| RowStreamItem::Row(row.iter().map(json_export_cell).collect()));
    stream::iter(std::iter::once(columns).chain(rows).map(Ok)).boxed()
}

fn json_export_cell(value: &serde_json::Value) -> ExportCell {
    match value {
        serde_json::Value::Null => ExportCell::Blank,
        serde_json::Value::Bool(flag) => ExportCell::Bool(*flag),
        serde_json::Value::Number(number) => match number.as_i64() {
            Some(integer) => ExportCell::Number(integer as f64),
            None => number
                .as_f64()
                .map(ExportCell::Number)
                .unwrap_or_else(|| ExportCell::Text {
                    value: number.to_string(),
                    autosize: false,
                }),
        },
        serde_json::Value::String(text) => ExportCell::Text {
            value: text.clone(),
            autosize: true,
        },
        other => ExportCell::Text {
            value: other.to_string(),
            autosize: false,
        },
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
    fn engine(&self) -> DbEngine {
        self.client.config.engine
    }

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
            let dialect = self.engine().dialect();
            let conditions = update_row_conditions(req)?;
            let database = target_database(&req.database);
            let table_ref = dialect.qualify_table(database, &req.table)?;
            let column = dialect.quote_identifier(&req.column_name)?;
            let value = dialect.value_literal(&req.new_value);
            let filter = literal_row_filter(dialect, &conditions)?;
            let limit = dialect.single_row_limit();
            let sql = format!("UPDATE {table_ref} SET {column} = {value} WHERE {filter}{limit}");

            self.client.execute_query(&sql, database).await?;
            Ok(())
        }
        .boxed()
    }

    fn delete_row<'a>(&'a self, req: &'a DeleteRowRequest) -> BoxFuture<'a, Result<(), PyroError>> {
        async move {
            let dialect = self.engine().dialect();
            let conditions = delete_row_conditions(req)?;
            let database = target_database(&req.database);
            let table_ref = dialect.qualify_table(database, &req.table)?;
            let filter = literal_row_filter(dialect, &conditions)?;
            let limit = dialect.single_row_limit();
            let sql = format!("DELETE FROM {table_ref} WHERE {filter}{limit}");

            self.client.execute_query(&sql, database).await?;
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
            queries.push(self.engine().dialect().begin_transaction());
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

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::StreamExt;
    use serde_json::json;

    fn result(columns: &[&str], rows: Vec<Vec<serde_json::Value>>) -> QueryExecutionResult {
        QueryExecutionResult {
            columns: columns.iter().map(|c| c.to_string()).collect(),
            rows,
            affected_rows: 0,
            execution_time_ms: 0,
            message: String::new(),
            warning: None,
        }
    }

    #[tokio::test]
    async fn materialized_rows_announce_columns_even_without_rows() {
        let items: Vec<_> = rows_from_result(result(&["id"], Vec::new()))
            .collect()
            .await;
        assert_eq!(items, vec![Ok(RowStreamItem::Columns(vec!["id".into()]))]);
    }

    #[tokio::test]
    async fn materialized_rows_convert_json_to_export_cells() {
        let rows = vec![vec![
            serde_json::Value::Null,
            json!(true),
            json!(42),
            json!(2.5),
            json!("texto"),
            json!([1]),
        ]];
        let items: Vec<_> = rows_from_result(result(&["a", "b", "c", "d", "e", "f"], rows))
            .collect()
            .await;
        assert_eq!(
            items[1],
            Ok(RowStreamItem::Row(vec![
                ExportCell::Blank,
                ExportCell::Bool(true),
                ExportCell::Number(42.0),
                ExportCell::Number(2.5),
                ExportCell::Text {
                    value: "texto".into(),
                    autosize: true
                },
                ExportCell::Text {
                    value: "[1]".into(),
                    autosize: false
                },
            ]))
        );
    }
}
