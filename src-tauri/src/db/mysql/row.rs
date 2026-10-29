use serde_json::Value;
use sqlx::mysql::{MySqlArguments, MySqlRow};
use sqlx::query::Query;
use sqlx::{Column, Decode, MySql, Row, Type, TypeInfo, ValueRef};

use crate::db::param_query::SqlParam;

pub type MySqlQuery<'q> = Query<'q, MySql, MySqlArguments>;

/// Converts a MariaDB/MySQL row to JSON, choosing the representation from the
/// declared column type.
pub fn row_to_json(row: &MySqlRow) -> Vec<Value> {
    (0..row.columns().len())
        .map(|index| cell_to_json(row, index))
        .collect()
}

fn cell_to_json(row: &MySqlRow, index: usize) -> Value {
    if is_null(row, index) {
        return Value::Null;
    }
    let type_name = row.columns()[index].type_info().name();
    match type_name.strip_suffix(" UNSIGNED").unwrap_or(type_name) {
        "BOOLEAN" | "TINYINT(1)" => boolean_json(row, index),
        "TINYINT" => integer_json::<i8, u8>(row, index),
        "SMALLINT" => integer_json::<i16, u16>(row, index),
        "INT" | "MEDIUMINT" => integer_json::<i32, u32>(row, index),
        "BIGINT" => integer_json::<i64, u64>(row, index),
        "FLOAT" => float_json(decode::<f32>(row, index).map(f64::from)),
        "DOUBLE" => float_json(decode::<f64>(row, index)),
        "DECIMAL" => string_json(
            decode::<sqlx::types::BigDecimal>(row, index)
                .map(|decimal| decimal.to_string())
                .or_else(|| decode::<String>(row, index)),
        ),
        "DATETIME" | "TIMESTAMP" => string_json(
            decode::<chrono::NaiveDateTime>(row, index)
                .map(|datetime| datetime.to_string())
                .or_else(|| {
                    decode::<chrono::DateTime<chrono::Utc>>(row, index)
                        .map(|datetime| datetime.to_rfc3339())
                })
                .or_else(|| decode::<String>(row, index)),
        ),
        "DATE" => string_json(
            decode::<chrono::NaiveDate>(row, index)
                .map(|date| date.to_string())
                .or_else(|| decode::<String>(row, index)),
        ),
        "TIME" => string_json(
            decode::<chrono::NaiveTime>(row, index)
                .map(|time| time.to_string())
                .or_else(|| decode::<String>(row, index)),
        ),
        "JSON" => decode::<String>(row, index).map_or(Value::Null, |text| {
            serde_json::from_str(&text).unwrap_or(Value::String(text))
        }),
        _ => text_or_blob_json(row, index),
    }
}

pub(super) fn is_null(row: &MySqlRow, index: usize) -> bool {
    row.try_get_raw(index)
        .map(|value| value.is_null())
        .unwrap_or(true)
}

pub(super) fn decode<T>(row: &MySqlRow, index: usize) -> Option<T>
where
    T: for<'r> Decode<'r, MySql> + Type<MySql>,
{
    row.try_get::<T, _>(index).ok()
}

fn boolean_json(row: &MySqlRow, index: usize) -> Value {
    decode::<bool>(row, index)
        .or_else(|| decode::<i8>(row, index).map(|number| number != 0))
        .map_or(Value::Null, Value::Bool)
}

/// Integer columns may be signed or unsigned; try the signed type first.
fn integer_json<Signed, Unsigned>(row: &MySqlRow, index: usize) -> Value
where
    Signed: for<'r> Decode<'r, MySql> + Type<MySql> + Into<serde_json::Number>,
    Unsigned: for<'r> Decode<'r, MySql> + Type<MySql> + Into<serde_json::Number>,
{
    decode::<Signed>(row, index)
        .map(Into::into)
        .or_else(|| decode::<Unsigned>(row, index).map(Into::into))
        .map_or(Value::Null, Value::Number)
}

fn float_json(value: Option<f64>) -> Value {
    value
        .and_then(serde_json::Number::from_f64)
        .map_or(Value::Null, Value::Number)
}

fn string_json(value: Option<String>) -> Value {
    value.map_or(Value::Null, Value::String)
}

fn text_or_blob_json(row: &MySqlRow, index: usize) -> Value {
    if let Some(text) = decode::<String>(row, index) {
        return Value::String(text);
    }
    decode::<Vec<u8>>(row, index).map_or(Value::Null, |bytes| {
        Value::String(
            String::from_utf8(bytes).unwrap_or_else(|error| hex_literal(error.as_bytes())),
        )
    })
}

/// Binary data that is not valid UTF-8 is shown as a `0x…` hexadecimal literal.
pub(super) fn hex_literal(bytes: &[u8]) -> String {
    let hexadecimal: String = bytes.iter().map(|byte| format!("{byte:02X}")).collect();
    format!("0x{hexadecimal}")
}

/// Safely binds a JSON value to a MySQL query argument.
pub fn bind_json_value<'q>(query: MySqlQuery<'q>, value: &'q Value) -> MySqlQuery<'q> {
    match value {
        Value::Null => query.bind(None::<String>),
        Value::Bool(flag) => query.bind(*flag),
        Value::Number(number) => {
            if let Some(integer) = number.as_i64() {
                query.bind(integer)
            } else if let Some(unsigned) = number.as_u64() {
                query.bind(unsigned as i64)
            } else if let Some(float) = number.as_f64() {
                query.bind(float)
            } else {
                query.bind(number.to_string())
            }
        }
        Value::String(text) if text.eq_ignore_ascii_case("NULL") => query.bind(None::<String>),
        Value::String(text) => query.bind(text),
        other => query.bind(other.to_string()),
    }
}

pub fn bind_sql_params<'q>(query: MySqlQuery<'q>, params: &'q [SqlParam]) -> MySqlQuery<'q> {
    params.iter().fold(query, |query, param| match param {
        SqlParam::Null => query.bind(None::<String>),
        SqlParam::Bool(flag) => query.bind(*flag),
        SqlParam::Int(integer) => query.bind(*integer),
        SqlParam::Float(float) => query.bind(*float),
        SqlParam::Text(text) => query.bind(text.as_str()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_utf8_blobs_are_rendered_as_hex_literals() {
        assert_eq!(hex_literal(&[0x00, 0xAB, 0xFF]), "0x00ABFF");
    }
}
