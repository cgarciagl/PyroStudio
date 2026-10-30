//! Manual-commit mode for editor tabs.
//!
//! A tab that turns auto-commit off reserves one pooled connection with
//! `autocommit = 0`. Every statement of that tab runs on it until the user
//! commits, rolls back or leaves the mode; leaving always rolls back whatever
//! is still pending and returns the connection to the pool clean.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

use super::backend::{DatabaseBackend, PinnedSession};
use super::error::PyroError;
use super::models::QueryExecutionResult;
use super::read_only;
use super::safe_mode_gate::{self, ConfirmationStore};
use super::service::{get_session, SafeModeGuard};
use super::state::DbState;

/// State of a tab's manual transaction, as shown in its toolbar.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ManualTxStatus {
    /// Statements run since the last COMMIT/ROLLBACK.
    pub pending_statements: u32,
    /// When the current transaction started (Unix ms).
    pub started_at_ms: u64,
}

struct TabTransaction {
    session: Box<dyn PinnedSession>,
    status: ManualTxStatus,
}

type Registry = Mutex<HashMap<String, Arc<Mutex<TabTransaction>>>>;

fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn fresh_status() -> ManualTxStatus {
    ManualTxStatus {
        pending_statements: 0,
        started_at_ms: now_ms(),
    }
}

async fn tab(tab_id: &str) -> Result<Arc<Mutex<TabTransaction>>, PyroError> {
    registry().lock().await.get(tab_id).cloned().ok_or_else(|| {
        PyroError::InvalidOperation("La pestaña no tiene una transacción manual abierta.".into())
    })
}

/// Reserves a connection for `tab_id`. Idempotent: an open transaction is kept.
pub async fn begin(tab_id: String, state: &DbState) -> Result<ManualTxStatus, PyroError> {
    if let Ok(existing) = tab(&tab_id).await {
        return Ok(existing.lock().await.status.clone());
    }
    let session = get_session(state).await?;
    let pinned = session.backend.open_pinned_session().await?;
    let status = fresh_status();
    let entry = TabTransaction {
        session: pinned,
        status: status.clone(),
    };
    let previous = registry()
        .lock()
        .await
        .insert(tab_id, Arc::new(Mutex::new(entry)));
    if let Some(previous) = previous {
        release_entry(previous).await;
    }
    Ok(status)
}

/// Runs `sql` inside the tab's transaction, through the same Safe Mode and
/// read-only checks as a normal execution.
pub async fn execute(
    tab_id: String,
    sql: String,
    database: Option<String>,
    guard: SafeModeGuard,
    state: &DbState,
) -> Result<(QueryExecutionResult, ManualTxStatus), PyroError> {
    let session = get_session(state).await?;
    if session.backend.read_only {
        read_only::ensure_read_only_sql(&sql)?;
    }
    safe_mode_gate::enforce(
        &sql,
        guard.enabled,
        session.config.environment.as_deref(),
        guard.confirmation_token.as_deref(),
        ConfirmationStore::global(),
    )?;
    let entry = tab(&tab_id).await?;
    let mut entry = entry.lock().await;
    let result = entry.session.query(&sql, database.as_deref()).await?;
    entry.status = next_status(&entry.status, &sql);
    Ok((result, entry.status.clone()))
}

/// Status after running `sql`: a COMMIT/ROLLBACK typed in the editor closes
/// the transaction just like the toolbar buttons.
fn next_status(current: &ManualTxStatus, sql: &str) -> ManualTxStatus {
    let first_word = sql
        .split_whitespace()
        .next()
        .unwrap_or("")
        .trim_end_matches(';')
        .to_ascii_uppercase();
    if matches!(first_word.as_str(), "COMMIT" | "ROLLBACK") {
        return fresh_status();
    }
    ManualTxStatus {
        pending_statements: current.pending_statements + 1,
        started_at_ms: current.started_at_ms,
    }
}

async fn finish(tab_id: &str, statement: &str) -> Result<ManualTxStatus, PyroError> {
    let entry = tab(tab_id).await?;
    let mut entry = entry.lock().await;
    entry.session.query(statement, None).await?;
    entry.status = fresh_status();
    Ok(entry.status.clone())
}

pub async fn commit(tab_id: String) -> Result<ManualTxStatus, PyroError> {
    finish(&tab_id, "COMMIT").await
}

pub async fn rollback(tab_id: String) -> Result<ManualTxStatus, PyroError> {
    finish(&tab_id, "ROLLBACK").await
}

/// Leaves manual mode: rolls back pending work and frees the connection.
pub async fn end(tab_id: String) -> Result<(), PyroError> {
    let removed = registry().lock().await.remove(&tab_id);
    if let Some(entry) = removed {
        release_entry(entry).await;
    }
    Ok(())
}

/// Rolls back and frees every tab transaction (disconnect / reconnect).
pub async fn end_all() {
    let entries: Vec<_> = registry().lock().await.drain().map(|(_, e)| e).collect();
    for entry in entries {
        release_entry(entry).await;
    }
}

async fn release_entry(entry: Arc<Mutex<TabTransaction>>) {
    // Wait for any running statement of this tab before releasing.
    drop(entry.lock().await);
    // If an in-flight call still holds the entry, dropping the connection
    // later closes it and the server rolls the transaction back.
    if let Ok(mutex) = Arc::try_unwrap(entry) {
        mutex.into_inner().session.release().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn status(pending: u32) -> ManualTxStatus {
        ManualTxStatus {
            pending_statements: pending,
            started_at_ms: 1,
        }
    }

    #[test]
    fn statements_accumulate_in_the_open_transaction() {
        let next = next_status(&status(2), "UPDATE t SET a = 1");
        assert_eq!(next.pending_statements, 3);
        assert_eq!(next.started_at_ms, 1);
    }

    #[test]
    fn commit_or_rollback_typed_in_the_editor_starts_a_new_transaction() {
        assert_eq!(next_status(&status(5), "commit;").pending_statements, 0);
        assert_eq!(next_status(&status(5), "  ROLLBACK").pending_statements, 0);
    }
}
