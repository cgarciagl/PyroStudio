use sqlx::mysql::MySqlRow;
use sqlx::{Column, Row, TypeInfo, ValueRef};

pub const DEFAULT_MAX_INTERACTIVE_ROWS: usize = 5000;

/// Converts MySqlRow values to JSON representation.
pub fn row_to_json(row: &MySqlRow) -> Vec<serde_json::Value> {
    let mut row_values = Vec::new();
    let num_cols = row.columns().len();

    for i in 0..num_cols {
        let is_null = row.try_get_raw(i).map(|v| v.is_null()).unwrap_or(true);
        if is_null {
            row_values.push(serde_json::Value::Null);
            continue;
        }

        let type_name = row.columns()[i].type_info().name();
        let type_name = type_name.strip_suffix(" UNSIGNED").unwrap_or(type_name);

        let val = match type_name {
            "BOOLEAN" | "TINYINT(1)" => {
                if let Ok(b) = row.try_get::<bool, _>(i) {
                    serde_json::Value::Bool(b)
                } else if let Ok(n) = row.try_get::<i8, _>(i) {
                    serde_json::Value::Bool(n != 0)
                } else {
                    serde_json::Value::Null
                }
            }
            "TINYINT" => {
                if let Ok(n) = row.try_get::<i8, _>(i) {
                    serde_json::Value::Number(n.into())
                } else if let Ok(n) = row.try_get::<u8, _>(i) {
                    serde_json::Value::Number(n.into())
                } else {
                    serde_json::Value::Null
                }
            }
            "SMALLINT" => {
                if let Ok(n) = row.try_get::<i16, _>(i) {
                    serde_json::Value::Number(n.into())
                } else if let Ok(n) = row.try_get::<u16, _>(i) {
                    serde_json::Value::Number(n.into())
                } else {
                    serde_json::Value::Null
                }
            }
            "INT" | "MEDIUMINT" => {
                if let Ok(n) = row.try_get::<i32, _>(i) {
                    serde_json::Value::Number(n.into())
                } else if let Ok(n) = row.try_get::<u32, _>(i) {
                    serde_json::Value::Number(n.into())
                } else {
                    serde_json::Value::Null
                }
            }
            "BIGINT" => {
                if let Ok(n) = row.try_get::<i64, _>(i) {
                    serde_json::Value::Number(n.into())
                } else if let Ok(n) = row.try_get::<u64, _>(i) {
                    serde_json::Value::Number(n.into())
                } else {
                    serde_json::Value::Null
                }
            }
            "FLOAT" => {
                if let Ok(f) = row.try_get::<f32, _>(i) {
                    serde_json::Number::from_f64(f as f64)
                        .map(serde_json::Value::Number)
                        .unwrap_or(serde_json::Value::Null)
                } else {
                    serde_json::Value::Null
                }
            }
            "DOUBLE" => {
                if let Ok(f) = row.try_get::<f64, _>(i) {
                    serde_json::Number::from_f64(f)
                        .map(serde_json::Value::Number)
                        .unwrap_or(serde_json::Value::Null)
                } else {
                    serde_json::Value::Null
                }
            }
            "DECIMAL" => {
                if let Ok(d) = row.try_get::<sqlx::types::BigDecimal, _>(i) {
                    serde_json::Value::String(d.to_string())
                } else if let Ok(s) = row.try_get::<String, _>(i) {
                    serde_json::Value::String(s)
                } else {
                    serde_json::Value::Null
                }
            }
            "DATETIME" | "TIMESTAMP" => {
                if let Ok(d) = row.try_get::<chrono::NaiveDateTime, _>(i) {
                    serde_json::Value::String(d.to_string())
                } else if let Ok(d) = row.try_get::<chrono::DateTime<chrono::Utc>, _>(i) {
                    serde_json::Value::String(d.to_rfc3339())
                } else if let Ok(s) = row.try_get::<String, _>(i) {
                    serde_json::Value::String(s)
                } else {
                    serde_json::Value::Null
                }
            }
            "DATE" => {
                if let Ok(d) = row.try_get::<chrono::NaiveDate, _>(i) {
                    serde_json::Value::String(d.to_string())
                } else if let Ok(s) = row.try_get::<String, _>(i) {
                    serde_json::Value::String(s)
                } else {
                    serde_json::Value::Null
                }
            }
            "TIME" => {
                if let Ok(d) = row.try_get::<chrono::NaiveTime, _>(i) {
                    serde_json::Value::String(d.to_string())
                } else if let Ok(s) = row.try_get::<String, _>(i) {
                    serde_json::Value::String(s)
                } else {
                    serde_json::Value::Null
                }
            }
            "JSON" => {
                if let Ok(s) = row.try_get::<String, _>(i) {
                    serde_json::from_str(&s).unwrap_or(serde_json::Value::String(s))
                } else {
                    serde_json::Value::Null
                }
            }
            _ => {
                if let Ok(s) = row.try_get::<String, _>(i) {
                    serde_json::Value::String(s)
                } else if let Ok(bytes) = row.try_get::<Vec<u8>, _>(i) {
                    match String::from_utf8(bytes.clone()) {
                        Ok(valid_str) => serde_json::Value::String(valid_str),
                        Err(_) => {
                            let hex: String = bytes.iter().map(|b| format!("{b:02X}")).collect();
                            serde_json::Value::String(format!("0x{hex}"))
                        }
                    }
                } else {
                    serde_json::Value::Null
                }
            }
        };

        row_values.push(val);
    }

    row_values
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

/// Safely binds a JSON value to a SQLx MySQL query argument.
pub fn bind_json_value<'q>(
    query: sqlx::query::Query<'q, sqlx::MySql, sqlx::mysql::MySqlArguments>,
    val: &'q serde_json::Value,
) -> sqlx::query::Query<'q, sqlx::MySql, sqlx::mysql::MySqlArguments> {
    match val {
        serde_json::Value::Null => query.bind(None::<String>),
        serde_json::Value::Bool(b) => query.bind(*b),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                query.bind(i)
            } else if let Some(u) = n.as_u64() {
                query.bind(u as i64)
            } else if let Some(f) = n.as_f64() {
                query.bind(f)
            } else {
                query.bind(n.to_string())
            }
        }
        serde_json::Value::String(s) => {
            if s.eq_ignore_ascii_case("NULL") {
                query.bind(None::<String>)
            } else {
                query.bind(s)
            }
        }
        other => query.bind(other.to_string()),
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
