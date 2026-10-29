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
    row_to_json: RowToJson<DB>,
    start: Instant,
) -> Result<QueryExecutionResult, PyroError> {
    let mut rows = Vec::new();
    let mut columns = Vec::new();
    let mut truncated = false;
    let mut first_set_done = false;
    let mut warning = None;

    while let Some(item) = stream.next().await {
        match item {
            Ok(Either::Left(_)) => first_set_done = true,
            Ok(Either::Right(_)) if first_set_done => {}
            Ok(Either::Right(row)) => {
                if columns.is_empty() {
                    columns = column_names::<DB>(&row);
                }
                if rows.len() >= DEFAULT_MAX_INTERACTIVE_ROWS {
                    truncated = true;
                    break;
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
