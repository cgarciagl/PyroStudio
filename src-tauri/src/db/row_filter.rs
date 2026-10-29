use serde_json::Value;

use super::dialect::Dialect;
use super::error::PyroError;
use super::models::{CellUpdateRequest, DeleteRowRequest, PrimaryKeyCondition};
use super::param_query::{ParamQuery, SqlParam};

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

pub fn bound_row_filter<'a>(
    dialect: &dyn Dialect,
    conditions: &'a [PrimaryKeyCondition],
) -> Result<BoundRowFilter<'a>, PyroError> {
    let mut values = Vec::new();
    let clause = row_filter_clause(dialect, conditions, |value| {
        values.push(value);
        "?".to_string()
    })?;
    Ok(BoundRowFilter { clause, values })
}

/// Row filter with values inlined as escaped literals, for transports without
/// bound parameters (HTTP tunnel).
pub fn literal_row_filter(
    dialect: &dyn Dialect,
    conditions: &[PrimaryKeyCondition],
) -> Result<String, PyroError> {
    row_filter_clause(dialect, conditions, |value| dialect.value_literal(value))
}

/// `UPDATE` of one cell with every value bound, in the dialect's syntax.
pub fn cell_update_query(
    dialect: &dyn Dialect,
    req: &CellUpdateRequest,
) -> Result<ParamQuery, PyroError> {
    let conditions = update_row_conditions(req)?;
    let table_ref = dialect.qualify_table(target_database(&req.database), &req.table)?;
    let column = dialect.quote_identifier(&req.column_name)?;
    let mut query = ParamQuery::new(format!("UPDATE {table_ref} SET {column} = "));
    query
        .push_bind(SqlParam::from_json(&req.new_value))
        .push(" WHERE ");
    push_row_filter(&mut query, dialect, &conditions)?;
    query.push(dialect.single_row_limit());
    Ok(query)
}

pub fn row_delete_query(
    dialect: &dyn Dialect,
    req: &DeleteRowRequest,
) -> Result<ParamQuery, PyroError> {
    let conditions = delete_row_conditions(req)?;
    let table_ref = dialect.qualify_table(target_database(&req.database), &req.table)?;
    let mut query = ParamQuery::new(format!("DELETE FROM {table_ref} WHERE "));
    push_row_filter(&mut query, dialect, &conditions)?;
    query.push(dialect.single_row_limit());
    Ok(query)
}

fn push_row_filter(
    query: &mut ParamQuery,
    dialect: &dyn Dialect,
    conditions: &[PrimaryKeyCondition],
) -> Result<(), PyroError> {
    let filter = bound_row_filter(dialect, conditions)?;
    query.push_bound_fragment(
        &filter.clause,
        filter.values.into_iter().map(SqlParam::from_json),
    );
    Ok(())
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
    dialect: &dyn Dialect,
    conditions: &'a [PrimaryKeyCondition],
    mut render_value: impl FnMut(&'a Value) -> String,
) -> Result<String, PyroError> {
    let mut clauses = Vec::with_capacity(conditions.len());
    for condition in conditions {
        let column = dialect.quote_identifier(&condition.column)?;
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
    use crate::db::dialect::MYSQL_DIALECT;
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
        let filter = bound_row_filter(&MYSQL_DIALECT, &conditions).unwrap();
        assert_eq!(
            filter.clause,
            "`tenant` = ? AND `deleted_at` IS NULL AND `code` = ?"
        );
        assert_eq!(filter.values, vec![&json!(4), &json!("A'1")]);
    }

    #[test]
    fn literal_filter_escapes_values() {
        let conditions = [condition("code", json!("A'1"))];
        assert_eq!(
            literal_row_filter(&MYSQL_DIALECT, &conditions).unwrap(),
            "`code` = 'A''1'"
        );
    }

    #[test]
    fn sqlite_cell_update_binds_values_without_limit() {
        let req = CellUpdateRequest {
            database: "main".into(),
            table: "users".into(),
            primary_keys: vec![condition("rowid", json!(3))],
            column_name: "name".into(),
            new_value: json!("Ana"),
            primary_key_column: None,
            primary_key_value: None,
        };
        let query = cell_update_query(&crate::db::dialect::SQLITE_DIALECT, &req).unwrap();
        assert_eq!(
            query.sql(),
            "UPDATE \"main\".\"users\" SET \"name\" = ? WHERE \"rowid\" = ?"
        );
        assert_eq!(
            query.params(),
            &[SqlParam::Text("Ana".into()), SqlParam::Int(3)]
        );
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
