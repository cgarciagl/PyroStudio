//! SQLite values are dynamically typed: a column declared `INTEGER` may hold
//! text in some rows. Cells are therefore converted from the storage class of
//! each value (INTEGER, REAL, TEXT, BLOB, NULL), never from the declared type.

use serde_json::Value;
use sqlx::query::Query;
use sqlx::sqlite::{SqliteArguments, SqliteRow, SqliteValueRef};
use sqlx::{Column, Decode, Row, Sqlite, Type, TypeInfo, ValueRef};

use crate::db::backend::{EngineError, ExportCell};
use crate::db::param_query::SqlParam;
use crate::db::query::display_bytes;

pub type SqliteQuery<'q> = Query<'q, Sqlite, SqliteArguments<'q>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StorageClass {
    Null,
    Integer,
    Real,
    Text,
    Blob,
}

pub fn row_to_json(row: &SqliteRow) -> Vec<Value> {
    (0..row.columns().len())
        .map(|index| cell_to_json(row, index))
        .collect()
}

fn cell_to_json(row: &SqliteRow, index: usize) -> Value {
    match storage_class(row, index) {
        StorageClass::Null => Value::Null,
        StorageClass::Integer => decode::<i64>(row, index).map_or(Value::Null, Value::from),
        StorageClass::Real => decode::<f64>(row, index)
            .and_then(serde_json::Number::from_f64)
            .map_or(Value::Null, Value::Number),
        StorageClass::Text => decode::<String>(row, index).map_or(Value::Null, Value::String),
        StorageClass::Blob => decode::<Vec<u8>>(row, index)
            .map_or(Value::Null, |bytes| Value::String(display_bytes(&bytes))),
    }
}

pub fn export_row(row: &SqliteRow) -> Result<Vec<ExportCell>, EngineError> {
    (0..row.columns().len())
        .map(|index| export_cell(row, index))
        .collect()
}

fn export_cell(row: &SqliteRow, index: usize) -> Result<ExportCell, EngineError> {
    let cell = match storage_class(row, index) {
        StorageClass::Null => Some(ExportCell::Blank),
        StorageClass::Integer => decode::<i64>(row, index).map(ExportCell::integer),
        StorageClass::Real => decode::<f64>(row, index).map(ExportCell::Number),
        StorageClass::Text => decode::<String>(row, index).map(|value| ExportCell::Text {
            value,
            autosize: true,
        }),
        StorageClass::Blob => decode::<Vec<u8>>(row, index)
            .map(|bytes| ExportCell::unsized_text(display_bytes(&bytes))),
    };
    cell.ok_or_else(|| {
        EngineError::new(format!(
            "No se pudo convertir la columna '{}' al formato Excel.",
            row.columns()[index].name()
        ))
    })
}

fn storage_class(row: &SqliteRow, index: usize) -> StorageClass {
    let Ok(raw) = row.try_get_raw(index) else {
        return StorageClass::Null;
    };
    value_storage_class(&raw)
}

fn value_storage_class(raw: &SqliteValueRef<'_>) -> StorageClass {
    if raw.is_null() {
        return StorageClass::Null;
    }
    match raw.type_info().name() {
        "INTEGER" => StorageClass::Integer,
        "REAL" => StorageClass::Real,
        "BLOB" => StorageClass::Blob,
        _ => StorageClass::Text,
    }
}

/// Decodes without checking the declared column type, which SQLite does not enforce.
fn decode<T>(row: &SqliteRow, index: usize) -> Option<T>
where
    T: for<'r> Decode<'r, Sqlite> + Type<Sqlite>,
{
    row.try_get_unchecked::<T, _>(index).ok()
}

pub fn bind_sql_params<'q>(query: SqliteQuery<'q>, params: &'q [SqlParam]) -> SqliteQuery<'q> {
    params.iter().fold(query, |query, param| match param {
        SqlParam::Null => query.bind(None::<String>),
        SqlParam::Bool(flag) => query.bind(*flag),
        SqlParam::Int(integer) => query.bind(*integer),
        SqlParam::Float(float) => query.bind(*float),
        SqlParam::Text(text) => query.bind(text.as_str()),
    })
}
