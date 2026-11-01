use super::backend::DatabaseBackend;
use super::engine::DbEngine;
use super::error::PyroError;
use super::models::{SqlRestoreProgressEvent, SqlRestoreRequest, SqlRestoreSummary};
use super::sql_utils::quote_identifier;
use std::path::Path;
use std::time::Instant;
use tauri::Emitter;
use tokio::io::AsyncReadExt;

/// Helper to determine if a string contains only SQL comments and whitespace
fn is_pure_comment(s: &str, engine: DbEngine) -> bool {
    let mut in_block = false;
    for line in s.lines() {
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        if in_block {
            if let Some(pos) = t.find("*/") {
                in_block = false;
                let after = t[pos + 2..].trim();
                if !after.is_empty() && !is_pure_comment(after, engine) {
                    return false;
                }
            }
            continue;
        }
        if let Some(stripped) = t.strip_prefix("/*") {
            if let Some(pos) = stripped.find("*/") {
                let after = stripped[pos + 2..].trim();
                if !after.is_empty() && !is_pure_comment(after, engine) {
                    return false;
                }
                continue;
            } else {
                in_block = true;
                continue;
            }
        }
        match engine {
            DbEngine::MySql => {
                if t.starts_with('#') {
                    continue;
                }
                if t.starts_with("--")
                    && t.chars()
                        .nth(2)
                        .is_none_or(|c| c.is_whitespace() || c.is_control())
                {
                    continue;
                }
                return false;
            }
            DbEngine::Sqlite => {
                if t.starts_with("--") {
                    continue;
                }
                return false;
            }
        }
    }
    !in_block
}

/// Parses a SQL string into separate executable SQL statements using MySQL/MariaDB rules by default.
pub fn split_sql_statements(sql: &str) -> Vec<String> {
    split_sql_statements_for_engine(sql, DbEngine::MySql)
}

