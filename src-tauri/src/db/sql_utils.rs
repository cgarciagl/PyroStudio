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
}
