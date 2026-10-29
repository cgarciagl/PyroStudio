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
