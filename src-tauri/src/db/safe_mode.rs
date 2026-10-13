use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DangerLevel {
    Safe,
    Medium,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlSafetyAnalysis {
    pub is_destructive: bool,
    pub danger_level: DangerLevel,
    pub operation: String,
    pub message: String,
    pub requires_explicit_confirmation: bool,
    #[serde(default)]
    pub is_uncertain: bool,
    #[serde(default)]
    pub affected_scope: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Token {
    Word(String),
    StringLiteral(String),
    BacktickIdentifier(String),
    Semicolon,
    ParenthesisOpen,
    ParenthesisClose,
    Symbol(char),
}

/// Tokenizes an SQL string taking into account single quotes, double quotes,
/// backtick identifiers, comments (-- and # and /* */), and escape sequences.
pub fn tokenize_sql(sql: &str) -> Vec<Token> {
    let mut tokens = Vec::new();
    let chars: Vec<char> = sql.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        let c = chars[i];

        // 1. Skip whitespace
        if c.is_whitespace() {
            i += 1;
            continue;
        }

        // 2. Line comment: -- or #
        if (c == '-' && i + 1 < len && chars[i + 1] == '-') || c == '#' {
            while i < len && chars[i] != '\n' && chars[i] != '\r' {
                i += 1;
            }
            continue;
        }

        // 3. Block comment: /* ... */
        if c == '/' && i + 1 < len && chars[i + 1] == '*' {
            i += 2;
            while i + 1 < len && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            if i + 1 < len {
                i += 2;
            } else {
                i = len;
            }
            continue;
        }

        // 4. String literal: '...' or "..."
        if c == '\'' || c == '"' {
            let quote = c;
            let mut lit = String::new();
            i += 1;
            while i < len {
                if chars[i] == '\\' && i + 1 < len {
                    // Escaped character
                    lit.push(chars[i + 1]);
                    i += 2;
                } else if chars[i] == quote {
                    // Check for doubled quote escape in SQL (e.g. 'O''Reilly')
                    if i + 1 < len && chars[i + 1] == quote {
                        lit.push(quote);
                        i += 2;
                    } else {
                        i += 1;
                        break;
                    }
                } else {
                    lit.push(chars[i]);
                    i += 1;
                }
            }
            tokens.push(Token::StringLiteral(lit));
            continue;
        }

        // 5. Backtick identifier: `...`
        if c == '`' {
            let mut ident = String::new();
            i += 1;
            while i < len {
                if chars[i] == '`' {
                    if i + 1 < len && chars[i + 1] == '`' {
                        ident.push('`');
                        i += 2;
                    } else {
                        i += 1;
                        break;
                    }
                } else {
                    ident.push(chars[i]);
                    i += 1;
                }
            }
            tokens.push(Token::BacktickIdentifier(ident));
            continue;
        }

        // 6. Semicolon delimiter
        if c == ';' {
            tokens.push(Token::Semicolon);
            i += 1;
            continue;
        }

        // 7. Parentheses
        if c == '(' {
            tokens.push(Token::ParenthesisOpen);
            i += 1;
            continue;
        }
        if c == ')' {
            tokens.push(Token::ParenthesisClose);
            i += 1;
            continue;
        }

        // 8. Word or alphanumeric/underscore identifier
        if c.is_alphanumeric() || c == '_' || c == '$' || c == '@' {
            let mut word = String::new();
            while i < len
                && (chars[i].is_alphanumeric()
                    || chars[i] == '_'
                    || chars[i] == '$'
                    || chars[i] == '@')
            {
                word.push(chars[i]);
                i += 1;
            }
            tokens.push(Token::Word(word));
            continue;
        }

        // 9. Other symbols (e.g. =, <, >, ,, ., *, etc.)
        tokens.push(Token::Symbol(c));
        i += 1;
    }

    tokens
}

/// Splits token sequence into individual statements divided by top-level Semicolons.
pub fn split_statements(tokens: &[Token]) -> Vec<Vec<Token>> {
    let mut stmts = Vec::new();
    let mut current = Vec::new();

    for tok in tokens {
        if let Token::Semicolon = tok {
            if !current.is_empty() {
                stmts.push(current);
                current = Vec::new();
            }
        } else {
            current.push(tok.clone());
        }
    }

    if !current.is_empty() {
        stmts.push(current);
    }

    stmts
}

/// Cleans SQL comments and trims whitespace to analyze the primary statement.
/// Preserved for backwards compatibility with modules calling clean_sql_statement.
pub fn clean_sql_statement(sql: &str) -> String {
    let mut cleaned = String::new();
    let chars: Vec<char> = sql.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        // Line comment -- or #
        if (chars[i] == '-' && i + 1 < len && chars[i + 1] == '-') || chars[i] == '#' {
            while i < len && chars[i] != '\n' && chars[i] != '\r' {
                i += 1;
            }
            continue;
        }

        // Block comment /* ... */
        if chars[i] == '/' && i + 1 < len && chars[i + 1] == '*' {
            i += 2;
            while i + 1 < len && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            if i + 1 < len {
                i += 2;
            }
            continue;
        }

        cleaned.push(chars[i]);
        i += 1;
    }

    cleaned.trim().to_string()
}

