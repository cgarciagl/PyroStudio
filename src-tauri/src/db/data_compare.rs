//! Row-level comparison of two tables (same or different connection) by
//! primary key, plus the script that makes the target match the source.
//!
//! The source key space is cut into chunks of `CHUNK_ROWS` keys. On MariaDB /
//! MySQL each chunk is first checksummed on both servers (`MD5` per row folded
//! with `BIT_XOR`), and only chunks whose checksum differs are downloaded and
//! compared row by row; other engines compare every chunk. Memory stays bounded
//! by one chunk of source rows plus one page of target rows.

use std::collections::HashMap;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::backend::DatabaseBackend;
use super::dialect::Dialect;
use super::engine::DbEngine;
use super::error::PyroError;
use super::introspect::introspector;
use super::models::ConnectionConfig;

const CHUNK_ROWS: usize = 1000;
const DEFAULT_MAX_DIFFERENCES: usize = 1000;
const MAX_DIFFERENCES_LIMIT: usize = 50_000;

#[derive(Debug, Clone, Deserialize)]
pub struct DataCompareSide {
    /// Another saved connection; `None` uses the active session.
    #[serde(default)]
    pub connection: Option<ConnectionConfig>,
    pub database: String,
    pub table: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DataCompareRequest {
    pub source: DataCompareSide,
    pub target: DataCompareSide,
    /// Rows kept in detail (and statements generated); counts are always exact.
    #[serde(default)]
    pub max_differences: Option<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RowDifferenceKind {
    /// Only in the source: the target needs an INSERT.
    Insert,
    /// Only in the target: the target needs a DELETE.
    Delete,
    /// Same key, different values: the target needs an UPDATE.
    Update,
}

#[derive(Debug, Clone, Serialize)]
pub struct RowDifference {
    pub kind: RowDifferenceKind,
    pub key: Vec<Value>,
    pub source: Option<Vec<Value>>,
    pub target: Option<Vec<Value>>,
    pub changed_columns: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct DataCompareResult {
    pub key_columns: Vec<String>,
    /// Columns present on both sides, in source order; the only ones compared.
    pub columns: Vec<String>,
    pub source_only_columns: Vec<String>,
    pub target_only_columns: Vec<String>,
    pub source_rows: u64,
    pub target_rows: u64,
    pub inserted: u64,
    pub deleted: u64,
    pub modified: u64,
    pub chunks: u64,
    /// Chunks skipped because their checksums matched.
    pub identical_chunks: u64,
    pub used_checksums: bool,
    pub differences: Vec<RowDifference>,
    /// More differences exist than `differences` / `sync_statements` hold.
    pub truncated: bool,
    /// Statements (target dialect) that make the target equal to the source.
    pub sync_statements: Vec<String>,
    pub elapsed_ms: u64,
}

/// One side of the comparison: where to read and how to write SQL for it.
struct Side<'a> {
    backend: &'a dyn DatabaseBackend,
    dialect: &'static dyn Dialect,
    database: &'a str,
    table_ref: String,
    select_list: String,
    key_list: String,
    /// Positions of the key columns inside the compared columns.
    key_positions: Vec<usize>,
}

impl<'a> Side<'a> {
    fn new(
        backend: &'a dyn DatabaseBackend,
        database: &'a str,
        table: &str,
        columns: &[String],
        key_columns: &[String],
    ) -> Result<Self, PyroError> {
        let dialect = backend.engine().dialect();
        let quote_all = |names: &[String]| -> Result<String, PyroError> {
            Ok(names
                .iter()
                .map(|n| dialect.quote_identifier(n))
                .collect::<Result<Vec<_>, _>>()?
                .join(", "))
        };
        Ok(Self {
            backend,
            dialect,
            database,
            table_ref: dialect.qualify_table(Some(database), table)?,
            select_list: quote_all(columns)?,
            key_list: quote_all(key_columns)?,
            key_positions: key_columns
                .iter()
                .map(|k| columns.iter().position(|c| c == k).unwrap())
                .collect(),
        })
    }

    /// `key > lower AND key <= upper` (row-value comparison for composite keys).
    fn range_predicate(&self, lower: Option<&[Value]>, upper: Option<&[Value]>) -> String {
        let tuple = |values: &[Value]| {
            let literals: Vec<String> = values.iter().map(|v| literal(self.dialect, v)).collect();
            if literals.len() == 1 {
                literals[0].clone()
            } else {
                format!("({})", literals.join(", "))
            }
        };
        let key = if self.key_positions.len() == 1 {
            self.key_list.clone()
        } else {
            format!("({})", self.key_list)
        };
        let mut parts = Vec::new();
        if let Some(lower) = lower {
            parts.push(format!("{key} > {}", tuple(lower)));
        }
        if let Some(upper) = upper {
            parts.push(format!("{key} <= {}", tuple(upper)));
        }
        if parts.is_empty() {
            String::new()
        } else {
            format!(" WHERE {}", parts.join(" AND "))
        }
    }

    async fn query(&self, sql: &str) -> Result<Vec<Vec<Value>>, PyroError> {
        Ok(self
            .backend
            .execute_query(sql, Some(self.database))
            .await?
            .rows)
    }

    /// Up to `CHUNK_ROWS` rows after `lower` (and not past `upper`), in key order.
    async fn page(
        &self,
        list: &str,
        lower: Option<&[Value]>,
        upper: Option<&[Value]>,
    ) -> Result<Vec<Vec<Value>>, PyroError> {
        let sql = format!(
            "SELECT {list} FROM {}{} ORDER BY {} LIMIT {CHUNK_ROWS}",
            self.table_ref,
            self.range_predicate(lower, upper),
            self.key_list
        );
        self.query(&sql).await
    }

    /// Row count and order-independent checksum of a key range (MariaDB/MySQL only).
    async fn checksum(
        &self,
        columns: &[String],
        lower: Option<&[Value]>,
        upper: Option<&[Value]>,
    ) -> Result<Vec<Option<String>>, PyroError> {
        let mut parts = Vec::with_capacity(columns.len() * 2);
        for column in columns {
            let quoted = self.dialect.quote_identifier(column)?;
            parts.push(quoted.clone());
            // CONCAT_WS skips NULLs: the flag keeps NULL and '' apart.
            parts.push(format!("ISNULL({quoted})"));
        }
        let sql = format!(
            "SELECT COUNT(*), \
             COALESCE(BIT_XOR(CAST(CONV(SUBSTRING(h, 1, 16), 16, 10) AS UNSIGNED)), 0), \
             COALESCE(BIT_XOR(CAST(CONV(SUBSTRING(h, 17, 16), 16, 10) AS UNSIGNED)), 0) \
             FROM (SELECT MD5(CONCAT_WS('#', {})) AS h FROM {}{}) AS pyro_chunk",
            parts.join(", "),
            self.table_ref,
            self.range_predicate(lower, upper)
        );
        let rows = self.query(&sql).await?;
        Ok(rows
            .into_iter()
            .next()
            .unwrap_or_default()
            .iter()
            .map(normalize)
            .collect())
    }

    fn key_of(&self, row: &[Value]) -> Vec<Value> {
        self.key_positions.iter().map(|&i| row[i].clone()).collect()
    }
}

/// Comparable form of a value; engines disagree on numbers vs. strings.
fn normalize(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::String(text) => Some(text.clone()),
        Value::Bool(flag) => Some(if *flag { "1" } else { "0" }.to_string()),
        other => Some(other.to_string()),
    }
}

fn key_signature(key: &[Value]) -> Vec<Option<String>> {
    key.iter().map(normalize).collect()
}

/// Literal for generated SQL. Unlike `Dialect::value_literal`, the text "NULL" stays a string.
fn literal(dialect: &dyn Dialect, value: &Value) -> String {
    match value {
        Value::Null => "NULL".into(),
        Value::Bool(flag) => if *flag { "1" } else { "0" }.into(),
        Value::Number(number) => number.to_string(),
        Value::String(text) => dialect.string_literal(text),
        other => dialect.string_literal(&other.to_string()),
    }
}

fn eq_ignore_case_position(names: &[String], wanted: &str) -> Option<usize> {
    names.iter().position(|n| n.eq_ignore_ascii_case(wanted))
}

struct Collector<'a> {
    result: DataCompareResult,
    limit: usize,
    target: &'a Side<'a>,
    columns: Vec<String>,
}