/// Parses a SQL string into separate executable SQL statements, respecting custom DELIMITERs,
/// single/double quotes, backticks, escaped characters, and engine-specific comment rules.
pub fn split_sql_statements_for_engine(sql: &str, engine: DbEngine) -> Vec<String> {
    let mut statements = Vec::new();
    let mut active_delimiter = ";".to_string();
    let mut current = String::with_capacity(512);

    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut in_backtick = false;
    let mut in_line_comment = false;
    let mut in_block_comment = false;
    let mut is_escaped = false;

    let chars: Vec<char> = sql.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        let ch = chars[i];
        let next_ch = if i + 1 < len {
            Some(chars[i + 1])
        } else {
            None
        };

        // Handle escape sequence in quotes
        if (in_single_quote || in_double_quote) && is_escaped {
            current.push(ch);
            is_escaped = false;
            i += 1;
            continue;
        }

        if (in_single_quote || in_double_quote) && ch == '\\' {
            current.push(ch);
            is_escaped = true;
            i += 1;
            continue;
        }

        // Handle string quotes
        if ch == '\'' && !in_double_quote && !in_backtick && !in_line_comment && !in_block_comment {
            in_single_quote = !in_single_quote;
            current.push(ch);
            i += 1;
            continue;
        }

        if ch == '"' && !in_single_quote && !in_backtick && !in_line_comment && !in_block_comment {
            in_double_quote = !in_double_quote;
            current.push(ch);
            i += 1;
            continue;
        }

        if ch == '`'
            && !in_single_quote
            && !in_double_quote
            && !in_line_comment
            && !in_block_comment
        {
            in_backtick = !in_backtick;
            current.push(ch);
            i += 1;
            continue;
        }

        // Handle line comments (-- or #)
        if !in_single_quote && !in_double_quote && !in_backtick && !in_block_comment {
            if !in_line_comment {
                let is_comment = match engine {
                    DbEngine::MySql => {
                        ch == '#'
                            || (ch == '-'
                                && next_ch == Some('-')
                                && chars
                                    .get(i + 2)
                                    .is_none_or(|c| c.is_whitespace() || c.is_control()))
                    }
                    DbEngine::Sqlite => ch == '-' && next_ch == Some('-'),
                };

                if is_comment {
                    in_line_comment = true;
                    current.push(ch);
                    if ch == '-' {
                        current.push('-');
                        i += 1;
                    }
                    i += 1;
                    continue;
                }
            } else if ch == '\n' || ch == '\r' {
                in_line_comment = false;
                current.push(ch);
                i += 1;
                continue;
            }
        }

        // Handle block comments (/* ... */)
        if !in_single_quote && !in_double_quote && !in_backtick && !in_line_comment {
            if !in_block_comment && ch == '/' && next_ch == Some('*') {
                in_block_comment = true;
                current.push('/');
                current.push('*');
                i += 2;
                continue;
            } else if in_block_comment && ch == '*' && next_ch == Some('/') {
                in_block_comment = false;
                current.push('*');
                current.push('/');
                i += 2;
                continue;
            }
        }

        // Check for DELIMITER change directive
        if !in_single_quote
            && !in_double_quote
            && !in_backtick
            && !in_line_comment
            && !in_block_comment
            && is_pure_comment(&current, engine)
        {
            let remaining = &chars[i..];
            let remaining_str: String = remaining.iter().take(10).collect();
            if remaining_str.to_uppercase().starts_with("DELIMITER")
                && (remaining.len() == 9 || remaining[9].is_whitespace())
            {
                // Find end of line for DELIMITER command
                let mut end_idx = i + 9;
                while end_idx < len && chars[end_idx].is_whitespace() && chars[end_idx] != '\n' {
                    end_idx += 1;
                }
                let delim_start = end_idx;
                while end_idx < len && chars[end_idx] != '\n' && chars[end_idx] != '\r' {
                    end_idx += 1;
                }
                let new_delim: String = chars[delim_start..end_idx].iter().collect();
                let trimmed_delim = new_delim.trim().to_string();
                if !trimmed_delim.is_empty() {
                    active_delimiter = trimmed_delim;
                }
                current.clear();
                i = end_idx;
                continue;
            }
        }

        current.push(ch);

        // Check if current statement ends with active delimiter
        if !in_single_quote
            && !in_double_quote
            && !in_backtick
            && !in_line_comment
            && !in_block_comment
            && current.ends_with(&active_delimiter)
        {
            let stmt_len = current.len() - active_delimiter.len();
            let stmt = current[..stmt_len].trim().to_string();
            if !stmt.is_empty() {
                statements.push(stmt);
            }
            current.clear();
        }

        i += 1;
    }

    // Trailing statement without trailing delimiter
    let remaining = current.trim().to_string();
    if !remaining.is_empty() && !is_pure_comment(&remaining, engine) {
        statements.push(remaining);
    }

    statements
}

