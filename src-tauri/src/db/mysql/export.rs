use sqlx::mysql::MySqlRow;
use sqlx::{Column, Row, TypeInfo, ValueRef};

use super::row::decode;
use crate::db::backend::{EngineError, ExportCell};
use crate::db::query::display_bytes;

pub fn export_row(row: &MySqlRow) -> Result<Vec<ExportCell>, EngineError> {
    (0..row.columns().len())
        .map(|index| export_cell(row, index))
        .collect()
}

fn export_cell(row: &MySqlRow, index: usize) -> Result<ExportCell, EngineError> {
    let column = &row.columns()[index];
    let raw = row.try_get_raw(index).map_err(|error| {
        EngineError::new(format!(
            "Error leyendo columna '{}': {error}",
            column.name()
        ))
    })?;
    if raw.is_null() {
        return Ok(ExportCell::Blank);
    }

    let native = match column.type_info().name() {
        "BOOLEAN" | "TINYINT(1)" => decode::<bool>(row, index).map(ExportCell::Bool),
        name if is_integer_sql_type(name) => exact_integer_cell(row, index),
        "FLOAT" | "DOUBLE" => decode::<f64>(row, index).map(ExportCell::Number),
        _ => decode::<String>(row, index).map(|value| ExportCell::Text {
            value,
            autosize: true,
        }),
    };
    match native {
        Some(cell) => Ok(cell),
        None => text_fallback_cell(row, index),
    }
}

/// Integers too large for an exact spreadsheet number become text.
fn exact_integer_cell(row: &MySqlRow, index: usize) -> Option<ExportCell> {
    decode::<i64>(row, index)
        .map(ExportCell::integer)
        .or_else(|| decode::<u64>(row, index).map(ExportCell::unsigned))
}

fn text_fallback_cell(row: &MySqlRow, index: usize) -> Result<ExportCell, EngineError> {
    let column = &row.columns()[index];
    let type_name = column.type_info().name();
    let value = match type_name {
        "BOOLEAN" | "TINYINT(1)" => decode::<bool>(row, index)
            .map(|flag| flag.to_string())
            .or_else(|| decode::<i8>(row, index).map(|number| number.to_string())),
        name if is_integer_sql_type(name) => decode::<i64>(row, index)
            .map(|number| number.to_string())
            .or_else(|| decode::<u64>(row, index).map(|number| number.to_string())),
        "FLOAT" | "DOUBLE" => decode::<f64>(row, index).map(|number| number.to_string()),
        "DECIMAL" => decode::<sqlx::types::BigDecimal>(row, index).map(|d| d.to_string()),
        "DATE" => decode::<chrono::NaiveDate>(row, index).map(|date| date.to_string()),
        "DATETIME" | "TIMESTAMP" => decode::<chrono::NaiveDateTime>(row, index)
            .map(|datetime| datetime.to_string())
            .or_else(|| {
                decode::<chrono::DateTime<chrono::Utc>>(row, index)
                    .map(|datetime| datetime.to_rfc3339())
            }),
        "TIME" => decode::<sqlx::mysql::types::MySqlTime>(row, index).map(|t| t.to_string()),
        "JSON" => decode::<sqlx::types::Json<serde_json::Value>>(row, index)
            .map(|json| json.0.to_string()),
        _ => decode::<Vec<u8>>(row, index)
            .map(|bytes| display_bytes(&bytes))
            .or_else(|| decode::<String>(row, index)),
    };
    value.map(ExportCell::unsized_text).ok_or_else(|| {
        EngineError::new(format!(
            "No se pudo convertir la columna '{}' (tipo SQL '{type_name}') al formato Excel.",
            column.name()
        ))
    })
}

fn is_integer_sql_type(type_name: &str) -> bool {
    matches!(
        type_name,
        "TINYINT"
            | "TINYINT UNSIGNED"
            | "SMALLINT"
            | "SMALLINT UNSIGNED"
            | "INT"
            | "INT UNSIGNED"
            | "MEDIUMINT"
            | "MEDIUMINT UNSIGNED"
            | "BIGINT"
            | "BIGINT UNSIGNED"
            | "YEAR"
            | "BIT"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_signed_and_unsigned_mysql_integer_types() {
        for type_name in [
            "TINYINT",
            "TINYINT UNSIGNED",
            "SMALLINT UNSIGNED",
            "INT",
            "INT UNSIGNED",
            "MEDIUMINT UNSIGNED",
            "BIGINT",
            "BIGINT UNSIGNED",
            "YEAR",
            "BIT",
        ] {
            assert!(is_integer_sql_type(type_name), "{type_name}");
        }
        assert!(!is_integer_sql_type("VARCHAR"));
    }

    #[test]
    fn exports_utf8_bytes_as_text_and_binary_bytes_as_hex() {
        assert_eq!(display_bytes("Árbol 東京".as_bytes()), "Árbol 東京");
        assert_eq!(display_bytes(&[0x00, 0xFF]), "0x00FF");
    }
}