impl Collector<'_> {
    fn record(&mut self, diff: RowDifference) {
        match diff.kind {
            RowDifferenceKind::Insert => self.result.inserted += 1,
            RowDifferenceKind::Delete => self.result.deleted += 1,
            RowDifferenceKind::Update => self.result.modified += 1,
        }
        if self.result.differences.len() >= self.limit {
            self.result.truncated = true;
            return;
        }
        self.result.sync_statements.push(self.statement(&diff));
        self.result.differences.push(diff);
    }

    fn statement(&self, diff: &RowDifference) -> String {
        let t = self.target;
        let lit = |v: &Value| literal(t.dialect, v);
        let quote = |n: &str| {
            t.dialect
                .quote_identifier(n)
                .unwrap_or_else(|_| n.to_string())
        };
        let key_where = || {
            t.key_positions
                .iter()
                .zip(&diff.key)
                .map(|(&i, v)| format!("{} = {}", quote(&self.columns[i]), lit(v)))
                .collect::<Vec<_>>()
                .join(" AND ")
        };
        match diff.kind {
            RowDifferenceKind::Insert => {
                let values: Vec<String> = diff.source.as_ref().unwrap().iter().map(lit).collect();
                format!(
                    "INSERT INTO {} ({}) VALUES ({});",
                    t.table_ref,
                    t.select_list,
                    values.join(", ")
                )
            }
            RowDifferenceKind::Delete => {
                format!("DELETE FROM {} WHERE {};", t.table_ref, key_where())
            }
            RowDifferenceKind::Update => {
                let source = diff.source.as_ref().unwrap();
                let sets: Vec<String> = diff
                    .changed_columns
                    .iter()
                    .map(|c| {
                        let i = self.columns.iter().position(|n| n == c).unwrap();
                        format!("{} = {}", quote(c), lit(&source[i]))
                    })
                    .collect();
                format!(
                    "UPDATE {} SET {} WHERE {};",
                    t.table_ref,
                    sets.join(", "),
                    key_where()
                )
            }
        }
    }
}

