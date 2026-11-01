//! SQLx helpers shared by the engines that run on a native driver.

use futures_util::{stream, StreamExt};
use serde_json::Value;
use sqlx::pool::PoolConnection;
use sqlx::{Column, Database, Either, Executor, IntoArguments, Row};
use std::time::Instant;
use tokio::sync::mpsc;

use super::backend::{EngineError, ExportCell, RowStream, RowStreamItem};
use super::error::PyroError;
use super::models::QueryExecutionResult;
use super::query::DEFAULT_MAX_INTERACTIVE_ROWS;

/// Rows buffered between the export reader task and its consumer.
const ROW_STREAM_BUFFER: usize = 256;

/// Output of `raw_sql(..).fetch_many(..)`: statement results and rows.
pub type ResultStream<'e, DB> = futures_util::stream::BoxStream<
    'e,
    Result<Either<<DB as Database>::QueryResult, <DB as Database>::Row>, sqlx::Error>,
>;

pub type RowToJson<DB> = fn(&<DB as Database>::Row) -> Vec<Value>;
pub type RowToCells<DB> = fn(&<DB as Database>::Row) -> Result<Vec<ExportCell>, EngineError>;

/// Scripts may hold several statements: only the first result set is shown,
/// and an error in a later statement is reported as a warning instead of
/// discarding the rows already read.
pub async fn collect_first_result_set<DB: Database>(
    mut stream: ResultStream<'_, DB>,
    mut row_to_json: impl FnMut(&<DB as Database>::Row) -> Vec<Value>,
    start: Instant,
) -> Result<QueryExecutionResult, PyroError> {
    let mut rows = Vec::with_capacity(64);
    let mut columns = Vec::new();
    let mut truncated = false;
    let mut first_set_done = false;
    let mut warning = None;

    while let Some(item) = stream.next().await {
        match item {
            Ok(Either::Left(_)) => {
                if !rows.is_empty() {
                    first_set_done = true;
                }
            }
            Ok(Either::Right(_)) if first_set_done => {}
            Ok(Either::Right(row)) => {
                if columns.is_empty() {
                    columns = column_names::<DB>(&row);
                }
                if rows.len() >= DEFAULT_MAX_INTERACTIVE_ROWS {
                    truncated = true;
                    break;
                }
                if rows.len() == rows.capacity() && rows.capacity() < DEFAULT_MAX_INTERACTIVE_ROWS {
                    let next_cap = (rows.capacity() * 2).min(DEFAULT_MAX_INTERACTIVE_ROWS);
                    rows.reserve(next_cap - rows.capacity());
                }
                rows.push(row_to_json(&row));
            }
            Err(error) if first_set_done => {
                warning = Some(format!("Error en una sentencia posterior: {error}"));
                break;
            }
            Err(error) => {
                return Err(PyroError::Database(format!(
                    "Error en consulta SQL: {error}"
                )));
            }
        }
    }

    let elapsed = start.elapsed().as_millis() as u64;
    let count = rows.len() as u64;
    Ok(QueryExecutionResult {
        columns,
        rows,
        affected_rows: count,
        execution_time_ms: elapsed,
        message: result_set_message(count, elapsed, truncated),
        warning,
    })
}