/// Helper to extract word string in uppercase if token is Word
fn word_upper(tok: &Token) -> Option<String> {
    match tok {
        Token::Word(w) => Some(w.to_ascii_uppercase()),
        _ => None,
    }
}

/// Analyzes an individual tokenized statement.
fn analyze_single_statement(tokens: &[Token]) -> SqlSafetyAnalysis {
    if tokens.is_empty() {
        return SqlSafetyAnalysis {
            is_destructive: false,
            danger_level: DangerLevel::Safe,
            operation: "EMPTY".to_string(),
            message: "Sentencia vacía.".to_string(),
            requires_explicit_confirmation: false,
            is_uncertain: false,
            affected_scope: None,
        };
    }

    // Extract word sequence (skipping parentheses, symbols, strings)
    let words: Vec<String> = tokens.iter().filter_map(word_upper).collect();
    if words.is_empty() {
        return SqlSafetyAnalysis {
            is_destructive: false,
            danger_level: DangerLevel::Safe,
            operation: "SELECT / READ".to_string(),
            message: "Consulta sin palabras clave operativas.".to_string(),
            requires_explicit_confirmation: false,
            is_uncertain: false,
            affected_scope: None,
        };
    }

    let first_word = &words[0];

    // Check for Common Table Expressions: WITH ...
    // E.g. WITH cte AS (...) DELETE FROM ... or WITH cte AS (...) UPDATE ...
    let effective_lead_idx = if first_word == "WITH" {
        // Find the main statement word after CTE definitions
        let mut found_lead: Option<usize> = None;
        let mut paren_depth = 0;
        let mut word_idx = 0;

        for tok in tokens {
            match tok {
                Token::ParenthesisOpen => paren_depth += 1,
                Token::ParenthesisClose => {
                    if paren_depth > 0 {
                        paren_depth -= 1;
                    }
                }
                Token::Word(w) => {
                    let u = w.to_ascii_uppercase();
                    if paren_depth == 0 && word_idx > 0 {
                        if matches!(
                            u.as_str(),
                            "DELETE"
                                | "UPDATE"
                                | "INSERT"
                                | "REPLACE"
                                | "SELECT"
                                | "DROP"
                                | "TRUNCATE"
                                | "ALTER"
                        ) {
                            found_lead = Some(word_idx);
                            break;
                        }
                    }
                    word_idx += 1;
                }
                _ => {}
            }
        }
        found_lead
    } else {
        Some(0)
    };

    let main_word = match effective_lead_idx {
        Some(idx) if idx < words.len() => &words[idx],
        _ => first_word,
    };

    match main_word.as_str() {
        "DROP" => {
            let entity = if words.contains(&"DATABASE".to_string()) || words.contains(&"SCHEMA".to_string()) {
                "DROP DATABASE"
            } else if words.contains(&"TABLE".to_string()) {
                "DROP TABLE"
            } else if words.contains(&"PROCEDURE".to_string()) {
                "DROP PROCEDURE"
            } else if words.contains(&"FUNCTION".to_string()) {
                "DROP FUNCTION"
            } else if words.contains(&"TRIGGER".to_string()) {
                "DROP TRIGGER"
            } else if words.contains(&"INDEX".to_string()) {
                "DROP INDEX"
            } else if words.contains(&"VIEW".to_string()) {
                "DROP VIEW"
            } else {
                "DROP"
            };

            SqlSafetyAnalysis {
                is_destructive: true,
                danger_level: DangerLevel::Critical,
                operation: entity.to_string(),
                message: format!(
                    "La sentencia '{entity}' destruirá de forma permanente e irreversible la estructura y los datos asociados (los DDL realizan autocommit implícito en MariaDB/MySQL)."
                ),
                requires_explicit_confirmation: true,
                is_uncertain: false,
                affected_scope: Some("DDL Permanente".to_string()),
            }
        }

        "TRUNCATE" => SqlSafetyAnalysis {
            is_destructive: true,
            danger_level: DangerLevel::Critical,
            operation: "TRUNCATE TABLE".to_string(),
            message: "La sentencia 'TRUNCATE TABLE' vaciará completamente la tabla y reiniciará sus contadores autoincrementales sin posibilidad de rollback transaccional.".to_string(),
            requires_explicit_confirmation: true,
            is_uncertain: false,
            affected_scope: Some("Tabla Completa".to_string()),
        },

        "DELETE" => {
            // Check whether a top-level WHERE exists (not inside a subquery)
            let has_where = check_has_top_level_where(tokens);

            if !has_where {
                SqlSafetyAnalysis {
                    is_destructive: true,
                    danger_level: DangerLevel::Critical,
                    operation: "DELETE (Sin WHERE)".to_string(),
                    message: "¡ALERTA CRÍTICA! 'DELETE' sin cláusula WHERE eliminará TODOS los registros de la tabla.".to_string(),
                    requires_explicit_confirmation: true,
                    is_uncertain: false,
                    affected_scope: Some("Tabla Completa".to_string()),
                }
            } else {
                SqlSafetyAnalysis {
                    is_destructive: true,
                    danger_level: DangerLevel::Medium,
                    operation: "DELETE".to_string(),
                    message: "La sentencia 'DELETE' eliminará registros de la tabla que coincidan con la condición WHERE especificada.".to_string(),
                    requires_explicit_confirmation: false,
                    is_uncertain: false,
                    affected_scope: Some("Filas Filtradas".to_string()),
                }
            }
        }

        "UPDATE" => {
            let has_where = check_has_top_level_where(tokens);

            if !has_where {
                SqlSafetyAnalysis {
                    is_destructive: true,
                    danger_level: DangerLevel::Critical,
                    operation: "UPDATE (Sin WHERE)".to_string(),
                    message: "¡ALERTA CRÍTICA! 'UPDATE' sin cláusula WHERE modificará o sobreescribirá TODOS los registros de la tabla.".to_string(),
                    requires_explicit_confirmation: true,
                    is_uncertain: false,
                    affected_scope: Some("Tabla Completa".to_string()),
                }
            } else {
                SqlSafetyAnalysis {
                    is_destructive: true,
                    danger_level: DangerLevel::Medium,
                    operation: "UPDATE".to_string(),
                    message: "La sentencia 'UPDATE' modificará registros en la tabla objetivo cumpliendo la condición WHERE.".to_string(),
                    requires_explicit_confirmation: false,
                    is_uncertain: false,
                    affected_scope: Some("Filas Filtradas".to_string()),
                }
            }
        }

        "ALTER" => SqlSafetyAnalysis {
            is_destructive: true,
            danger_level: DangerLevel::Medium,
            operation: "ALTER TABLE / SCHEMA".to_string(),
            message: "La sentencia 'ALTER' modificará la definición o estructura existente de la tabla o esquema (autocommit implícito).".to_string(),
            requires_explicit_confirmation: false,
            is_uncertain: false,
            affected_scope: Some("Estructura DDL".to_string()),
        },

        "RENAME" => SqlSafetyAnalysis {
            is_destructive: true,
            danger_level: DangerLevel::Medium,
            operation: "RENAME TABLE".to_string(),
            message: "La sentencia 'RENAME' cambiará el nombre de una o más tablas o estructuras.".to_string(),
            requires_explicit_confirmation: false,
            is_uncertain: false,
            affected_scope: Some("Estructura DDL".to_string()),
        },

        "CALL" => SqlSafetyAnalysis {
            is_destructive: true,
            danger_level: DangerLevel::Medium,
            operation: "CALL PROCEDURE".to_string(),
            message: "La ejecución de un procedimiento almacenado ('CALL') puede invocar operaciones de modificación o DDL internos no inspeccionables estáticamente.".to_string(),
            requires_explicit_confirmation: false,
            is_uncertain: true,
            affected_scope: Some("Procedimiento / Efectos Secundarios".to_string()),
        },

        "GRANT" | "REVOKE" => SqlSafetyAnalysis {
            is_destructive: true,
            danger_level: DangerLevel::Medium,
            operation: format!("{main_word} PRIVILEGES"),
            message: format!("La sentencia '{main_word}' modificará los privilegios y permisos de acceso en el servidor."),
            requires_explicit_confirmation: false,
            is_uncertain: false,
            affected_scope: Some("Seguridad de Usuarios".to_string()),
        },

        "INSERT" | "REPLACE" => SqlSafetyAnalysis {
            is_destructive: true,
            danger_level: DangerLevel::Medium,
            operation: main_word.to_string(),
            message: format!("La sentencia '{main_word}' insertará o reemplazará registros en la base de datos."),
            requires_explicit_confirmation: false,
            is_uncertain: false,
            affected_scope: Some("Inserción de Registros".to_string()),
        },

        "SELECT" | "SHOW" | "DESCRIBE" | "DESC" | "EXPLAIN" => SqlSafetyAnalysis {
            is_destructive: false,
            danger_level: DangerLevel::Safe,
            operation: "SELECT / READ".to_string(),
            message: "Consulta segura de sólo lectura.".to_string(),
            requires_explicit_confirmation: false,
            is_uncertain: false,
            affected_scope: None,
        },

        _ => {
            // Unrecognized or complex SQL statement: apply explicit conservative policy
            SqlSafetyAnalysis {
                is_destructive: true,
                danger_level: DangerLevel::Medium,
                operation: format!("UNKNOWN ({main_word})"),
                message: format!(
                    "Sentencia SQL con sintaxis no categorizable con certeza ('{main_word}'). Se aplica política conservadora de Modo Seguro."
                ),
                requires_explicit_confirmation: false,
                is_uncertain: true,
                affected_scope: Some("No evaluado".to_string()),
            }
        }
    }
}

