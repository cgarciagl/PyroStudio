use sqlx::MySqlPool;

use super::error::PyroError;
use super::state::{ActiveSession, DbState};

/// Retrieves a clone of the currently active session, or returns `PyroError::NotConnected`.
pub async fn get_session(state: &DbState) -> Result<ActiveSession, PyroError> {
    let session_guard = state.session.read().await;
    match &*session_guard {
        Some(session) => Ok(session.clone()),
        None => Err(PyroError::NotConnected),
    }
}

/// Retrieves the underlying SQLx MySqlPool for operations that require direct connection access
/// (such as bulk excel streaming). Returns an error if connected via HTTP tunnel or disconnected.
pub async fn get_pool(state: &DbState) -> Result<MySqlPool, PyroError> {
    let session = get_session(state).await?;
    session.pool()
}
