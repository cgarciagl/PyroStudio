use super::error::PyroError;

/// Validates that an SQL identifier (database, table, column, index name) is safe.
/// Rejects null bytes, control characters, empty strings, and overly long identifiers (>64 chars).
pub fn validate_identifier(name: &str) -> Result<(), PyroError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(PyroError::InvalidIdentifier(
            "El nombre del identificador no puede estar vacío.".into(),
        ));
    }
    if trimmed.len() > 64 {
        return Err(PyroError::InvalidIdentifier(format!(
            "El identificador '{}' excede la longitud máxima permitida de 64 caracteres.",
            trimmed
        )));
    }
    if trimmed.contains('\0') {
        return Err(PyroError::InvalidIdentifier(
            "El identificador contiene caracteres nulos inválidos.".into(),
        ));
    }
    if trimmed.chars().any(|c| c.is_control()) {
        return Err(PyroError::InvalidIdentifier(
            "El identificador contiene caracteres de control no permitidos.".into(),
        ));
    }
    Ok(())
}

/// Quotes an SQL identifier using MariaDB/MySQL backticks: `name`.
/// Any internal backtick is escaped by doubling it: ``.
pub fn quote_identifier(name: &str) -> Result<String, PyroError> {
    validate_identifier(name)?;
    let escaped = name.trim().replace('`', "``");
    Ok(format!("`{escaped}`"))
}

/// Qualifies a table name as `database`.`table` if database is provided, or `table` otherwise.
pub fn qualify_table(database: Option<&str>, table: &str) -> Result<String, PyroError> {
    let quoted_table = quote_identifier(table)?;
    if let Some(db) = database {
        let db_trim = db.trim();
        if !db_trim.is_empty() {
            let quoted_db = quote_identifier(db_trim)?;
            return Ok(format!("{quoted_db}.{quoted_table}"));
        }
    }
    Ok(quoted_table)
}

/// Returns true if `sql` alters session-level state (variables, temp tables, active schema, pragmas, etc.)
/// which must not leak to subsequent pooled connections.
pub fn statement_alters_session_state(sql: &str) -> bool {
    let tokens = crate::db::safe_mode::tokenize_sql(sql);
    let words: Vec<String> = tokens
        .iter()
        .filter_map(|t| match t {
            crate::db::safe_mode::Token::Word(w) => Some(w.to_ascii_uppercase()),
            _ => None,
        })
        .collect();

    // Check if the statement mutates session variables using := (e.g. SELECT @var := 1)
    let has_assignment_op = tokens.windows(2).any(|w| {
        matches!(
            (&w[0], &w[1]),
            (
                crate::db::safe_mode::Token::Symbol(':'),
                crate::db::safe_mode::Token::Symbol('=')
            )
        )
    });
    let has_at = words.iter().any(|w| w.starts_with('@'));
    if has_at && has_assignment_op {
        return true;
    }

    let Some(first) = words.first() else {
        return false;
    };

    match first.as_str() {
        "SET" | "USE" | "PRAGMA" | "ATTACH" | "DETACH" | "PREPARE" | "DEALLOCATE" | "LOCK"
        | "UNLOCK" => true,
        _ => {
            // Check for temporary tables: CREATE [TEMPORARY|TEMP] TABLE or DROP [TEMPORARY|TEMP] TABLE
            let has_temp = words.iter().any(|w| w == "TEMPORARY" || w == "TEMP");
            let has_table = words.iter().any(|w| w == "TABLE");
            has_temp && has_table
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_quote_identifier_valid() {
        assert_eq!(quote_identifier("users").unwrap(), "`users`");
        assert_eq!(quote_identifier("my_table").unwrap(), "`my_table`");
        assert_eq!(
            quote_identifier("with`backtick").unwrap(),
            "`with``backtick`"
        );
    }

    #[test]
    fn test_quote_identifier_invalid() {
        assert!(quote_identifier("").is_err());
        assert!(quote_identifier("   ").is_err());
        assert!(quote_identifier("with\0null").is_err());
        let too_long = "a".repeat(65);
        assert!(quote_identifier(&too_long).is_err());
    }

    #[test]
    fn test_qualify_table() {
        assert_eq!(
            qualify_table(Some("my_db"), "users").unwrap(),
            "`my_db`.`users`"
        );
        assert_eq!(qualify_table(None, "users").unwrap(), "`users`");
        assert_eq!(qualify_table(Some(""), "users").unwrap(), "`users`");
    }

    #[test]
    fn test_statement_alters_session_state() {
        // Variables and session settings
        assert!(statement_alters_session_state("SET @my_var = 42;"));
        assert!(statement_alters_session_state("set session sql_mode = '';"));
        assert!(statement_alters_session_state("/* comment */ SET NAMES utf8mb4;"));
        assert!(statement_alters_session_state("SELECT @counter := @counter + 1;"));

        // Schema navigation and locking
        assert!(statement_alters_session_state("USE production;"));
        assert!(statement_alters_session_state("LOCK TABLES users WRITE;"));
        assert!(statement_alters_session_state("UNLOCK TABLES;"));

        // Temporary tables
        assert!(statement_alters_session_state("CREATE TEMPORARY TABLE #temp (id int);"));
        assert!(statement_alters_session_state("CREATE TEMP TABLE t (id int);"));
        assert!(statement_alters_session_state("DROP TEMPORARY TABLE IF EXISTS #temp;"));

        // SQLite pragmas and attached databases
        assert!(statement_alters_session_state("PRAGMA foreign_keys = ON;"));
        assert!(statement_alters_session_state("ATTACH DATABASE 'aux.db' AS aux;"));
        assert!(statement_alters_session_state("DETACH DATABASE aux;"));

        // Normal queries do not alter session state
        assert!(!statement_alters_session_state("SELECT * FROM users WHERE id = 1;"));
        assert!(!statement_alters_session_state("INSERT INTO logs (msg) VALUES ('ok');"));
        assert!(!statement_alters_session_state("UPDATE users SET name = 'Carlos' WHERE id = 1;"));
        assert!(!statement_alters_session_state("DELETE FROM tokens WHERE expired = 1;"));
    }
}
