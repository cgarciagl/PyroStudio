//! Read-only connections.
//!
//! A connection marked `read_only` is enforced in the backend: every SQL text
//! is checked statement by statement and any data write (cell edits, row
//! deletes, transactions, bound-parameter writes) is refused before it reaches
//! the engine. The UI only mirrors this rule; it is not the authority.

use super::error::PyroError;
use super::safe_mode::{split_statements, tokenize_sql, Token};

/// Statements allowed as the leading keyword of a read-only statement.
const READ_LEADS: &[&str] = &[
    "SELECT", "SHOW", "DESCRIBE", "DESC", "EXPLAIN", "WITH", "VALUES", "TABLE", "USE", "PRAGMA",
];

/// Keywords that turn an otherwise read-only statement into a write or a lock.
const WRITE_WORDS: &[&str] = &[
    "INSERT", "UPDATE", "DELETE", "REPLACE", "DROP", "TRUNCATE", "ALTER", "CREATE", "RENAME",
    "GRANT", "REVOKE", "CALL", "LOAD", "OUTFILE", "DUMPFILE", "LOCK", "HANDLER", "DO", "SET",
];

pub fn read_only_error(detail: &str) -> PyroError {
    PyroError::ReadOnlyConnection(detail.to_string())
}

/// Returns `Ok` when every statement of `sql` only reads data.
pub fn ensure_read_only_sql(sql: &str) -> Result<(), PyroError> {
    let tokens = tokenize_sql(sql);
    if let Some(Token::UnclosedSyntax(_)) = tokens
        .iter()
        .find(|t| matches!(t, Token::UnclosedSyntax(_)))
    {
        return Err(read_only_error("la sentencia no se pudo analizar"));
    }
    for statement in split_statements(&tokens) {
        check_statement(&statement)?;
    }
    Ok(())
}

fn check_statement(tokens: &[Token]) -> Result<(), PyroError> {
    let mut words = tokens.iter().enumerate().filter_map(|(i, t)| match t {
        Token::Word(w) => Some((i, w.to_ascii_uppercase())),
        _ => None,
    });
    let Some((_, lead)) = words.next() else {
        return Ok(());
    };
    if !READ_LEADS.contains(&lead.as_str()) {
        return Err(read_only_error(&format!(
            "'{lead}' modifica datos o estado"
        )));
    }
    if lead == "PRAGMA" && tokens.iter().any(|t| matches!(t, Token::Symbol('='))) {
        return Err(read_only_error("PRAGMA con asignación"));
    }
    for (index, word) in words {
        // REPLACE(), INSERT() and friends are string functions, not statements.
        let is_call = matches!(tokens.get(index + 1), Some(Token::ParenthesisOpen));
        if !is_call && WRITE_WORDS.contains(&word.as_str()) {
            return Err(read_only_error(&format!("contiene '{word}'")));
        }
        if word == "INTO" {
            return Err(read_only_error("SELECT ... INTO"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allowed(sql: &str) -> bool {
        ensure_read_only_sql(sql).is_ok()
    }

    #[test]
    fn allows_plain_reads() {
        assert!(allowed("SELECT * FROM t WHERE a = 1"));
        assert!(allowed("SHOW TABLES; DESCRIBE t"));
        assert!(allowed("EXPLAIN SELECT 1"));
        assert!(allowed("WITH x AS (SELECT 1) SELECT * FROM x"));
        assert!(allowed("USE `shop`"));
        assert!(allowed("PRAGMA table_info(t)"));
        assert!(allowed(
            "SELECT REPLACE(name, 'a', 'b'), INSERT(s, 1, 2, 'x') FROM t"
        ));
        assert!(allowed("SELECT 'DROP TABLE t' AS texto"));
        assert!(allowed("SELECT `update` FROM t"));
    }

    #[test]
    fn rejects_writes_and_side_effects() {
        assert!(!allowed("UPDATE t SET a = 1"));
        assert!(!allowed("SELECT 1; DROP TABLE t"));
        assert!(!allowed("WITH x AS (SELECT 1) DELETE FROM t"));
        assert!(!allowed("SELECT * FROM t INTO OUTFILE '/tmp/x'"));
        assert!(!allowed("SELECT * FROM t FOR UPDATE"));
        assert!(!allowed("SELECT * FROM t LOCK IN SHARE MODE"));
        assert!(!allowed("SET GLOBAL read_only = 0"));
        assert!(!allowed("CALL purge()"));
        assert!(!allowed("PRAGMA journal_mode = WAL"));
        assert!(!allowed("EXPLAIN DELETE FROM t"));
        assert!(!allowed("SELECT 'sin cerrar"));
    }
}
