pub const DEFAULT_MAX_INTERACTIVE_ROWS: usize = 5000;

/// Binary values are shown as text when they are valid UTF-8 and as a `0x…`
/// hexadecimal literal otherwise, the same for every engine.
pub fn display_bytes(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_string(),
        Err(_) => {
            let hexadecimal: String = bytes.iter().map(|byte| format!("{byte:02X}")).collect();
            format!("0x{hexadecimal}")
        }
    }
}

/// Converts a JSON value to a safe SQL literal for raw query building (e.g. for HTTP tunnel).
pub fn json_value_to_sql_literal(val: &serde_json::Value) -> String {
    match val {
        serde_json::Value::Null => "NULL".to_string(),
        serde_json::Value::Bool(b) => {
            if *b {
                "1".to_string()
            } else {
                "0".to_string()
            }
        }
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(s) => {
            if s.eq_ignore_ascii_case("NULL") {
                "NULL".to_string()
            } else {
                format!("'{}'", s.replace('\'', "''").replace('\\', "\\\\"))
            }
        }
        other => format!(
            "'{}'",
            other.to_string().replace('\'', "''").replace('\\', "\\\\")
        ),
    }
}

/// Safely extracts an i64 from a JSON value across integer, float (if whole), or string representations.
pub fn value_to_i64(v: &serde_json::Value) -> Option<i64> {
    if let Some(n) = v.as_i64() {
        Some(n)
    } else if let Some(u) = v.as_u64() {
        i64::try_from(u).ok()
    } else if let Some(f) = v.as_f64() {
        if f.is_finite() && f >= (i64::MIN as f64) && f <= (i64::MAX as f64) {
            Some(f as i64)
        } else {
            None
        }
    } else if let Some(s) = v.as_str() {
        let s = s.trim();
        s.parse::<i64>().ok().or_else(|| {
            s.parse::<f64>().ok().and_then(|f| {
                if f.is_finite() && f >= (i64::MIN as f64) && f <= (i64::MAX as f64) {
                    Some(f as i64)
                } else {
                    None
                }
            })
        })
    } else {
        None
    }
}

/// Safely extracts a u64 from a JSON value across integer, float, or string representations.
pub fn value_to_u64(v: &serde_json::Value) -> Option<u64> {
    if let Some(u) = v.as_u64() {
        Some(u)
    } else if let Some(n) = v.as_i64() {
        u64::try_from(n).ok()
    } else if let Some(f) = v.as_f64() {
        if f.is_finite() && f >= 0.0 && f <= (u64::MAX as f64) {
            Some(f as u64)
        } else {
            None
        }
    } else if let Some(s) = v.as_str() {
        let s = s.trim();
        s.parse::<u64>().ok().or_else(|| {
            s.parse::<f64>().ok().and_then(|f| {
                if f.is_finite() && f >= 0.0 && f <= (u64::MAX as f64) {
                    Some(f as u64)
                } else {
                    None
                }
            })
        })
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_value_to_i64_and_u64() {
        assert_eq!(value_to_i64(&serde_json::json!(42)), Some(42));
        assert_eq!(value_to_i64(&serde_json::json!(-15)), Some(-15));
        assert_eq!(value_to_i64(&serde_json::json!(1048576.0)), Some(1048576));
        assert_eq!(value_to_i64(&serde_json::json!("987654")), Some(987654));
        assert_eq!(value_to_i64(&serde_json::json!("12345.0")), Some(12345));
        assert_eq!(value_to_i64(&serde_json::Value::Null), None);

        assert_eq!(value_to_u64(&serde_json::json!(42)), Some(42));
        assert_eq!(value_to_u64(&serde_json::json!(-5)), None);
        assert_eq!(value_to_u64(&serde_json::json!(1048576.0)), Some(1048576));
        assert_eq!(value_to_u64(&serde_json::json!("987654")), Some(987654));
    }

    #[test]
    fn binary_values_show_as_text_or_hexadecimal() {
        assert_eq!(display_bytes("Árbol 東京".as_bytes()), "Árbol 東京");
        assert_eq!(display_bytes(&[0x00, 0xAB, 0xFF]), "0x00ABFF");
    }

    #[test]
    fn test_json_value_to_sql_literal_null() {
        assert_eq!(json_value_to_sql_literal(&serde_json::Value::Null), "NULL");
        assert_eq!(
            json_value_to_sql_literal(&serde_json::Value::String("null".into())),
            "NULL"
        );
        assert_eq!(
            json_value_to_sql_literal(&serde_json::Value::String("NULL".into())),
            "NULL"
        );
    }

    #[test]
    fn test_json_value_to_sql_literal_types() {
        assert_eq!(json_value_to_sql_literal(&serde_json::json!(true)), "1");
        assert_eq!(json_value_to_sql_literal(&serde_json::json!(false)), "0");
        assert_eq!(json_value_to_sql_literal(&serde_json::json!(42)), "42");
        assert_eq!(
            json_value_to_sql_literal(&serde_json::json!("O'Reilly")),
            "'O''Reilly'"
        );
        assert_eq!(
            json_value_to_sql_literal(&serde_json::json!("Path\\To\\File")),
            "'Path\\\\To\\\\File'"
        );
    }
}