/// Checks if there is a WHERE keyword at depth 0 (outside parentheses),
/// so that WHERE in a subquery does not deceive a main DELETE/UPDATE without WHERE.
fn check_has_top_level_where(tokens: &[Token]) -> bool {
    let mut depth = 0;
    for tok in tokens {
        match tok {
            Token::ParenthesisOpen => depth += 1,
            Token::ParenthesisClose => {
                if depth > 0 {
                    depth -= 1;
                }
            }
            Token::Word(w) => {
                if depth == 0 && w.eq_ignore_ascii_case("WHERE") {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

/// Analyzes an SQL script (one or multiple statements) to assess destructive impact.
/// Safe Mode is a defensive safeguard and not a guarantee of absolute safety.
pub fn analyze_sql_safety(sql: &str) -> SqlSafetyAnalysis {
    let tokens = tokenize_sql(sql);
    let statements = split_statements(&tokens);

    if statements.is_empty() {
        return SqlSafetyAnalysis {
            is_destructive: false,
            danger_level: DangerLevel::Safe,
            operation: "SELECT / READ".to_string(),
            message: "Consulta vacía o sin sentencias ejecutables.".to_string(),
            requires_explicit_confirmation: false,
            is_uncertain: false,
            affected_scope: None,
        };
    }

    let mut highest_danger = DangerLevel::Safe;
    let mut chosen_analysis = SqlSafetyAnalysis {
        is_destructive: false,
        danger_level: DangerLevel::Safe,
        operation: "SELECT / READ".to_string(),
        message: "Consulta segura de lectura.".to_string(),
        requires_explicit_confirmation: false,
        is_uncertain: false,
        affected_scope: None,
    };

    for stmt_tokens in statements {
        let analysis = analyze_single_statement(&stmt_tokens);

        match (analysis.danger_level, highest_danger) {
            (DangerLevel::Critical, _) => {
                // Critical always overrides and stops further checks
                return analysis;
            }
            (DangerLevel::Medium, DangerLevel::Safe) => {
                highest_danger = DangerLevel::Medium;
                chosen_analysis = analysis;
            }
            (DangerLevel::Medium, DangerLevel::Medium) => {
                // If already Medium, prefer one that requires confirmation or has uncertainty
                if analysis.requires_explicit_confirmation || analysis.is_uncertain {
                    chosen_analysis = analysis;
                }
            }
            _ => {}
        }
    }

    chosen_analysis
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clean_sql_statement() {
        let sql = r#"
            -- This is a comment
            # Another comment
            /* Multi-line
               comment */
            SELECT * FROM users;
        "#;
        let cleaned = clean_sql_statement(sql);
        assert_eq!(cleaned, "SELECT * FROM users;");
    }

    #[test]
    fn test_analyze_drop_table() {
        let sql = "DROP TABLE IF EXISTS users;";
        let analysis = analyze_sql_safety(sql);
        assert!(analysis.is_destructive);
        assert_eq!(analysis.danger_level, DangerLevel::Critical);
        assert_eq!(analysis.operation, "DROP TABLE");
        assert!(analysis.requires_explicit_confirmation);
    }

    #[test]
    fn test_analyze_truncate() {
        let sql = "TRUNCATE TABLE logs;";
        let analysis = analyze_sql_safety(sql);
        assert!(analysis.is_destructive);
        assert_eq!(analysis.danger_level, DangerLevel::Critical);
        assert_eq!(analysis.operation, "TRUNCATE TABLE");
        assert!(analysis.requires_explicit_confirmation);
    }

    #[test]
    fn test_analyze_delete_without_where() {
        let sql = "DELETE FROM orders;";
        let analysis = analyze_sql_safety(sql);
        assert!(analysis.is_destructive);
        assert_eq!(analysis.danger_level, DangerLevel::Critical);
        assert!(analysis.requires_explicit_confirmation);
    }

    #[test]
    fn test_analyze_delete_with_where() {
        let sql = "DELETE FROM orders WHERE status = 'cancelled';";
        let analysis = analyze_sql_safety(sql);
        assert!(analysis.is_destructive);
        assert_eq!(analysis.danger_level, DangerLevel::Medium);
        assert!(!analysis.requires_explicit_confirmation);
    }

    #[test]
    fn test_analyze_update_without_where() {
        let sql = "UPDATE users SET active = 0;";
        let analysis = analyze_sql_safety(sql);
        assert!(analysis.is_destructive);
        assert_eq!(analysis.danger_level, DangerLevel::Critical);
        assert!(analysis.requires_explicit_confirmation);
    }

    #[test]
    fn test_analyze_select_is_safe() {
        let sql = "SELECT * FROM customers WHERE id = 10;";
        let analysis = analyze_sql_safety(sql);
        assert!(!analysis.is_destructive);
        assert_eq!(analysis.danger_level, DangerLevel::Safe);
    }

    // --- NUEVAS PRUEBAS ROBUSTAS P0 ---

    #[test]
    fn test_select_with_dangerous_literal_is_safe() {
        // String literal containing DROP TABLE or UPDATE without WHERE
        let sql =
            "SELECT * FROM logs WHERE message = 'DROP TABLE users; UPDATE accounts SET bal = 0';";
        let analysis = analyze_sql_safety(sql);
        assert!(!analysis.is_destructive);
        assert_eq!(analysis.danger_level, DangerLevel::Safe);
    }

    #[test]
    fn test_update_with_where_in_string_literal_is_critical() {
        // UPDATE without WHERE where string literal contains " WHERE "
        let sql = "UPDATE configs SET config_val = ' WHERE 1=1 ';";
        let analysis = analyze_sql_safety(sql);
        assert!(analysis.is_destructive);
        assert_eq!(analysis.danger_level, DangerLevel::Critical);
        assert!(analysis.operation.contains("Sin WHERE"));
    }

    #[test]
    fn test_cte_with_delete_without_where() {
        // CTE preceding DELETE
        let sql = "WITH old_orders AS (SELECT id FROM orders WHERE created_at < NOW()) DELETE FROM orders;";
        let analysis = analyze_sql_safety(sql);
        assert!(analysis.is_destructive);
        assert_eq!(analysis.danger_level, DangerLevel::Critical);
        assert!(analysis.operation.contains("Sin WHERE"));
    }

    #[test]
    fn test_multi_statement_with_hidden_drop() {
        // Multiple statements with comments and strings containing semicolons
        let sql = "SELECT 'hello; world' AS col; -- safe read\n DROP TABLE sensitive_data;";
        let analysis = analyze_sql_safety(sql);
        assert!(analysis.is_destructive);
        assert_eq!(analysis.danger_level, DangerLevel::Critical);
        assert_eq!(analysis.operation, "DROP TABLE");
    }

    #[test]
    fn test_call_stored_procedure_is_classified_as_medium_uncertain() {
        let sql = "CALL purge_old_data('2024-01-01');";
        let analysis = analyze_sql_safety(sql);
        assert!(analysis.is_destructive);
        assert_eq!(analysis.danger_level, DangerLevel::Medium);
        assert!(analysis.is_uncertain);
    }

    #[test]
    fn test_delete_with_subquery_where_is_medium() {
        let sql = "DELETE FROM users WHERE id IN (SELECT user_id FROM inactive_users);";
        let analysis = analyze_sql_safety(sql);
        assert!(analysis.is_destructive);
        assert_eq!(analysis.danger_level, DangerLevel::Medium);
    }

    #[test]
    fn test_backtick_identifier_with_reserved_word() {
        let sql = "SELECT `drop`, `delete` FROM `table_stats` WHERE `id` = 1;";
        let analysis = analyze_sql_safety(sql);
        assert!(!analysis.is_destructive);
        assert_eq!(analysis.danger_level, DangerLevel::Safe);
    }
}
