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
}

/// Cleans SQL comments and trims whitespace to analyze the primary statement.
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
            i += 2;
            continue;
        }

        cleaned.push(chars[i]);
        i += 1;
    }

    cleaned.trim().to_string()
}

/// Analyzes an SQL statement to assess destructive impact.
pub fn analyze_sql_safety(sql: &str) -> SqlSafetyAnalysis {
    let cleaned = clean_sql_statement(sql);
    let upper = cleaned.to_uppercase();

    // Split multiple statements if any
    let statements: Vec<&str> = upper
        .split(';')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    let mut highest_danger = DangerLevel::Safe;
    let mut detected_op = String::new();
    let mut warning_msg = String::new();
    let mut requires_confirmation = false;

    for stmt in statements {
        if stmt.starts_with("DROP") {
            let entity = if stmt.contains("DATABASE") || stmt.contains("SCHEMA") {
                "DROP DATABASE"
            } else if stmt.contains("TABLE") {
                "DROP TABLE"
            } else if stmt.contains("PROCEDURE") {
                "DROP PROCEDURE"
            } else if stmt.contains("FUNCTION") {
                "DROP FUNCTION"
            } else if stmt.contains("TRIGGER") {
                "DROP TRIGGER"
            } else if stmt.contains("INDEX") {
                "DROP INDEX"
            } else {
                "DROP"
            };

            highest_danger = DangerLevel::Critical;
            detected_op = entity.to_string();
            warning_msg = format!("La sentencia '{entity}' eliminará permanentemente la estructura y los datos asociados.");
            requires_confirmation = true;
            break; // Highest danger reached
        } else if stmt.starts_with("TRUNCATE") {
            highest_danger = DangerLevel::Critical;
            detected_op = "TRUNCATE TABLE".to_string();
            warning_msg = "La sentencia 'TRUNCATE TABLE' vaciará completamente la tabla y reiniciará sus contadores autoincrementales.".to_string();
            requires_confirmation = true;
            break;
        } else if stmt.starts_with("DELETE") {
            let has_where = stmt.contains(" WHERE ");
            if !has_where {
                highest_danger = DangerLevel::Critical;
                detected_op = "DELETE (Sin WHERE)".to_string();
                warning_msg = "¡ALERTA CRÍTICA! 'DELETE' sin cláusula WHERE eliminará TODOS los registros de la tabla.".to_string();
                requires_confirmation = true;
                break;
            } else {
                if highest_danger == DangerLevel::Safe {
                    highest_danger = DangerLevel::Medium;
                    detected_op = "DELETE".to_string();
                    warning_msg = "La sentencia 'DELETE' eliminará registros de la tabla que coincidan con la condición WHERE.".to_string();
                }
            }
        } else if stmt.starts_with("UPDATE") {
            let has_where = stmt.contains(" WHERE ");
            if !has_where {
                highest_danger = DangerLevel::Critical;
                detected_op = "UPDATE (Sin WHERE)".to_string();
                warning_msg = "¡ALERTA CRÍTICA! 'UPDATE' sin cláusula WHERE modificará TODOS los registros de la tabla.".to_string();
                requires_confirmation = true;
                break;
            } else {
                if highest_danger == DangerLevel::Safe {
                    highest_danger = DangerLevel::Medium;
                    detected_op = "UPDATE".to_string();
                    warning_msg =
                        "La sentencia 'UPDATE' modificará registros en la tabla objetivo."
                            .to_string();
                }
            }
        } else if stmt.starts_with("ALTER") {
            if highest_danger != DangerLevel::Critical {
                highest_danger = DangerLevel::Medium;
                detected_op = "ALTER TABLE".to_string();
                warning_msg =
                    "La sentencia 'ALTER' modificará la estructura existente del esquema o tabla."
                        .to_string();
            }
        } else if stmt.starts_with("RENAME") {
            if highest_danger != DangerLevel::Critical {
                highest_danger = DangerLevel::Medium;
                detected_op = "RENAME TABLE".to_string();
                warning_msg =
                    "La sentencia 'RENAME' cambiará el nombre de una o más tablas.".to_string();
            }
        }
    }

    let is_destructive = highest_danger != DangerLevel::Safe;

    SqlSafetyAnalysis {
        is_destructive,
        danger_level: highest_danger,
        operation: if detected_op.is_empty() {
            "SELECT / READ".to_string()
        } else {
            detected_op
        },
        message: if warning_msg.is_empty() {
            "Consulta segura de lectura.".to_string()
        } else {
            warning_msg
        },
        requires_explicit_confirmation: requires_confirmation,
    }
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
}