/// Compares the rows of `source` and `target` in the key range `(lower, upper]`.
async fn diff_range(
    source: &Side<'_>,
    collector: &mut Collector<'_>,
    source_rows: Vec<Vec<Value>>,
    lower: Option<&[Value]>,
    upper: Option<&[Value]>,
) -> Result<(), PyroError> {
    let target = collector.target;
    // Source rows arrive in key order; the index keeps that order for the leftovers.
    let mut pending: HashMap<Vec<Option<String>>, (usize, Vec<Value>)> = source_rows
        .into_iter()
        .enumerate()
        .map(|(i, row)| (key_signature(&source.key_of(&row)), (i, row)))
        .collect();

    let mut after: Option<Vec<Value>> = lower.map(|l| l.to_vec());
    loop {
        let page = target
            .page(&target.select_list, after.as_deref(), upper)
            .await?;
        let page_len = page.len();
        collector.result.target_rows += page_len as u64;
        for target_row in page {
            let key = target.key_of(&target_row);
            match pending.remove(&key_signature(&key)) {
                None => collector.record(RowDifference {
                    kind: RowDifferenceKind::Delete,
                    key: key.clone(),
                    source: None,
                    target: Some(target_row.clone()),
                    changed_columns: Vec::new(),
                }),
                Some((_, source_row)) => {
                    let changed: Vec<String> = collector
                        .columns
                        .iter()
                        .enumerate()
                        .filter(|(i, _)| normalize(&source_row[*i]) != normalize(&target_row[*i]))
                        .map(|(_, c)| c.clone())
                        .collect();
                    if !changed.is_empty() {
                        collector.record(RowDifference {
                            kind: RowDifferenceKind::Update,
                            key: key.clone(),
                            source: Some(source_row),
                            target: Some(target_row.clone()),
                            changed_columns: changed,
                        });
                    }
                }
            }
            after = Some(key);
        }
        if page_len < CHUNK_ROWS {
            break;
        }
    }

    // What is left exists only in the source; report it in key order.
    let mut remaining: Vec<(usize, Vec<Value>)> = pending.into_values().collect();
    remaining.sort_by_key(|(i, _)| *i);
    for (_, row) in remaining {
        collector.record(RowDifference {
            kind: RowDifferenceKind::Insert,
            key: source.key_of(&row),
            source: Some(row),
            target: None,
            changed_columns: Vec::new(),
        });
    }
    Ok(())
}