/// Executes a full database restore from a `.sql` backup file.
pub async fn execute_sql_restore(
    backend: &dyn DatabaseBackend,
    app_handle: Option<&tauri::AppHandle>,
    req: SqlRestoreRequest,
) -> Result<SqlRestoreSummary, PyroError> {
    let start_time = Instant::now();
    let file_path = Path::new(&req.file_path);

    if !file_path.exists() {
        return Err(PyroError::InvalidIdentifier(format!(
            "El archivo de respaldo no existe: {}",
            req.file_path
        )));
    }

    // Read SQL file
    let mut file = tokio::fs::File::open(file_path).await.map_err(|e| {
        PyroError::Io(format!(
            "No se pudo abrir el archivo de respaldo '{}': {e}",
            req.file_path
        ))
    })?;

    let metadata = file.metadata().await.map_err(|e| {
        PyroError::Io(format!(
            "No se pudieron leer los metadatos del archivo: {e}"
        ))
    })?;
    let total_bytes = metadata.len();

    let mut sql_content = String::with_capacity(total_bytes as usize);
    file.read_to_string(&mut sql_content).await.map_err(|e| {
        PyroError::Io(format!(
            "No se pudo leer el contenido del archivo de respaldo: {e}"
        ))
    })?;

    // Create database if requested
    let target_db = req.target_database.trim();
    if req.create_database_if_not_exists && !target_db.is_empty() {
        let quoted_db = quote_identifier(target_db)?;
        let create_sql = format!(
            "CREATE DATABASE IF NOT EXISTS {} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;",
            quoted_db
        );
        backend.execute_query(&create_sql, None).await?;
    }

    // Disable foreign keys if requested
    if req.disable_foreign_keys {
        let _ = backend
            .execute_query(
                "SET FOREIGN_KEY_CHECKS = 0; SET UNIQUE_CHECKS = 0;",
                if target_db.is_empty() {
                    None
                } else {
                    Some(target_db)
                },
            )
            .await;
    }

    // Split SQL content into executable statements
    let statements = split_sql_statements(&sql_content);
    let total_stmts = statements.len();

    let mut successful_statements = 0;
    let mut failed_statements = 0;
    let mut errors = Vec::new();

    let db_context = if target_db.is_empty() {
        None
    } else {
        Some(target_db)
    };

    for (idx, stmt) in statements.iter().enumerate() {
        let trimmed = stmt.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Preview string for progress
        let preview: String = trimmed.chars().take(80).collect();

        // Emit progress
        if let Some(app) = app_handle {
            let pct = if total_stmts > 0 {
                ((idx as f64) / (total_stmts as f64)) * 100.0
            } else {
                0.0
            };

            let _ = app.emit(
                "sql-restore-progress",
                SqlRestoreProgressEvent {
                    stage: "Ejecutando sentencias SQL...".to_string(),
                    bytes_read: (total_bytes * (idx as u64)) / (total_stmts.max(1) as u64),
                    total_bytes,
                    statements_executed: (idx + 1) as u64,
                    current_statement_preview: preview.clone(),
                    percent_complete: pct,
                },
            );
        }

        // Execute statement
        match backend.execute_query(trimmed, db_context).await {
            Ok(_) => {
                successful_statements += 1;
            }
            Err(e) => {
                failed_statements += 1;
                let err_msg = format!("Error en sentencia #{}: {} (SQL: {})", idx + 1, e, preview);
                errors.push(err_msg.clone());

                if req.stop_on_error {
                    // Re-enable foreign keys before exiting if needed
                    if req.disable_foreign_keys {
                        let _ = backend
                            .execute_query(
                                "SET FOREIGN_KEY_CHECKS = 1; SET UNIQUE_CHECKS = 1;",
                                db_context,
                            )
                            .await;
                    }
                    return Err(PyroError::Database(format!(
                        "Restauración detenida por error en sentencia #{}: {e}",
                        idx + 1
                    )));
                }
            }
        }
    }

    // Re-enable foreign keys if disabled
    if req.disable_foreign_keys {
        let _ = backend
            .execute_query(
                "SET FOREIGN_KEY_CHECKS = 1; SET UNIQUE_CHECKS = 1;",
                db_context,
            )
            .await;
    }

    // Final completion event
    if let Some(app) = app_handle {
        let _ = app.emit(
            "sql-restore-progress",
            SqlRestoreProgressEvent {
                stage: "Restauración finalizada.".to_string(),
                bytes_read: total_bytes,
                total_bytes,
                statements_executed: total_stmts as u64,
                current_statement_preview: "Completado".to_string(),
                percent_complete: 100.0,
            },
        );
    }

    Ok(SqlRestoreSummary {
        target_database: req.target_database,
        total_statements: total_stmts,
        successful_statements,
        failed_statements,
        errors,
        duration_ms: start_time.elapsed().as_millis() as u64,
        bytes_processed: total_bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_split_simple_statements() {
        let sql = "CREATE TABLE users (id INT PRIMARY KEY); INSERT INTO users VALUES (1); SELECT * FROM users;";
        let stmts = split_sql_statements(sql);
        assert_eq!(stmts.len(), 3);
        assert_eq!(stmts[0], "CREATE TABLE users (id INT PRIMARY KEY)");
        assert_eq!(stmts[1], "INSERT INTO users VALUES (1)");
        assert_eq!(stmts[2], "SELECT * FROM users");
    }

    #[test]
    fn test_split_statements_with_quoted_semicolons() {
        let sql = "INSERT INTO logs (message) VALUES ('Hello; World;'); INSERT INTO logs VALUES (\"Another; one;\");";
        let stmts = split_sql_statements(sql);
        assert_eq!(stmts.len(), 2);
        assert_eq!(
            stmts[0],
            "INSERT INTO logs (message) VALUES ('Hello; World;')"
        );
        assert_eq!(stmts[1], "INSERT INTO logs VALUES (\"Another; one;\")");
    }

    #[test]
    fn test_split_statements_with_custom_delimiters() {
        let sql = r#"
CREATE TABLE t1 (id INT);

DELIMITER //
CREATE PROCEDURE get_users()
BEGIN
    SELECT * FROM users;
    SELECT * FROM logs;
END //
DELIMITER ;

SELECT 1;
"#;
        let stmts = split_sql_statements(sql);
        assert_eq!(stmts.len(), 3);
        assert_eq!(stmts[0], "CREATE TABLE t1 (id INT)");
        assert!(stmts[1].contains("CREATE PROCEDURE get_users()"));
        assert!(stmts[1].contains("SELECT * FROM users;"));
        assert_eq!(stmts[2], "SELECT 1");
    }

    #[test]
    fn test_split_statements_with_comments() {
        let sql = r#"
-- This is a comment with a ; semicolon
# Another comment with ;
/* Multi-line comment ;
   with semicolon */
CREATE TABLE test (id INT);
SELECT 1; -- inline comment ;
"#;
        let stmts = split_sql_statements(sql);
        assert_eq!(stmts.len(), 2);
        assert!(stmts[0].contains("CREATE TABLE test (id INT)"));
        assert!(stmts[1].contains("SELECT 1"));
    }

    #[test]
    fn test_mysql_double_dash_requires_whitespace() {
        // In MySQL/MariaDB, `--` without following whitespace is not a comment.
        let sql = "SELECT 1--x;\nSELECT 2;";
        let stmts_mysql = split_sql_statements_for_engine(sql, DbEngine::MySql);
        assert_eq!(stmts_mysql.len(), 2);
        assert_eq!(stmts_mysql[0], "SELECT 1--x");
        assert_eq!(stmts_mysql[1], "SELECT 2");

        // In SQLite, `--` starts a comment even without whitespace.
        let sql_sqlite = "SELECT 1--x;\nSELECT 2;";
        let stmts_sqlite = split_sql_statements_for_engine(sql_sqlite, DbEngine::Sqlite);
        assert_eq!(stmts_sqlite.len(), 1);
    }

    #[test]
    fn test_mysql_double_dash_with_whitespace_is_comment() {
        let sql = "SELECT 1; -- this is a comment\nSELECT 2;";
        let stmts = split_sql_statements_for_engine(sql, DbEngine::MySql);
        assert_eq!(stmts.len(), 2);
        assert_eq!(stmts[0], "SELECT 1");
        assert!(stmts[1].contains("SELECT 2"));

        let sql_tab = "SELECT 1; --\tcomment with tab\nSELECT 2;";
        let stmts_tab = split_sql_statements_for_engine(sql_tab, DbEngine::MySql);
        assert_eq!(stmts_tab.len(), 2);
        assert_eq!(stmts_tab[0], "SELECT 1");
    }

    #[test]
    fn test_mysql_hash_comment() {
        let sql = "SELECT 1; # this is a hash comment\nSELECT 2;";
        let stmts = split_sql_statements_for_engine(sql, DbEngine::MySql);
        assert_eq!(stmts.len(), 2);
        assert_eq!(stmts[0], "SELECT 1");
        assert!(stmts[1].contains("SELECT 2"));
    }

    #[test]
    fn test_delimiter_with_comments() {
        let sql = r#"
-- Preceding comment
DELIMITER $$
-- Inside delimiter switch
CREATE FUNCTION f() RETURNS INT
BEGIN
    RETURN 1; -- inside body comment
END $$
DELIMITER ;
-- Trailing comment
"#;
        let stmts = split_sql_statements_for_engine(sql, DbEngine::MySql);
        assert_eq!(stmts.len(), 1);
        assert!(stmts[0].contains("CREATE FUNCTION f()"));
        assert!(stmts[0].contains("RETURN 1;"));
    }

    #[test]
    fn test_block_comment_handling() {
        let sql = "/* Block comment with ; semicolon */ SELECT 1; /* inline block ; */ SELECT 2;";
        let stmts = split_sql_statements_for_engine(sql, DbEngine::MySql);
        assert_eq!(stmts.len(), 2);
        assert!(stmts[0].contains("SELECT 1"));
        assert!(stmts[1].contains("SELECT 2"));
    }
}
