//! Backend enforcement of Safe Mode.
//!
//! The frontend shows `SafeExecutionModal`, but the backend is the authority:
//! `execute_query` refuses statements that need confirmation unless the call
//! carries a single-use token issued by `confirm_sql_execution` for that exact
//! SQL text. In Production, Safe Mode cannot be disabled by the frontend.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use super::error::PyroError;
use super::safe_mode::{analyze_sql_safety, DangerLevel};

/// How long a confirmation token stays valid.
const TOKEN_TTL: Duration = Duration::from_secs(120);

/// Single-use confirmation tokens bound to the exact SQL they confirm.
#[derive(Default)]
pub struct ConfirmationStore {
    tokens: Mutex<HashMap<String, (String, Instant)>>,
}

impl ConfirmationStore {
    pub fn global() -> &'static ConfirmationStore {
        static STORE: OnceLock<ConfirmationStore> = OnceLock::new();
        STORE.get_or_init(ConfirmationStore::default)
    }

    /// Issues a token that authorizes running `sql` once.
    pub fn issue(&self, sql: &str) -> Result<String, PyroError> {
        let mut buf = [0u8; 24];
        getrandom::fill(&mut buf)
            .map_err(|_| PyroError::InvalidOperation("entropía no disponible".into()))?;
        let token: String = buf.iter().map(|b| format!("{b:02x}")).collect();

        let mut tokens = self.lock();
        let now = Instant::now();
        tokens.retain(|_, (_, expires)| *expires > now);
        tokens.insert(token.clone(), (sql.to_string(), now + TOKEN_TTL));
        Ok(token)
    }

    /// Consumes `token` if it is valid for `sql`. Tokens are removed even when
    /// they do not match, so a token can never be tried twice.
    pub fn consume(&self, token: &str, sql: &str) -> bool {
        match self.lock().remove(token) {
            Some((confirmed_sql, expires)) => confirmed_sql == sql && expires > Instant::now(),
            None => false,
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, (String, Instant)>> {
        // A poisoned lock only means another thread panicked mid-insert; the map is still usable.
        self.tokens.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// Returns true when the environment tag forces Safe Mode.
pub fn is_production(environment: Option<&str>) -> bool {
    environment.is_some_and(|env| env.trim().eq_ignore_ascii_case("production"))
}

/// Decides whether `sql` may run. `safe_mode` is the user preference sent by
/// the frontend; it is ignored (forced on) in Production.
pub fn enforce(
    sql: &str,
    safe_mode: bool,
    environment: Option<&str>,
    token: Option<&str>,
    store: &ConfirmationStore,
) -> Result<(), PyroError> {
    let production = is_production(environment);
    if !safe_mode && !production {
        return Ok(());
    }

    let analysis = analyze_sql_safety(sql);
    let needs_confirmation = analysis.requires_explicit_confirmation
        || analysis.is_uncertain
        || analysis.danger_level == DangerLevel::Critical
        || (production && analysis.danger_level != DangerLevel::Safe);
    if !needs_confirmation {
        return Ok(());
    }

    match token {
        Some(token) if store.consume(token, sql) => Ok(()),
        _ => Err(PyroError::SafeModeConfirmationRequired(analysis.operation)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DROP: &str = "DROP TABLE clientes";

    #[test]
    fn critical_sql_is_rejected_without_confirmation() {
        let store = ConfirmationStore::default();
        let err = enforce(DROP, true, None, None, &store).unwrap_err();
        assert!(matches!(err, PyroError::SafeModeConfirmationRequired(_)));
    }

    #[test]
    fn uncertain_sql_is_rejected_without_confirmation() {
        let store = ConfirmationStore::default();
        assert!(enforce("SELECT 1 --\nDROP TABLE t", true, None, None, &store).is_err());
        assert!(enforce("CALL limpiar()", true, None, None, &store).is_err());
    }

    #[test]
    fn safe_and_medium_sql_run_without_confirmation() {
        let store = ConfirmationStore::default();
        enforce("SELECT * FROM t", true, None, None, &store).unwrap();
        enforce("DELETE FROM t WHERE id = 1", true, None, None, &store).unwrap();
        enforce("CREATE TABLE t (id INT)", true, None, None, &store).unwrap();
    }

    #[test]
    fn valid_token_allows_exactly_one_execution() {
        let store = ConfirmationStore::default();
        let token = store.issue(DROP).unwrap();
        enforce(DROP, true, None, Some(&token), &store).unwrap();
        assert!(enforce(DROP, true, None, Some(&token), &store).is_err());
    }

    #[test]
    fn token_is_bound_to_the_confirmed_sql() {
        let store = ConfirmationStore::default();
        let token = store.issue("DELETE FROM a").unwrap();
        assert!(enforce("DROP DATABASE prod", true, None, Some(&token), &store).is_err());
        // Un token que no coincide queda invalidado
        assert!(enforce("DELETE FROM a", true, None, Some(&token), &store).is_err());
    }

    #[test]
    fn forged_token_is_rejected() {
        let store = ConfirmationStore::default();
        assert!(enforce(DROP, true, None, Some("abc"), &store).is_err());
    }

    #[test]
    fn safe_mode_off_skips_checks_outside_production() {
        let store = ConfirmationStore::default();
        enforce(DROP, false, None, None, &store).unwrap();
        enforce(DROP, false, Some("development"), None, &store).unwrap();
    }

    #[test]
    fn production_cannot_disable_safe_mode() {
        let store = ConfirmationStore::default();
        assert!(enforce(DROP, false, Some("production"), None, &store).is_err());
        assert!(enforce(DROP, false, Some("PRODUCTION"), None, &store).is_err());
        // En producción cualquier sentencia no segura requiere confirmación
        assert!(enforce(
            "DELETE FROM t WHERE id = 1",
            false,
            Some("production"),
            None,
            &store
        )
        .is_err());
        enforce("SELECT 1", false, Some("production"), None, &store).unwrap();
        let token = store.issue("DELETE FROM t WHERE id = 1").unwrap();
        enforce(
            "DELETE FROM t WHERE id = 1",
            false,
            Some("production"),
            Some(&token),
            &store,
        )
        .unwrap();
    }
}