pub async fn compare_table_data(
    source_backend: &dyn DatabaseBackend,
    target_backend: &dyn DatabaseBackend,
    request: &DataCompareRequest,
) -> Result<DataCompareResult, PyroError> {
    let started = Instant::now();
    let (src, tgt) = (&request.source, &request.target);

    let source_columns: Vec<String> = introspector(source_backend)
        .table_columns(source_backend, &src.database, &src.table)
        .await?
        .into_iter()
        .map(|c| c.name)
        .collect();
    let target_columns: Vec<String> = introspector(target_backend)
        .table_columns(target_backend, &tgt.database, &tgt.table)
        .await?
        .into_iter()
        .map(|c| c.name)
        .collect();
    if source_columns.is_empty() || target_columns.is_empty() {
        return Err(PyroError::InvalidOperation(
            "No se encontraron las columnas de una de las tablas.".into(),
        ));
    }

    let source_key = introspector(source_backend)
        .primary_key(source_backend, &src.database, &src.table)
        .await?
        .columns;
    let target_key = introspector(target_backend)
        .primary_key(target_backend, &tgt.database, &tgt.table)
        .await?
        .columns;
    if source_key.is_empty() || target_key.is_empty() {
        return Err(PyroError::InvalidOperation(
            "Ambas tablas necesitan clave primaria para comparar sus datos.".into(),
        ));
    }
    let same_key = source_key.len() == target_key.len()
        && source_key
            .iter()
            .zip(&target_key)
            .all(|(a, b)| a.eq_ignore_ascii_case(b));
    if !same_key {
        return Err(PyroError::InvalidOperation(format!(
            "Las claves primarias no coinciden: ({}) frente a ({}).",
            source_key.join(", "),
            target_key.join(", ")
        )));
    }

    // Compare the shared columns; the target names keep the target's spelling.
    let columns: Vec<String> = source_columns
        .iter()
        .filter(|c| eq_ignore_case_position(&target_columns, c).is_some())
        .cloned()
        .collect();
    let target_names: Vec<String> = columns
        .iter()
        .map(|c| target_columns[eq_ignore_case_position(&target_columns, c).unwrap()].clone())
        .collect();
    let target_key_names: Vec<String> = source_key
        .iter()
        .map(|k| target_columns[eq_ignore_case_position(&target_columns, k).unwrap()].clone())
        .collect();

    let source = Side::new(
        source_backend,
        &src.database,
        &src.table,
        &columns,
        &source_key,
    )?;
    let target = Side::new(
        target_backend,
        &tgt.database,
        &tgt.table,
        &target_names,
        &target_key_names,
    )?;
    let use_checksums =
        source_backend.engine() == DbEngine::MySql && target_backend.engine() == DbEngine::MySql;

    let mut collector = Collector {
        result: DataCompareResult {
            key_columns: source_key.clone(),
            columns: columns.clone(),
            source_only_columns: source_columns
                .iter()
                .filter(|c| eq_ignore_case_position(&target_columns, c).is_none())
                .cloned()
                .collect(),
            target_only_columns: target_columns
                .iter()
                .filter(|c| eq_ignore_case_position(&source_columns, c).is_none())
                .cloned()
                .collect(),
            used_checksums: use_checksums,
            ..Default::default()
        },
        limit: request
            .max_differences
            .unwrap_or(DEFAULT_MAX_DIFFERENCES)
            .clamp(1, MAX_DIFFERENCES_LIMIT),
        target: &target,
        columns: target_names.clone(),
    };

    // Walk the source in chunks; the last chunk is open-ended so rows beyond the
    // source's highest key are still found in the target.
    let mut lower: Option<Vec<Value>> = None;
    loop {
        let rows = source
            .page(&source.select_list, lower.as_deref(), None)
            .await?;
        let is_last = rows.len() < CHUNK_ROWS;
        let upper = if is_last {
            None
        } else {
            rows.last().map(|r| source.key_of(r))
        };
        collector.result.chunks += 1;

        let identical = if use_checksums {
            let a = source
                .checksum(&columns, lower.as_deref(), upper.as_deref())
                .await?;
            let b = target
                .checksum(&target_names, lower.as_deref(), upper.as_deref())
                .await?;
            a == b
        } else {
            false
        };

        collector.result.source_rows += rows.len() as u64;
        if identical {
            collector.result.identical_chunks += 1;
            collector.result.target_rows += rows.len() as u64;
        } else {
            diff_range(
                &source,
                &mut collector,
                rows,
                lower.as_deref(),
                upper.as_deref(),
            )
            .await?;
        }

        if is_last {
            break;
        }
        lower = upper;
    }

    let mut result = collector.result;
    result.elapsed_ms = started.elapsed().as_millis() as u64;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::sqlite::tests::TempDatabase;

    const SCHEMA: &str = "CREATE TABLE item (id INTEGER PRIMARY KEY, name TEXT, price REAL);";

    async fn compare(source: &TempDatabase, target: &TempDatabase) -> DataCompareResult {
        let side = |_: &TempDatabase| DataCompareSide {
            connection: None,
            database: "main".into(),
            table: "item".into(),
        };
        let request = DataCompareRequest {
            source: side(source),
            target: side(target),
            max_differences: None,
        };
        compare_table_data(&source.backend, &target.backend, &request)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn finds_inserted_deleted_and_modified_rows() {
        let source = TempDatabase::with_schema(SCHEMA).await;
        let target = TempDatabase::with_schema(SCHEMA).await;
        source
            .rows("INSERT INTO item VALUES (1, 'a', 1.5), (2, 'b', 2.0), (3, NULL, 3.0)")
            .await;
        target
            .rows("INSERT INTO item VALUES (1, 'a', 1.5), (2, 'B', 2.0), (3, '', 3.0), (9, 'x', 0)")
            .await;

        let result = compare(&source, &target).await;

        assert_eq!((result.source_rows, result.target_rows), (3, 4));
        assert_eq!(
            (result.inserted, result.deleted, result.modified),
            (0, 1, 2)
        );
        assert!(!result.truncated);
        assert_eq!(
            result.sync_statements,
            [
                "UPDATE \"main\".\"item\" SET \"name\" = 'b' WHERE \"id\" = 2;",
                "UPDATE \"main\".\"item\" SET \"name\" = NULL WHERE \"id\" = 3;",
                "DELETE FROM \"main\".\"item\" WHERE \"id\" = 9;",
            ]
        );
    }

    #[tokio::test]
    async fn spans_several_chunks_and_reports_missing_rows() {
        let source = TempDatabase::with_schema(SCHEMA).await;
        let target = TempDatabase::with_schema(SCHEMA).await;
        let fill =
            "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2500) \
                    INSERT INTO item SELECT i, 'row' || i, i FROM n";
        source.rows(fill).await;
        target.rows(fill).await;
        target.rows("DELETE FROM item WHERE id IN (5, 1500)").await;

        let result = compare(&source, &target).await;

        assert_eq!(result.chunks, 3);
        assert_eq!(result.inserted, 2);
        assert_eq!(result.deleted + result.modified, 0);
        let keys: Vec<_> = result
            .differences
            .iter()
            .map(|d| d.key[0].clone())
            .collect();
        assert_eq!(keys, [Value::from(5), Value::from(1500)]);
        assert!(result.sync_statements[0].starts_with("INSERT INTO \"main\".\"item\""));
    }

    #[tokio::test]
    async fn rejects_tables_without_primary_key() {
        let source = TempDatabase::with_schema("CREATE TABLE item (id INTEGER, name TEXT);").await;
        let target = TempDatabase::with_schema(SCHEMA).await;
        let request = DataCompareRequest {
            source: DataCompareSide {
                connection: None,
                database: "main".into(),
                table: "item".into(),
            },
            target: DataCompareSide {
                connection: None,
                database: "main".into(),
                table: "item".into(),
            },
            max_differences: None,
        };
        assert!(
            compare_table_data(&source.backend, &target.backend, &request)
                .await
                .is_err()
        );
    }
}
