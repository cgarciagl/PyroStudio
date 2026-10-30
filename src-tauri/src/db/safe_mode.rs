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
    /// Represents an unclosed string or block comment, signaling syntactically malformed SQL
    UnclosedSyntax(&'static str),
    /// DELIMITER directive token (e.g. DELIMITER // or DELIMITER ;)
    DelimiterDirective(String),
}

/// Returns true if a line comment starts at `i`.
///
/// In MySQL/MariaDB `#` always starts a comment, but `--` only does when it is
/// followed by whitespace, a control character or the end of input: `1 --1`
/// is "1 minus minus 1", not a comment.
fn is_line_comment_start(chars: &[char], i: usize) -> bool {
    match chars.get(i) {
        Some('#') => true,
        Some('-') => {
            chars.get(i + 1) == Some(&'-')
                && chars
                    .get(i + 2)
                    .is_none_or(|c| c.is_whitespace() || c.is_control())
        }
        _ => false,
    }
}

/// If an executable comment (`/*!`, `/*M!` or `/*!M`) starts at `i`, returns
/// the length of its opening marker (without version digits).
fn executable_comment_marker_len(chars: &[char], i: usize) -> Option<usize> {
    if chars.get(i) != Some(&'/') || chars.get(i + 1) != Some(&'*') {
        return None;
    }
    match (chars.get(i + 2), chars.get(i + 3)) {
        (Some('!'), Some('M')) => Some(4),
        (Some('!'), _) => Some(3),
        (Some('M'), Some('!')) => Some(4),
        _ => None,
    }
}