/// Collects every result set from a stream without discarding secondary sets.
pub async fn collect_all_result_sets<DB: Database>(
    mut stream: ResultStream<'_, DB>,
    mut row_to_json: impl FnMut(&<DB as Database>::Row) -> Vec<Value>,
    start: Instant,
) -> Result<Vec<QueryExecutionResult>, PyroError> {
    let mut results = Vec::new();
    let mut rows = Vec::with_capacity(64);
    let mut columns = Vec::new();
    let mut truncated = false;

    while let Some(item) = stream.next().await {
        match item {
            Ok(Either::Left(_)) => {
                if !columns.is_empty() || !rows.is_empty() {
                    let elapsed = start.elapsed().as_millis() as u64;
                    let count = rows.len() as u64;
                    results.push(QueryExecutionResult {
                        columns: std::mem::take(&mut columns),
                        rows: std::mem::take(&mut rows),
                        affected_rows: count,
                        execution_time_ms: elapsed,
                        message: result_set_message(count, elapsed, truncated),
                        warning: None,
                    });
                    truncated = false;
                }
            }
            Ok(Either::Right(row)) => {
                if columns.is_empty() {
                    columns = column_names::<DB>(&row);
                }
                if rows.len() >= DEFAULT_MAX_INTERACTIVE_ROWS {
                    truncated = true;
                    continue;
                }
                if rows.len() == rows.capacity() && rows.capacity() < DEFAULT_MAX_INTERACTIVE_ROWS {
                    let next_cap = (rows.capacity() * 2).min(DEFAULT_MAX_INTERACTIVE_ROWS);
                    rows.reserve(next_cap - rows.capacity());
                }
                rows.push(row_to_json(&row));
            }
            Err(error) => {
                return Err(PyroError::Database(format!(
                    "Error en consulta SQL: {error}"
                )));
            }
        }
    }

    if !columns.is_empty() || !rows.is_empty() {
        let elapsed = start.elapsed().as_millis() as u64;
        let count = rows.len() as u64;
        results.push(QueryExecutionResult {
            columns,
            rows,
            affected_rows: count,
            execution_time_ms: elapsed,
            message: result_set_message(count, elapsed, truncated),
            warning: None,
        });
    }

    if results.is_empty() {
        let elapsed = start.elapsed().as_millis() as u64;
        results.push(QueryExecutionResult {
            columns: vec![],
            rows: vec![],
            affected_rows: 0,
            execution_time_ms: elapsed,
            message: result_set_message(0, elapsed, false),
            warning: None,
        });
    }

    Ok(results)
}

pub fn result_set_message(count: u64, elapsed: u64, truncated: bool) -> String {
    if truncated {
        format!(
            "{count} fila(s) retornada(s) en {elapsed} ms (Límite interactivo de {DEFAULT_MAX_INTERACTIVE_ROWS} filas alcanzado para proteger la memoria)"
        )
    } else {
        format!("{count} fila(s) retornada(s) en {elapsed} ms")
    }
}

pub fn statement_result(affected: u64, start: Instant) -> QueryExecutionResult {
    let elapsed = start.elapsed().as_millis() as u64;
    QueryExecutionResult {
        columns: vec![],
        rows: vec![],
        affected_rows: affected,
        execution_time_ms: elapsed,
        message: format!(
            "Sentencia ejecutada con éxito. {affected} fila(s) afectada(s) en {elapsed} ms"
        ),
        warning: None,
    }
}

fn column_names<DB: Database>(row: &DB::Row) -> Vec<String> {
    row.columns()
        .iter()
        .map(|column| column.name().to_string())
        .collect()
}

/// Streams rows from a task that owns the connection, so the consumer can
/// keep the stream without borrowing it. Dropping the stream stops the task.
pub fn spawn_row_stream<DB>(
    conn: PoolConnection<DB>,
    sql: String,
    row_to_cells: RowToCells<DB>,
) -> RowStream
where
    DB: Database,
    for<'c> &'c mut DB::Connection: Executor<'c, Database = DB>,
    for<'q> DB::Arguments<'q>: IntoArguments<'q, DB>,
{
    let (sender, receiver) = mpsc::channel(ROW_STREAM_BUFFER);
    tokio::spawn(async move {
        if let Err(error) = forward_rows(conn, &sql, row_to_cells, &sender).await {
            let _ = sender.send(Err(error)).await;
        }
    });
    stream::unfold(receiver, |mut receiver| async move {
        receiver.recv().await.map(|item| (item, receiver))
    })
    .boxed()
}

type RowSender = mpsc::Sender<Result<RowStreamItem, EngineError>>;

async fn forward_rows<DB>(
    mut conn: PoolConnection<DB>,
    sql: &str,
    row_to_cells: RowToCells<DB>,
    sender: &RowSender,
) -> Result<(), EngineError>
where
    DB: Database,
    for<'c> &'c mut DB::Connection: Executor<'c, Database = DB>,
    for<'q> DB::Arguments<'q>: IntoArguments<'q, DB>,
{
    let mut rows = sqlx::query::<DB>(sql).fetch(&mut *conn);
    let mut columns_sent = false;
    while let Some(row) = rows.next().await {
        let row = row.map_err(|error| {
            EngineError::from(error).with_context("Error leyendo fila de consulta")
        })?;
        if !columns_sent {
            columns_sent = true;
            let columns = RowStreamItem::Columns(column_names::<DB>(&row));
            if sender.send(Ok(columns)).await.is_err() {
                return Ok(());
            }
        }
        let cells = RowStreamItem::Row(row_to_cells(&row)?);
        if sender.send(Ok(cells)).await.is_err() {
            return Ok(());
        }
    }
    Ok(())
}

