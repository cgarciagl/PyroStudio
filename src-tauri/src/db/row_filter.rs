use serde_json::Value;

use super::error::PyroError;
use super::models::{CellUpdateRequest, DeleteRowRequest, PrimaryKeyCondition};
use super::sql_utils::quote_identifier;

/// `WHERE` clause that identifies a single row, with its non-null key values
/// left as `?` placeholders in clause order.
pub struct BoundRowFilter<'a> {
    pub clause: String,
    pub values: Vec<&'a Value>,
}

/// Key conditions of a cell update, accepting the legacy single-column fields.
pub fn update_row_conditions(
    req: &CellUpdateRequest,
) -> Result<Vec<PrimaryKeyCondition>, PyroError> {
    let mut conditions = req.primary_keys.clone();
    if conditions.is_empty() {
        if let (Some(column), Some(value)) = (&req.primary_key_column, &req.primary_key_value) {
            if !column.trim().is_empty() {
                conditions.push(PrimaryKeyCondition {
                    column: column.clone(),
                    value: value.clone(),
                });
            }
        }
    }
    require_conditions(conditions)
}

pub fn delete_row_conditions(
    req: &DeleteRowRequest,
) -> Result<Vec<PrimaryKeyCondition>, PyroError> {
    require_conditions(req.primary_keys.clone())
}

/// A blank database name means "the session default".
pub fn target_database(database: &str) -> Option<&str> {
    if database.trim().is_empty() {
        None
    } else {
        Some(database)
    }
}

pub fn bound_row_filter(
    conditions: &[PrimaryKeyCondition],
) -> Result<BoundRowFilter<'_>, PyroError> {
    let mut values = Vec::new();
    let clause = row_filter_clause(conditions, |value| {
        values.push(value);
        "?".to_string()
    })?;
    Ok(BoundRowFilter { clause, values })
}

/// Row filter with values inlined as escaped literals, for transports without
/// bound parameters (HTTP tunnel).
pub fn literal_row_filter(conditions: &[PrimaryKeyCondition]) -> Result<String, PyroError> {
    row_filter_clause(conditions, super::query::json_value_to_sql_literal)
}

fn require_conditions(
    conditions: Vec<PrimaryKeyCondition>,
) -> Result<Vec<PrimaryKeyCondition>, PyroError> {
    if conditions.is_empty() {
        Err(PyroError::NoPrimaryKey)
    } else {
        Ok(conditions)
    }
}

fn row_filter_clause<'a>(
    conditions: &'a [PrimaryKeyCondition],
    mut render_value: impl FnMut(&'a Value) -> String,
) -> Result<String, PyroError> {
    let mut clauses = Vec::with_capacity(conditions.len());
    for condition in conditions {
        let column = quote_identifier(&condition.column)?;
        if condition.value.is_null() {
            clauses.push(format!("{column} IS NULL"));
        } else {
            clauses.push(format!("{column} = {}", render_value(&condition.value)));
        }
    }
    Ok(clauses.join(" AND "))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn condition(column: &str, value: Value) -> PrimaryKeyCondition {
        PrimaryKeyCondition {
            column: column.into(),
            value,
        }
    }

    #[test]
    fn bound_filter_keeps_nulls_inline_and_binds_the_rest() {
        let conditions = [
            condition("tenant", json!(4)),
            condition("deleted_at", Value::Null),
            condition("code", json!("A'1")),
        ];
        let filter = bound_row_filter(&conditions).unwrap();
        assert_eq!(
            filter.clause,
            "`tenant` = ? AND `deleted_at` IS NULL AND `code` = ?"
        );
        assert_eq!(filter.values, vec![&json!(4), &json!("A'1")]);
    }

    #[test]
    fn literal_filter_escapes_values() {
        let conditions = [condition("code", json!("A'1"))];
        assert_eq!(literal_row_filter(&conditions).unwrap(), "`code` = 'A''1'");
    }

    #[test]
    fn delete_without_keys_is_rejected() {
        let req = DeleteRowRequest {
            database: "app".into(),
            table: "users".into(),
            primary_keys: Vec::new(),
        };
        assert!(matches!(
            delete_row_conditions(&req),
            Err(PyroError::NoPrimaryKey)
        ));
    }
}