/// Tokenizes an SQL string taking into account single quotes, double quotes,
/// backtick identifiers, comments (-- and # and /* */), MySQL executable comments (/*! ... */),
/// escape sequences, and DELIMITER client directives.
pub fn tokenize_sql(sql: &str) -> Vec<Token> {
    let mut tokens = Vec::new();
    let chars: Vec<char> = sql.chars().collect();
    let len = chars.len();
    let mut i = 0;
    // Custom client delimiter set by a DELIMITER directive (None = `;`).
    let mut delimiter: Option<Vec<char>> = None;

    while i < len {
        let c = chars[i];

        // 1. Skip whitespace
        if c.is_whitespace() {
            i += 1;
            continue;
        }

        // 1b. A custom delimiter acts as a statement separator
        if let Some(d) = &delimiter {
            if chars[i..].starts_with(d) {
                tokens.push(Token::Semicolon);
                i += d.len();
                continue;
            }
        }

        // 2. Line comment: `-- ` or #
        if is_line_comment_start(&chars, i) {
            while i < len && chars[i] != '\n' && chars[i] != '\r' {
                i += 1;
            }
            continue;
        }

        // 3. MySQL executable comment /*! ... */ vs standard block comment /* ... */
        if c == '/' && i + 1 < len && chars[i + 1] == '*' {
            if let Some(marker_len) = executable_comment_marker_len(&chars, i) {
                // Executable comment: /*!50000 DROP TABLE t */, /*! DROP TABLE t */ or
                // MariaDB's /*M!100100 DROP TABLE t */.
                // The contents inside are executed by MySQL/MariaDB!
                // Skip the marker and optional version digits (5 or 6 digits)
                i += marker_len;
                let mut digit_count = 0;
                while i < len && chars[i].is_ascii_digit() && digit_count < 6 {
                    i += 1;
                    digit_count += 1;
                }
                // Now parse inner tokens until closing "*/"
                let mut inner_sql = String::new();
                let mut closed = false;
                while i + 1 < len {
                    if chars[i] == '*' && chars[i + 1] == '/' {
                        i += 2;
                        closed = true;
                        break;
                    }
                    inner_sql.push(chars[i]);
                    i += 1;
                }
                if !closed {
                    tokens.push(Token::UnclosedSyntax("Comentario ejecutable no cerrado"));
                    break;
                }
                // Tokenize inner executable statements and append them
                let inner_tokens = tokenize_sql(&inner_sql);
                tokens.extend(inner_tokens);
                continue;
            } else {
                // Standard block comment: /* ... */
                i += 2;
                let mut closed = false;
                while i + 1 < len {
                    if chars[i] == '*' && chars[i + 1] == '/' {
                        i += 2;
                        closed = true;
                        break;
                    }
                    i += 1;
                }
                if !closed {
                    tokens.push(Token::UnclosedSyntax("Comentario de bloque no cerrado"));
                    break;
                }
                continue;
            }
        }

        // 4. String literal: '...' or "..."
        if c == '\'' || c == '"' {
            let quote = c;
            let mut lit = String::new();
            let mut closed = false;
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
                        closed = true;
                        break;
                    }
                } else {
                    lit.push(chars[i]);
                    i += 1;
                }
            }
            if !closed {
                tokens.push(Token::UnclosedSyntax("Literal de cadena no cerrado"));
                tokens.push(Token::StringLiteral(lit));
                break;
            }
            tokens.push(Token::StringLiteral(lit));
            continue;
        }

        // 5. Backtick identifier: `...`
        if c == '`' {
            let mut ident = String::new();
            let mut closed = false;
            i += 1;
            while i < len {
                if chars[i] == '`' {
                    if i + 1 < len && chars[i + 1] == '`' {
                        ident.push('`');
                        i += 2;
                    } else {
                        i += 1;
                        closed = true;
                        break;
                    }
                } else {
                    ident.push(chars[i]);
                    i += 1;
                }
            }
            if !closed {
                tokens.push(Token::UnclosedSyntax(
                    "Identificador entre comillas invertidas no cerrado",
                ));
                tokens.push(Token::BacktickIdentifier(ident));
                break;
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

            // Check if this word is client-side DELIMITER directive
            if word.eq_ignore_ascii_case("DELIMITER")
                && (tokens.is_empty() || matches!(tokens.last(), Some(Token::Semicolon)))
            {
                // Consume trailing whitespace and extract the new delimiter string
                while i < len && chars[i].is_whitespace() && chars[i] != '\n' && chars[i] != '\r' {
                    i += 1;
                }
                let mut delim = String::new();
                while i < len && !chars[i].is_whitespace() {
                    delim.push(chars[i]);
                    i += 1;
                }
                delimiter = if delim.is_empty() || delim == ";" {
                    None
                } else {
                    Some(delim.chars().collect())
                };
                tokens.push(Token::DelimiterDirective(delim));
                // The directive is a statement on its own
                tokens.push(Token::Semicolon);
                continue;
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
        // Quoted strings and identifiers are copied verbatim
        if matches!(chars[i], '\'' | '"' | '`') {
            let quote = chars[i];
            cleaned.push(quote);
            i += 1;
            while i < len {
                let ch = chars[i];
                cleaned.push(ch);
                i += 1;
                if ch == '\\' && quote != '`' && i < len {
                    cleaned.push(chars[i]);
                    i += 1;
                } else if ch == quote {
                    if i < len && chars[i] == quote {
                        cleaned.push(quote);
                        i += 1;
                    } else {
                        break;
                    }
                }
            }
            continue;
        }

        // Line comment `-- ` or #
        if is_line_comment_start(&chars, i) {
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
            i = (i + 2).min(len);
            continue;
        }

        cleaned.push(chars[i]);
        i += 1;
    }

    cleaned.trim().to_string()
}

/// Returns true when the first statement produces a result set (SELECT, CTEs
/// ending in SELECT, SHOW, DESCRIBE, EXPLAIN, VALUES, TABLE...).
/// `WITH ... UPDATE/DELETE` is resolved by the first top-level keyword after the CTE list.
pub fn returns_result_set(sql: &str) -> bool {
    let tokens = tokenize_sql(sql);
    let Some(stmt) = split_statements(&tokens).into_iter().next() else {
        return false;
    };
    let mut depth = 0usize;
    let mut lead: Option<String> = None;
    for tok in &stmt {
        match tok {
            Token::ParenthesisOpen => depth += 1,
            Token::ParenthesisClose => depth = depth.saturating_sub(1),
            _ => {}
        }
        let Some(w) = word_upper(tok) else { continue };
        if lead.is_none() {
            lead = Some(w);
            if lead.as_deref() != Some("WITH") {
                break;
            }
        } else if depth == 0
            && matches!(
                w.as_str(),
                "SELECT" | "TABLE" | "VALUES" | "UPDATE" | "DELETE" | "INSERT" | "REPLACE"
            )
        {
            return matches!(w.as_str(), "SELECT" | "TABLE" | "VALUES");
        }
    }
    if lead.as_deref() == Some("PRAGMA") {
        let has_assignment = stmt.iter().any(|t| matches!(t, Token::Symbol('=')));
        return !has_assignment;
    }
    matches!(
        lead.as_deref(),
        Some("SELECT" | "SHOW" | "DESCRIBE" | "DESC" | "EXPLAIN" | "VALUES" | "TABLE" | "WITH")
    )
}

/// Returns true if any statement in the SQL script produces a result set.
pub fn contains_result_set(sql: &str) -> bool {
    let tokens = tokenize_sql(sql);
    let statements = split_statements(&tokens);
    for stmt in &statements {
        let mut depth = 0usize;
        let mut lead: Option<String> = None;
        for tok in stmt {
            match tok {
                Token::ParenthesisOpen => depth += 1,
                Token::ParenthesisClose => depth = depth.saturating_sub(1),
                _ => {}
            }
            let Some(w) = word_upper(tok) else { continue };
            if lead.is_none() {
                lead = Some(w);
                if lead.as_deref() != Some("WITH") {
                    break;
                }
            } else if depth == 0 && matches!(w.as_str(), "SELECT" | "TABLE" | "VALUES") {
                return true;
            }
        }
        if lead.as_deref() == Some("PRAGMA") {
            let has_assignment = stmt.iter().any(|t| matches!(t, Token::Symbol('=')));
            if !has_assignment {
                return true;
            }
        } else if matches!(
            lead.as_deref(),
            Some("SELECT" | "SHOW" | "DESCRIBE" | "DESC" | "EXPLAIN" | "VALUES" | "TABLE" | "WITH")
        ) {
            return true;
        }
    }
    false
}

/// Helper to extract word string in uppercase if token is Word
fn word_upper(tok: &Token) -> Option<String> {
    match tok {
        Token::Word(w) => Some(w.to_ascii_uppercase()),
        _ => None,
    }
}

/// Analyzes an individual tokenized statement, escalating read-only results
/// that hide side effects (file writes, sleeps, nested writes).
fn analyze_single_statement(tokens: &[Token]) -> SqlSafetyAnalysis {
    let base = classify_statement(tokens);
    if base.danger_level == DangerLevel::Critical {
        return base;
    }
    escalate_side_effects(tokens, base)
}

fn escalate_side_effects(tokens: &[Token], base: SqlSafetyAnalysis) -> SqlSafetyAnalysis {
    let mut side_effect: Option<&'static str> = None;
    let mut nested_write: Option<String> = None;
    let mut prev_word: Option<String> = None;

    for (idx, tok) in tokens.iter().enumerate() {
        let Some(w) = word_upper(tok) else {
            continue;
        };
        let is_call = matches!(tokens.get(idx + 1), Some(Token::ParenthesisOpen));

        if prev_word.as_deref() == Some("INTO") && (w == "OUTFILE" || w == "DUMPFILE") {
            return SqlSafetyAnalysis {
                is_destructive: true,
                danger_level: DangerLevel::Critical,
                operation: format!("SELECT INTO {w}"),
                message: format!(
                    "La sentencia escribe un archivo en el sistema de archivos del servidor ('INTO {w}'). Puede sobrescribir archivos o exponer información sensible."
                ),
                requires_explicit_confirmation: true,
                is_uncertain: false,
                affected_scope: Some("Sistema de archivos del servidor".to_string()),
            };
        }

        if is_call {
            side_effect = side_effect.or(match w.as_str() {
                "LOAD_FILE" => Some("LOAD_FILE"),
                "SLEEP" => Some("SLEEP"),
                "BENCHMARK" => Some("BENCHMARK"),
                _ => None,
            });
        } else if idx > 0
            && matches!(
                w.as_str(),
                "DELETE" | "UPDATE" | "INSERT" | "REPLACE" | "DROP" | "TRUNCATE" | "ALTER"
            )
            // SELECT ... FOR UPDATE / ON DUPLICATE KEY UPDATE are not nested writes
            && !(w == "UPDATE" && matches!(prev_word.as_deref(), Some("FOR" | "KEY")))
        {
            nested_write.get_or_insert(w.clone());
        }

        prev_word = Some(w);
    }

    if base.danger_level != DangerLevel::Safe {
        return base;
    }

    if let Some(func) = side_effect {
        return SqlSafetyAnalysis {
            is_destructive: true,
            danger_level: DangerLevel::Medium,
            operation: format!("SELECT con {func}()"),
            message: format!(
                "La consulta invoca '{func}()', que lee archivos del servidor o consume recursos durante su ejecución."
            ),
            requires_explicit_confirmation: false,
            is_uncertain: false,
            affected_scope: Some("Efectos secundarios en el servidor".to_string()),
        };
    }

    let lead = tokens.iter().find_map(word_upper);
    if let (Some("SELECT" | "WITH"), Some(w)) = (lead.as_deref(), nested_write) {
        return SqlSafetyAnalysis {
            is_destructive: true,
            danger_level: DangerLevel::Medium,
            operation: format!("UNKNOWN ({w} anidado)"),
            message: format!(
                "La consulta contiene '{w}' en una posición no reconocida. Se aplica política conservadora de Modo Seguro."
            ),
            requires_explicit_confirmation: true,
            is_uncertain: true,
            affected_scope: Some("No evaluado".to_string()),
        };
    }

    base
}

/// Classifies an individual tokenized statement by its leading keyword.
fn classify_statement(tokens: &[Token]) -> SqlSafetyAnalysis {
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

    // 1. Check for client-side DELIMITER directive (always a statement on its own)
    if let [Token::DelimiterDirective(d)] = tokens {
        return SqlSafetyAnalysis {
            is_destructive: false,
            danger_level: DangerLevel::Safe,
            operation: format!("DELIMITER {d}"),
            message: format!("Directiva de cliente SQL para cambiar delimitador a '{d}'."),
            requires_explicit_confirmation: false,
            is_uncertain: false,
            affected_scope: None,
        };
    }

    // 2. Check for unclosed syntax (malformed input or unclosed string/comment)
    if let Some(Token::UnclosedSyntax(reason)) = tokens
        .iter()
        .find(|t| matches!(t, Token::UnclosedSyntax(_)))
    {
        return SqlSafetyAnalysis {
            is_destructive: true,
            danger_level: DangerLevel::Medium,
            operation: "MALFORMED_SQL".to_string(),
            message: format!("Sintaxis SQL malformada o incompleta ({reason}). Se aplica política conservadora de Modo Seguro."),
            requires_explicit_confirmation: true,
            is_uncertain: true,
            affected_scope: Some("No evaluado / Error sintáctico".to_string()),
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
                    if paren_depth == 0
                        && word_idx > 0
                        && matches!(
                            u.as_str(),
                            "DELETE"
                                | "UPDATE"
                                | "INSERT"
                                | "REPLACE"
                                | "SELECT"
                                | "DROP"
                                | "TRUNCATE"
                                | "ALTER"
                        )
                    {
                        found_lead = Some(word_idx);
                        break;
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
            requires_explicit_confirmation: true,
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

        "CREATE" => SqlSafetyAnalysis {
            is_destructive: true,
            danger_level: DangerLevel::Medium,
            operation: "CREATE".to_string(),
            message: "La sentencia 'CREATE' creará o reemplazará objetos de esquema (autocommit implícito).".to_string(),
            requires_explicit_confirmation: false,
            is_uncertain: false,
            affected_scope: Some("Estructura DDL".to_string()),
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

        "SELECT" | "SHOW" | "DESCRIBE" | "DESC" | "EXPLAIN" | "USE" => SqlSafetyAnalysis {
            is_destructive: false,
            danger_level: DangerLevel::Safe,
            operation: "SELECT / READ".to_string(),
            message: "Consulta segura de sólo lectura.".to_string(),
            requires_explicit_confirmation: false,
            is_uncertain: false,
            affected_scope: None,
        },

        "SET" => SqlSafetyAnalysis {
            is_destructive: false,
            danger_level: DangerLevel::Safe,
            operation: "SET VARIABLE".to_string(),
            message: "Configuración de variable de sesión.".to_string(),
            requires_explicit_confirmation: false,
            is_uncertain: false,
            affected_scope: None,
        },

        "BEGIN" | "START" | "COMMIT" | "ROLLBACK" | "SAVEPOINT" | "RELEASE" => SqlSafetyAnalysis {
            is_destructive: false,
            danger_level: DangerLevel::Safe,
            operation: format!("TRANSACTION ({main_word})"),
            message: format!("Control de transacción SQL ({main_word})."),
            requires_explicit_confirmation: false,
            is_uncertain: false,
            affected_scope: None,
        },

        "VACUUM" | "REINDEX" => SqlSafetyAnalysis {
            is_destructive: false,
            danger_level: DangerLevel::Safe,
            operation: format!("MAINTENANCE ({main_word})"),
            message: format!("Mantenimiento u optimización de base de datos ({main_word})."),
            requires_explicit_confirmation: false,
            is_uncertain: false,
            affected_scope: Some("Mantenimiento".to_string()),
        },

        "ATTACH" | "DETACH" => SqlSafetyAnalysis {
            is_destructive: false,
            danger_level: DangerLevel::Safe,
            operation: format!("DATABASE ({main_word})"),
            message: format!("Gestión de esquemas en SQLite ({main_word})."),
            requires_explicit_confirmation: false,
            is_uncertain: false,
            affected_scope: Some("Esquemas".to_string()),
        },

        "PRAGMA" => {
            let mut pragma_name = "PRAGMA".to_string();
            let mut is_write = false;

            // The name is the last word before `=` / `(`, so a schema prefix
            // (`PRAGMA main.writable_schema = 1`) does not hide it.
            let mut name_done = false;
            for (idx, tok) in tokens.iter().enumerate() {
                if matches!(tok, Token::Symbol('=') | Token::ParenthesisOpen) {
                    name_done = true;
                }
                if let Token::Word(w) = tok {
                    if idx > 0 && !name_done {
                        pragma_name = w.to_ascii_uppercase();
                    }
                }
                if matches!(tok, Token::Symbol('=')) {
                    is_write = true;
                }
            }

            let is_info_pragma = matches!(
                pragma_name.as_str(),
                "TABLE_INFO"
                    | "TABLE_XINFO"
                    | "TABLE_LIST"
                    | "INDEX_LIST"
                    | "INDEX_INFO"
                    | "INDEX_XINFO"
                    | "FOREIGN_KEY_LIST"
                    | "FOREIGN_KEY_CHECK"
                    | "DATABASE_LIST"
                    | "COLLATION_LIST"
                    | "COMPILE_OPTIONS"
                    | "INTEGRITY_CHECK"
                    | "QUICK_CHECK"
            );

            let has_open_paren = tokens.iter().any(|t| matches!(t, Token::ParenthesisOpen));
            if has_open_paren && !is_info_pragma {
                is_write = true;
            }

            if is_write {
                let is_critical = pragma_name == "WRITABLE_SCHEMA";
                SqlSafetyAnalysis {
                    is_destructive: is_critical,
                    danger_level: if is_critical {
                        DangerLevel::Critical
                    } else {
                        DangerLevel::Safe
                    },
                    operation: format!("PRAGMA SET ({pragma_name})"),
                    message: format!(
                        "Modificación de configuración interna SQLite ('{pragma_name}')."
                    ),
                    requires_explicit_confirmation: is_critical,
                    is_uncertain: false,
                    affected_scope: Some("Configuración de SQLite".to_string()),
                }
            } else {
                SqlSafetyAnalysis {
                    is_destructive: false,
                    danger_level: DangerLevel::Safe,
                    operation: format!("PRAGMA ({pragma_name})"),
                    message: format!("Consulta de metadatos o configuración SQLite ('{pragma_name}')."),
                    requires_explicit_confirmation: false,
                    is_uncertain: false,
                    affected_scope: None,
                }
            }
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
                requires_explicit_confirmation: true,
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
            Token::Word(w) if depth == 0 && w.eq_ignore_ascii_case("WHERE") => {
                return true;
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

    let mut chosen_analysis = analyze_single_statement(&statements[0]);
    let mut highest_danger = chosen_analysis.danger_level;

    for stmt_tokens in statements.iter().skip(1) {
        let analysis = analyze_single_statement(stmt_tokens);

        match (analysis.danger_level, highest_danger) {
            (DangerLevel::Critical, _) => {
                // Critical always overrides and stops further checks
                return analysis;
            }
            (DangerLevel::Medium, DangerLevel::Safe) => {
                highest_danger = DangerLevel::Medium;
                chosen_analysis = analysis;
            }
            (DangerLevel::Medium, DangerLevel::Medium)
                // If already Medium, prefer one that requires confirmation or has uncertainty
                if (analysis.requires_explicit_confirmation || analysis.is_uncertain) => {
                    chosen_analysis = analysis;
                }
            _ => {}
        }
    }

    chosen_analysis
}

/// Attempts to transform a DELETE or UPDATE statement into a SELECT COUNT(*) query
/// to calculate the number of affected rows before execution.
pub fn build_affected_count_query(sql: &str) -> Option<String> {
    let clean = clean_sql_statement(sql);
    let tokens = tokenize_sql(&clean);
    if tokens.is_empty() {
        return None;
    }

    let first_word = match &tokens[0] {
        Token::Word(w) => w.to_uppercase(),
        _ => return None,
    };

    if first_word == "DELETE" {
        let from_pos = tokens.iter().position(|t| match t {
            Token::Word(w) => w.eq_ignore_ascii_case("FROM"),
            _ => false,
        })?;

        let from_tokens = &tokens[from_pos..];
        let mut from_sql = String::new();
        for t in from_tokens {
            match t {
                Token::Word(w) => {
                    from_sql.push_str(w);
                    from_sql.push(' ');
                }
                Token::StringLiteral(s) => {
                    from_sql.push('\'');
                    from_sql.push_str(&s.replace('\'', "''"));
                    from_sql.push_str("' ");
                }
                Token::BacktickIdentifier(s) => {
                    from_sql.push('`');
                    from_sql.push_str(&s.replace('`', "``"));
                    from_sql.push_str("` ");
                }
                Token::Semicolon => break,
                Token::ParenthesisOpen => from_sql.push_str("( "),
                Token::ParenthesisClose => from_sql.push_str(") "),
                Token::Symbol(c) => {
                    from_sql.push(*c);
                    from_sql.push(' ');
                }
                _ => {}
            }
        }
        return Some(format!(
            "SELECT COUNT(*) AS affected_count {}",
            from_sql.trim()
        ));
    } else if first_word == "UPDATE" {
        let set_pos = tokens.iter().position(|t| match t {
            Token::Word(w) => w.eq_ignore_ascii_case("SET"),
            _ => false,
        })?;

        let mut table_tokens = Vec::new();
        for t in &tokens[1..set_pos] {
            match t {
                Token::Word(w)
                    if w.eq_ignore_ascii_case("LOW_PRIORITY")
                        || w.eq_ignore_ascii_case("IGNORE") => {}
                _ => table_tokens.push(t),
            }
        }

        let mut table_sql = String::new();
        for t in table_tokens {
            match t {
                Token::Word(w) => {
                    table_sql.push_str(w);
                    table_sql.push(' ');
                }
                Token::BacktickIdentifier(s) => {
                    table_sql.push('`');
                    table_sql.push_str(&s.replace('`', "``"));
                    table_sql.push_str("` ");
                }
                Token::Symbol(c) => {
                    table_sql.push(*c);
                    table_sql.push(' ');
                }
                _ => {}
            }
        }

        let where_pos = tokens.iter().position(|t| match t {
            Token::Word(w) => w.eq_ignore_ascii_case("WHERE"),
            _ => false,
        });

        let mut where_sql = String::new();
        if let Some(wpos) = where_pos {
            for t in &tokens[wpos..] {
                match t {
                    Token::Word(w) => {
                        where_sql.push_str(w);
                        where_sql.push(' ');
                    }
                    Token::StringLiteral(s) => {
                        where_sql.push('\'');
                        where_sql.push_str(&s.replace('\'', "''"));
                        where_sql.push_str("' ");
                    }
                    Token::BacktickIdentifier(s) => {
                        where_sql.push('`');
                        where_sql.push_str(&s.replace('`', "``"));
                        where_sql.push_str("` ");
                    }
                    Token::Semicolon => break,
                    Token::ParenthesisOpen => where_sql.push_str("( "),
                    Token::ParenthesisClose => where_sql.push_str(") "),
                    Token::Symbol(c) => {
                        where_sql.push(*c);
                        where_sql.push(' ');
                    }
                    _ => {}
                }
            }
        }

        let where_clause = if where_sql.is_empty() {
            String::new()
        } else {
            format!(" {}", where_sql.trim())
        };

        return Some(format!(
            "SELECT COUNT(*) AS affected_count FROM {}{}",
            table_sql.trim(),
            where_clause
        ));
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_returns_result_set() {
        assert!(returns_result_set("SELECT 1"));
        assert!(returns_result_set("  -- comentario\n select * from t"));
        assert!(returns_result_set("(SELECT 1) UNION (SELECT 2)"));
        assert!(returns_result_set("DESC t"));
        assert!(returns_result_set(
            "WITH c AS (SELECT a, NTILE(4) OVER (ORDER BY a) q FROM t WHERE a IS NOT NULL) \
             SELECT q, COUNT(*) FROM c GROUP BY q ORDER BY q;"
        ));
        assert!(returns_result_set(
            "WITH RECURSIVE n (x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 5) SELECT x FROM n"
        ));
        assert!(!returns_result_set(
            "WITH c AS (SELECT id FROM t) UPDATE t JOIN c USING (id) SET t.a = 1"
        ));
        assert!(!returns_result_set(
            "WITH c AS (SELECT id FROM t) DELETE FROM t"
        ));
        assert!(!returns_result_set("UPDATE t SET a = 1"));
        assert!(!returns_result_set("INSERT INTO t SELECT * FROM u"));
        assert!(!returns_result_set(""));
    }

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

    #[test]
    fn test_mysql_executable_comment_with_drop() {
        let sql = "/*!50000 DROP TABLE audit_log */;";
        let analysis = analyze_sql_safety(sql);
        assert!(analysis.is_destructive);
        assert_eq!(analysis.danger_level, DangerLevel::Critical);
        assert_eq!(analysis.operation, "DROP TABLE");
    }

    #[test]
    fn test_unclosed_string_literal_is_conservative_medium() {
        let sql = "SELECT * FROM users WHERE name = 'unclosed string literal";
        let analysis = analyze_sql_safety(sql);
        assert!(analysis.is_destructive);
        assert_eq!(analysis.danger_level, DangerLevel::Medium);
        assert!(analysis.is_uncertain);
        assert_eq!(analysis.operation, "MALFORMED_SQL");
    }

    #[test]
    fn test_delimiter_directive_is_safe() {
        let sql = "DELIMITER //";
        let analysis = analyze_sql_safety(sql);
        assert!(!analysis.is_destructive);
        assert_eq!(analysis.danger_level, DangerLevel::Safe);
        assert!(analysis.operation.starts_with("DELIMITER"));
    }

    #[test]
    fn test_transactions_and_session_commands_are_safe() {
        let sql_tx = "START TRANSACTION; SELECT 1; COMMIT;";
        let analysis = analyze_sql_safety(sql_tx);
        assert!(!analysis.is_destructive);
        assert_eq!(analysis.danger_level, DangerLevel::Safe);

        let sql_set = "SET @my_var = 123;";
        let analysis_set = analyze_sql_safety(sql_set);
        assert!(!analysis_set.is_destructive);
        assert_eq!(analysis_set.danger_level, DangerLevel::Safe);
    }

    #[test]
    fn test_unknown_statement_is_conservative_medium() {
        let sql = "OPTIMIZE TABLE large_events;";
        let analysis = analyze_sql_safety(sql);
        assert!(analysis.is_destructive);
        assert_eq!(analysis.danger_level, DangerLevel::Medium);
        assert!(analysis.is_uncertain);
        assert!(analysis.operation.contains("OPTIMIZE"));
    }

    #[test]
    fn test_build_affected_count_query() {
        let delete_sql = "DELETE FROM users WHERE id > 100;";
        let count_query = build_affected_count_query(delete_sql).unwrap();
        assert!(
            count_query.starts_with("SELECT COUNT(*) AS affected_count FROM users WHERE id > 100")
        );

        let update_sql = "UPDATE accounts SET balance = 0 WHERE status = 'closed';";
        let count_update = build_affected_count_query(update_sql).unwrap();
        assert!(count_update.starts_with(
            "SELECT COUNT(*) AS affected_count FROM accounts WHERE status = 'closed'"
        ));

        let update_all = "UPDATE accounts SET active = 1;";
        let count_all = build_affected_count_query(update_all).unwrap();
        assert!(count_all.starts_with("SELECT COUNT(*) AS affected_count FROM accounts"));

        let select_sql = "SELECT * FROM users;";
        assert!(build_affected_count_query(select_sql).is_none());
    }

    // ── Tests adversarios de Modo Seguro ─────────────────────────────────

    fn assert_critical(sql: &str) {
        let a = analyze_sql_safety(sql);
        assert_eq!(
            a.danger_level,
            DangerLevel::Critical,
            "debe ser Critical: {sql:?} -> {a:?}"
        );
        assert!(a.requires_explicit_confirmation, "{sql:?}");
    }

    fn assert_not_safe(sql: &str) {
        let a = analyze_sql_safety(sql);
        assert_ne!(
            a.danger_level,
            DangerLevel::Safe,
            "no debe ser Safe: {sql:?} -> {a:?}"
        );
        assert!(a.is_destructive, "{sql:?}");
    }

    #[test]
    fn test_double_dash_without_space_is_not_a_comment() {
        // En MySQL/MariaDB `--1` es "menos menos 1", no un comentario.
        assert_critical("SELECT 1 --1; DROP TABLE t");
        assert_critical("SELECT 1--1;DROP TABLE t");
        assert_critical("SELECT 1 --x\n; DROP TABLE t");
    }

    #[test]
    fn test_double_dash_with_space_or_control_is_comment() {
        let a = analyze_sql_safety("SELECT 1 -- ; DROP TABLE t");
        assert_eq!(a.danger_level, DangerLevel::Safe);
        let a = analyze_sql_safety("SELECT 1 --\t; DROP TABLE t");
        assert_eq!(a.danger_level, DangerLevel::Safe);
        // `--` seguido de salto de línea es comentario vacío: la línea siguiente se ejecuta.
        assert_critical("SELECT 1; --\nDROP TABLE t");
        // Sin `;` es una sola sentencia (error de sintaxis): incierta, nunca Safe.
        assert_not_safe("SELECT 1 --\nDROP TABLE t");
        // `--` al final del texto.
        let a = analyze_sql_safety("SELECT 1 --");
        assert_eq!(a.danger_level, DangerLevel::Safe);
    }

    #[test]
    fn test_clean_sql_statement_respects_dash_rule_and_strings() {
        assert_eq!(clean_sql_statement("SELECT 1 --1"), "SELECT 1 --1");
        assert_eq!(clean_sql_statement("SELECT 1 -- comentario"), "SELECT 1");
        assert_eq!(
            clean_sql_statement("SELECT '-- no es comentario' AS a"),
            "SELECT '-- no es comentario' AS a"
        );
        assert_eq!(
            clean_sql_statement("SELECT '/* tampoco */ # ni esto' AS a"),
            "SELECT '/* tampoco */ # ni esto' AS a"
        );
    }

    #[test]
    fn test_mariadb_executable_comments() {
        assert_critical("SELECT 1; /*M!100100 DROP TABLE t */");
        assert_critical("/*M! DROP TABLE t */");
        assert_critical("/*!M100100 DROP TABLE t */");
        // Versiones de 6 dígitos (MySQL 8 / MariaDB 10+)
        assert_critical("/*!100100 DROP TABLE t */");
        assert_critical("/*!80034 TRUNCATE t */");
    }

    #[test]
    fn test_file_writes_are_critical() {
        assert_critical("SELECT * FROM users INTO OUTFILE '/tmp/u.csv'");
        assert_critical("select password from mysql.user into dumpfile '/var/www/x.php'");
        assert_critical("SELECT a FROM t UNION SELECT b FROM u INTO OUTFILE '/tmp/x'");
        assert_critical("SELECT 1; /*!50000 SELECT 2 INTO OUTFILE '/tmp/y' */");
    }

    #[test]
    fn test_side_effect_functions_are_not_safe() {
        assert_not_safe("SELECT LOAD_FILE('/etc/passwd')");
        assert_not_safe("SELECT SLEEP(10)");
        assert_not_safe("SELECT sleep (10)");
        assert_not_safe("SELECT BENCHMARK(100000000, MD5('a'))");
        assert_not_safe("SELECT * FROM t WHERE id = 1 AND SLEEP(5)");
        // Como literal o identificador no debe escalar.
        let a = analyze_sql_safety("SELECT 'SLEEP(5) INTO OUTFILE' AS txt, `load_file` FROM t");
        assert_eq!(a.danger_level, DangerLevel::Safe);
    }

    #[test]
    fn test_semicolon_inside_strings_does_not_split() {
        let a = analyze_sql_safety("SELECT ';DROP TABLE t;' AS x, \"; TRUNCATE t\" AS y");
        assert_eq!(a.danger_level, DangerLevel::Safe);
        let a = analyze_sql_safety(r"SELECT 'it\'s; DROP TABLE t' AS x");
        assert_eq!(a.danger_level, DangerLevel::Safe);
        let a = analyze_sql_safety("SELECT 'O''Reilly; DROP TABLE t' AS x");
        assert_eq!(a.danger_level, DangerLevel::Safe);
    }

    #[test]
    fn test_nested_comments_do_not_hide_statements() {
        // MySQL/MariaDB no anidan comentarios: el primer `*/` cierra.
        assert_critical("SELECT 1; /* /* */ DROP TABLE t; /* */");
        assert_critical("/* a */ /* b */ DELETE FROM t");
    }

    #[test]
    fn test_custom_delimiter_does_not_hide_statements() {
        assert_critical("DELIMITER //\nDROP TABLE t //\nDELIMITER ;");
        assert_critical("DELIMITER $$\nSELECT 1 $$\nTRUNCATE t $$\nDELIMITER ;");
        let a = analyze_sql_safety("DELIMITER //\nSELECT 1 //\nDELIMITER ;");
        assert_eq!(a.danger_level, DangerLevel::Safe);
    }

    #[test]
    fn test_cte_variants() {
        assert_critical("WITH x AS (SELECT 1) UPDATE t SET a = 1");
        assert_critical("with recursive x as (select 1 union all select 2) delete from t");
        let a =
            analyze_sql_safety("WITH x AS (SELECT 1) DELETE FROM t WHERE id IN (SELECT * FROM x)");
        assert_eq!(a.danger_level, DangerLevel::Medium);
        let a = analyze_sql_safety("WITH x AS (DELETE FROM t) SELECT 1");
        assert_ne!(a.danger_level, DangerLevel::Safe);
    }

    #[test]
    fn test_weird_whitespace_and_mixed_case() {
        assert_critical("select 1;\r\n\r\n\t   dRoP\t\ttAbLe   t");
        assert_critical("SELECT 1\u{000B};\u{000C}TrUnCaTe t");
        assert_critical(";;;  ;\n delete\nfrom\nt ;;");
    }

    #[test]
    fn test_unicode_inputs() {
        assert_critical("SELECT 'ñandú 🦤'; DELETE FROM tabla_ñ");
        let a = analyze_sql_safety("SELECT `columna ñ`, 'texto 日本語;' FROM `tabla`");
        assert_eq!(a.danger_level, DangerLevel::Safe);
    }

    #[test]
    fn test_uncertain_requires_confirmation() {
        for sql in ["OPTIMIZE TABLE t", "CALL p()", "SELECT 'sin cerrar"] {
            let a = analyze_sql_safety(sql);
            assert!(a.is_uncertain, "{sql}");
            assert!(a.requires_explicit_confirmation, "{sql}");
        }
    }

    #[test]
    fn sqlite_syntax_is_classified_like_mysql() {
        for sql in [
            "DELETE FROM \"main\".\"t\"",
            "UPDATE \"t\" SET \"a\" = 1",
            "DROP TABLE \"main\".\"t\"",
            "DELETE FROM t; -- limpieza",
        ] {
            assert!(analyze_sql_safety(sql).is_destructive, "{sql}");
        }
        for sql in ["SELECT * FROM sqlite_master"] {
            assert!(!analyze_sql_safety(sql).is_destructive, "{sql}");
        }
    }

    #[test]
    fn sqlite_pragma_classification() {
        for sql in [
            "PRAGMA table_info('users')",
            "PRAGMA database_list;",
            "PRAGMA foreign_keys;",
            "PRAGMA integrity_check",
            "PRAGMA index_list(users)",
        ] {
            let res = analyze_sql_safety(sql);
            assert_eq!(res.danger_level, DangerLevel::Safe, "{sql}");
            assert!(!res.requires_explicit_confirmation, "{sql}");
        }

        for sql in ["PRAGMA foreign_keys = ON;", "PRAGMA journal_mode = WAL;"] {
            let res = analyze_sql_safety(sql);
            assert_eq!(res.danger_level, DangerLevel::Safe, "{sql}");
            assert!(!res.requires_explicit_confirmation, "{sql}");
        }

        for sql in [
            "PRAGMA writable_schema = ON;",
            "PRAGMA main.writable_schema = 1;",
            "PRAGMA writable_schema(1)",
        ] {
            let critical = analyze_sql_safety(sql);
            assert_eq!(critical.danger_level, DangerLevel::Critical, "{sql}");
            assert!(critical.requires_explicit_confirmation, "{sql}");
        }
        assert_eq!(
            analyze_sql_safety("PRAGMA main.table_info(users)").danger_level,
            DangerLevel::Safe
        );
    }
}