/// Runs `statements` atomically on one connection: the first failure rolls
/// everything back. `begin` is the dialect's transaction opener.
pub async fn run_in_transaction<DB>(
    conn: &mut DB::Connection,
    begin: &str,
    statements: &[String],
) -> Result<usize, PyroError>
where
    DB: Database,
    for<'c> &'c mut DB::Connection: Executor<'c, Database = DB>,
{
    conn.execute(begin)
        .await
        .map_err(|error| PyroError::Database(format!("Error iniciando transacción: {error}")))?;

    let mut executed_count = 0;
    for statement in statements {
        let statement = statement.trim().trim_end_matches(';');
        if statement.is_empty() {
            continue;
        }
        if let Err(error) = conn.execute(statement).await {
            let _ = conn.execute("ROLLBACK").await;
            return Err(PyroError::Database(format!(
                "Error ejecutando sentencia en transacción: {error}. Transacción revertida (ROLLBACK)."
            )));
        }
        executed_count += 1;
    }

    conn.execute("COMMIT").await.map_err(|error| {
        PyroError::Database(format!("Error confirmando transacción (COMMIT): {error}"))
    })?;
    Ok(executed_count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::{QueryExecutionResult, ScriptExecutionResult, ScriptStatementResult};

    #[test]
    fn test_script_statement_result_conversion() {
        let qr = QueryExecutionResult {
            columns: vec!["id".into(), "name".into()],
            rows: vec![vec![serde_json::json!(1), serde_json::json!("Alice")]],
            affected_rows: 1,
            execution_time_ms: 12,
            message: "1 fila(s) retornada(s)".into(),
            warning: None,
        };

        let stmt = ScriptStatementResult::from_query_result(
            0,
            "SELECT id, name FROM users".into(),
            qr.clone(),
        );
        assert_eq!(stmt.statement_index, 0);
        assert_eq!(stmt.sql, "SELECT id, name FROM users");
        assert!(stmt.is_result_set);
        assert_eq!(stmt.columns, vec!["id", "name"]);
        assert_eq!(stmt.rows.len(), 1);

        let converted: QueryExecutionResult = stmt.into();
        assert_eq!(converted.columns, qr.columns);
        assert_eq!(converted.rows, qr.rows);
    }

    #[test]
    fn test_script_execution_result_aggregation() {
        let stmt1 = ScriptStatementResult {
            statement_index: 0,
            sql: "SELECT 1".into(),
            columns: vec!["1".into()],
            rows: vec![vec![serde_json::json!(1)]],
            affected_rows: 1,
            execution_time_ms: 5,
            message: "1 fila retornada".into(),
            warning: None,
            is_result_set: true,
            error: None,
        };

        let stmt2 = ScriptStatementResult {
            statement_index: 1,
            sql: "SELECT 2".into(),
            columns: vec!["2".into()],
            rows: vec![vec![serde_json::json!(2)]],
            affected_rows: 1,
            execution_time_ms: 7,
            message: "1 fila retornada".into(),
            warning: None,
            is_result_set: true,
            error: None,
        };

        let exec = ScriptExecutionResult {
            statements: vec![stmt1, stmt2],
            total_time_ms: 12,
            success: true,
            error: None,
            failed_statement_index: None,
        };

        assert!(exec.success);
        assert_eq!(exec.statements.len(), 2);
        assert_eq!(exec.total_time_ms, 12);
    }

    #[test]
    fn test_result_set_message() {
        let msg = result_set_message(42, 15, false);
        assert_eq!(msg, "42 fila(s) retornada(s) en 15 ms");

        let trunc_msg = result_set_message(5000, 100, true);
        assert!(trunc_msg.contains("Límite interactivo"));
    }
}
