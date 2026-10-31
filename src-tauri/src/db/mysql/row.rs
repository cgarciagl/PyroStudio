use serde_json::Value;
use sqlx::mysql::{MySqlArguments, MySqlRow};
use sqlx::query::Query;
use sqlx::{Column, Decode, MySql, Row, Type, TypeInfo, ValueRef};

use crate::db::param_query::SqlParam;
use crate::db::query::display_bytes;

pub type MySqlQuery<'q> = Query<'q, MySql, MySqlArguments>;

/// Classification of MySQL column types to avoid string parsing on every single cell.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MySqlCellKind {
    Boolean,
    TinyInt,
    SmallInt,
    Int,
    BigInt,
    Float,
    Double,
    Decimal,
    DateTime,
    Date,
    Time,
    Json,
    TextOrBlob,
}

impl MySqlCellKind {
    pub fn from_type_name(raw_name: &str) -> Self {
        let type_name = raw_name.strip_suffix(" UNSIGNED").unwrap_or(raw_name);
        match type_name {
            "BOOLEAN" | "TINYINT(1)" => Self::Boolean,
            "TINYINT" => Self::TinyInt,
            "SMALLINT" => Self::SmallInt,
            "INT" | "MEDIUMINT" => Self::Int,
            "BIGINT" => Self::BigInt,
            "FLOAT" => Self::Float,
            "DOUBLE" => Self::Double,
            "DECIMAL" => Self::Decimal,
            "DATETIME" | "TIMESTAMP" => Self::DateTime,
            "DATE" => Self::Date,
            "TIME" => Self::Time,
            "JSON" => Self::Json,
            _ => Self::TextOrBlob,
        }
    }
}

/// Stateful row decoder that inspects column metadata once on the first row
/// and caches the column types for all subsequent rows in the result set.
#[derive(Default)]
pub struct MySqlRowDecoder {
    kinds: Option<Vec<MySqlCellKind>>,
}

impl MySqlRowDecoder {
    pub fn new() -> Self {
        Self { kinds: None }
    }

    pub fn decode_row(&mut self, row: &MySqlRow) -> Vec<Value> {
        let cols = row.columns();
        let kinds = self.kinds.get_or_insert_with(|| {
            cols.iter()
                .map(|col| MySqlCellKind::from_type_name(col.type_info().name()))
                .collect()
        });

        let mut values = Vec::with_capacity(kinds.len());
        for (index, &kind) in kinds.iter().enumerate() {
            values.push(cell_to_json_typed(row, index, kind));
        }
        values
    }
}

/// Converts a MariaDB/MySQL row to JSON, choosing the representation from the
/// declared column type.
pub fn row_to_json(row: &MySqlRow) -> Vec<Value> {
    let mut decoder = MySqlRowDecoder::new();
    decoder.decode_row(row)
}

fn cell_to_json_typed(row: &MySqlRow, index: usize, kind: MySqlCellKind) -> Value {
    if is_null(row, index) {
        return Value::Null;
    }
    match kind {
        MySqlCellKind::Boolean => boolean_json(row, index),
        MySqlCellKind::TinyInt => integer_json::<i8, u8>(row, index),
        MySqlCellKind::SmallInt => integer_json::<i16, u16>(row, index),
        MySqlCellKind::Int => integer_json::<i32, u32>(row, index),
        MySqlCellKind::BigInt => integer_json::<i64, u64>(row, index),
        MySqlCellKind::Float => float_json(decode::<f32>(row, index).map(f64::from)),
        MySqlCellKind::Double => float_json(decode::<f64>(row, index)),
        MySqlCellKind::Decimal => string_json(
            decode::<sqlx::types::BigDecimal>(row, index)
                .map(|decimal| decimal.to_string())
                .or_else(|| decode::<String>(row, index)),
        ),
        MySqlCellKind::DateTime => string_json(
            decode::<chrono::NaiveDateTime>(row, index)
                .map(|datetime| datetime.to_string())
                .or_else(|| {
                    decode::<chrono::DateTime<chrono::Utc>>(row, index)
                        .map(|datetime| datetime.to_rfc3339())
                })
                .or_else(|| decode::<String>(row, index)),
        ),
        MySqlCellKind::Date => string_json(
            decode::<chrono::NaiveDate>(row, index)
                .map(|date| date.to_string())
                .or_else(|| decode::<String>(row, index)),
        ),
        MySqlCellKind::Time => string_json(
            decode::<chrono::NaiveTime>(row, index)
                .map(|time| time.to_string())
                .or_else(|| decode::<String>(row, index)),
        ),
        MySqlCellKind::Json => decode::<String>(row, index).map_or(Value::Null, |text| {
            serde_json::from_str(&text).unwrap_or(Value::String(text))
        }),
        MySqlCellKind::TextOrBlob => text_or_blob_json(row, index),
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
    decode::<Vec<u8>>(row, index).map_or(Value::Null, |bytes| Value::String(display_bytes(&bytes)))
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
    fn parses_column_types_correctly() {
        assert_eq!(
            MySqlCellKind::from_type_name("BOOLEAN"),
            MySqlCellKind::Boolean
        );
        assert_eq!(
            MySqlCellKind::from_type_name("TINYINT(1)"),
            MySqlCellKind::Boolean
        );
        assert_eq!(
            MySqlCellKind::from_type_name("TINYINT"),
            MySqlCellKind::TinyInt
        );
        assert_eq!(
            MySqlCellKind::from_type_name("TINYINT UNSIGNED"),
            MySqlCellKind::TinyInt
        );
        assert_eq!(MySqlCellKind::from_type_name("INT"), MySqlCellKind::Int);
        assert_eq!(
            MySqlCellKind::from_type_name("INT UNSIGNED"),
            MySqlCellKind::Int
        );
        assert_eq!(
            MySqlCellKind::from_type_name("BIGINT UNSIGNED"),
            MySqlCellKind::BigInt
        );
        assert_eq!(
            MySqlCellKind::from_type_name("DECIMAL"),
            MySqlCellKind::Decimal
        );
        assert_eq!(
            MySqlCellKind::from_type_name("DATETIME"),
            MySqlCellKind::DateTime
        );
        assert_eq!(
            MySqlCellKind::from_type_name("VARCHAR"),
            MySqlCellKind::TextOrBlob
        );
        assert_eq!(MySqlCellKind::from_type_name("JSON"), MySqlCellKind::Json);
    }
}
