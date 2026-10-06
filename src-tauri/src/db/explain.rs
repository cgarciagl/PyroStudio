use super::backend::DatabaseBackend;
use super::error::PyroError;
use super::models::{ExplainNode, ExplainRow, SlowQueryAnalysis};

/// Parses raw query result into structured `Vec<ExplainRow>`.
pub fn parse_explain_rows(columns: &[String], rows: &[Vec<serde_json::Value>]) -> Vec<ExplainRow> {
    let cols_lower: Vec<String> = columns.iter().map(|c| c.to_lowercase()).collect();
    let id_idx = cols_lower.iter().position(|c| c == "id");
    let sel_type_idx = cols_lower.iter().position(|c| c == "select_type");
    let tbl_idx = cols_lower.iter().position(|c| c == "table");
    let part_idx = cols_lower.iter().position(|c| c == "partitions");
    let type_idx = cols_lower.iter().position(|c| c == "type");
    let poss_keys_idx = cols_lower.iter().position(|c| c == "possible_keys");
    let key_idx = cols_lower.iter().position(|c| c == "key");
    let key_len_idx = cols_lower.iter().position(|c| c == "key_len");
    let ref_idx = cols_lower.iter().position(|c| c == "ref");
    let rows_idx = cols_lower.iter().position(|c| c == "rows");
    let filt_idx = cols_lower.iter().position(|c| c == "filtered");
    let extra_idx = cols_lower.iter().position(|c| c == "extra");

    let mut result = Vec::new();

    for r in rows {
        let id_val = id_idx
            .and_then(|i| r.get(i))
            .cloned()
            .unwrap_or(serde_json::json!(1));
        let select_type = sel_type_idx
            .and_then(|i| r.get(i))
            .and_then(|v| v.as_str())
            .unwrap_or("SIMPLE")
            .to_string();
        let table = tbl_idx
            .and_then(|i| r.get(i))
            .and_then(|v| v.as_str())
            .unwrap_or("—")
            .to_string();
        let partitions = part_idx
            .and_then(|i| r.get(i))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let access_type = type_idx
            .and_then(|i| r.get(i))
            .and_then(|v| v.as_str())
            .unwrap_or("ALL")
            .to_string();
        let possible_keys = poss_keys_idx
            .and_then(|i| r.get(i))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let key = key_idx
            .and_then(|i| r.get(i))
            .and_then(|v| v.as_str())
            .filter(|s| !s.eq_ignore_ascii_case("null"))
            .map(|s| s.to_string());
        let key_len = key_len_idx.and_then(|i| r.get(i)).and_then(|v| {
            v.as_str()
                .map(|s| s.to_string())
                .or_else(|| v.as_i64().map(|n| n.to_string()))
        });
        let r_ref = ref_idx
            .and_then(|i| r.get(i))
            .and_then(|v| v.as_str())
            .filter(|s| !s.eq_ignore_ascii_case("null"))
            .map(|s| s.to_string());
        let row_count = rows_idx
            .and_then(|i| r.get(i))
            .and_then(|v| {
                v.as_i64()
                    .or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok()))
            })
            .unwrap_or(0);
        let filtered = filt_idx.and_then(|i| r.get(i)).and_then(|v| {
            v.as_f64()
                .or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok()))
        });
        let extra = extra_idx
            .and_then(|i| r.get(i))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        result.push(ExplainRow {
            id: id_val,
            select_type,
            table,
            partitions,
            r#type: access_type,
            possible_keys,
            key,
            key_len,
            r#ref: r_ref,
            rows: row_count,
            filtered,
            extra,
        });
    }

    result
}

/// Converts tabular EXPLAIN rows into a hierarchical execution tree for visualization.
pub fn build_visual_explain_tree(rows: &[ExplainRow]) -> Vec<ExplainNode> {
    let mut nodes = Vec::new();

    for (idx, r) in rows.iter().enumerate() {
        let possible = r
            .possible_keys
            .as_deref()
            .map(|s| {
                s.split(',')
                    .map(|k| k.trim().to_string())
                    .filter(|k| !k.is_empty())
                    .collect()
            })
            .unwrap_or_default();

        let refs = r
            .r#ref
            .as_deref()
            .map(|s| {
                s.split(',')
                    .map(|k| k.trim().to_string())
                    .filter(|k| !k.is_empty())
                    .collect()
            })
            .unwrap_or_default();

        let mut flags = Vec::new();
        if let Some(extra) = &r.extra {
            if extra.contains("Using filesort") {
                flags.push("Using filesort".to_string());
            }
            if extra.contains("Using temporary") {
                flags.push("Using temporary".to_string());
            }
            if extra.contains("Using index") {
                flags.push("Using index (Covering)".to_string());
            }
            if extra.contains("Using where") {
                flags.push("Using where".to_string());
            }
            if extra.contains("Using join buffer") {
                flags.push("Using join buffer".to_string());
            }
        }

        nodes.push(ExplainNode {
            id: idx + 1,
            select_type: r.select_type.clone(),
            table_name: r.table.clone(),
            access_type: r.r#type.to_uppercase(),
            possible_keys: possible,
            key: r.key.clone(),
            key_len: r.key_len.clone(),
            ref_columns: refs,
            estimated_rows: r.rows as f64,
            filtered_percent: r.filtered,
            actual_rows: None,
            actual_time_ms: None,
            cost_info: None,
            flags,
            attached_condition: None,
            children: Vec::new(),
        });
    }

    nodes
}

/// Analyzes an SQL query with EXPLAIN / EXPLAIN ANALYZE to detect bottlenecks and suggest fixes.
pub async fn analyze_slow_query(
    backend: &dyn DatabaseBackend,
    database: Option<&str>,
    sql: &str,
) -> Result<SlowQueryAnalysis, PyroError> {
    let trimmed = sql.trim().trim_end_matches(';');
    let explain_sql = format!("EXPLAIN {trimmed}");

    let res = backend.execute_query(&explain_sql, database).await?;
    let explain_rows = parse_explain_rows(&res.columns, &res.rows);
    let visual_nodes = build_visual_explain_tree(&explain_rows);

    let mut bottlenecks = Vec::new();
    let mut indexes_involved = Vec::new();
    let mut potential_optimizations = Vec::new();
    let mut estimated_total_rows: f64 = 0.0;

    let has_multiple_tables = explain_rows.len() > 1;

    for row in &explain_rows {
        estimated_total_rows += row.rows as f64;

        if let Some(ref k) = row.key {
            if !indexes_involved.contains(k) {
                indexes_involved.push(k.clone());
            }
        }

        let access = row.r#type.to_uppercase();
        if access == "ALL" {
            bottlenecks.push(format!(
                "Full Table Scan en tabla '{}' (~{} filas examinadas)",
                row.table, row.rows
            ));
            potential_optimizations.push(format!(
                "Crear un índice en '{}' sobre las columnas usadas en WHERE o JOIN para evitar escaneo completo de tabla (tipo 'ALL').",
                row.table
            ));
        } else if access == "INDEX" {
            bottlenecks.push(format!(
                "Full Index Scan en tabla '{}' (escaneo de todo el árbol de índice)",
                row.table
            ));
        }

        if let Some(ref extra) = row.extra {
            if extra.contains("Using filesort") {
                bottlenecks.push(format!(
                    "Operación 'Using filesort' en tabla '{}': ordenamiento en memoria/disco",
                    row.table
                ));
                potential_optimizations.push(format!(
                    "Agregar un índice compuesto en '{}' que incluya las columnas de ORDER BY para evitar 'Using filesort'.",
                    row.table
                ));
            }

            if extra.contains("Using temporary") {
                bottlenecks.push(format!(
                    "Operación 'Using temporary' en tabla '{}': creación de tabla temporal",
                    row.table
                ));
                potential_optimizations.push(format!(
                    "Optimizar cláusulas GROUP BY / DISTINCT en '{}' para evitar la creación de tablas temporales en disco.",
                    row.table
                ));
            }
        }
    }

    let join_strategy = if has_multiple_tables {
        let uses_join_buf = explain_rows.iter().any(|r| {
            r.extra
                .as_deref()
                .unwrap_or("")
                .contains("Using join buffer")
        });
        if uses_join_buf {
            Some("Block Nested Loop / Hash Join (Con Join Buffer)".to_string())
        } else if explain_rows.iter().any(|r| {
            r.r#type.eq_ignore_ascii_case("eq_ref") || r.r#type.eq_ignore_ascii_case("ref")
        }) {
            Some("Indexed Nested Loop Join".to_string())
        } else {
            Some("Nested Loop Join (Sin índice completo)".to_string())
        }
    } else {
        None
    };

    // Try EXPLAIN FORMAT=JSON for deeper optimizer cost
    let json_plan = {
        let json_sql = format!("EXPLAIN FORMAT=JSON {trimmed}");
        if let Ok(json_res) = backend.execute_query(&json_sql, database).await {
            if let Some(first_row) = json_res.rows.first() {
                if let Some(first_col) = first_row.first() {
                    if let Some(raw_str) = first_col.as_str() {
                        serde_json::from_str::<serde_json::Value>(raw_str).ok()
                    } else {
                        Some(first_col.clone())
                    }
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        }
    };

    // Try EXPLAIN ANALYZE if supported (MariaDB 10.5+ / MySQL 8.0+)
    let is_analyze_supported = {
        let analyze_sql = format!("EXPLAIN ANALYZE {trimmed}");
        backend.execute_query(&analyze_sql, database).await.is_ok()
    };

    if potential_optimizations.is_empty() {
        potential_optimizations.push(
            "La consulta está optimizada y utiliza los índices disponibles eficazmente."
                .to_string(),
        );
    }

    Ok(SlowQueryAnalysis {
        sql: sql.to_string(),
        execution_plan: explain_rows,
        json_plan,
        visual_nodes,
        bottlenecks,
        indexes_involved,
        estimated_total_rows,
        actual_rows: None,
        actual_time_ms: None,
        join_strategy,
        potential_optimizations,
        is_analyze_supported,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_explain_rows_and_tree() {
        let cols = vec![
            "id".to_string(),
            "select_type".to_string(),
            "table".to_string(),
            "type".to_string(),
            "possible_keys".to_string(),
            "key".to_string(),
            "key_len".to_string(),
            "ref".to_string(),
            "rows".to_string(),
            "filtered".to_string(),
            "Extra".to_string(),
        ];
        let rows = vec![vec![
            serde_json::json!(1),
            serde_json::json!("SIMPLE"),
            serde_json::json!("users"),
            serde_json::json!("ALL"),
            serde_json::Value::Null,
            serde_json::Value::Null,
            serde_json::Value::Null,
            serde_json::Value::Null,
            serde_json::json!(5000),
            serde_json::json!(100.0),
            serde_json::json!("Using where; Using filesort"),
        ]];

        let parsed = parse_explain_rows(&cols, &rows);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].table, "users");
        assert_eq!(parsed[0].r#type, "ALL");
        assert_eq!(parsed[0].rows, 5000);

        let tree = build_visual_explain_tree(&parsed);
        assert_eq!(tree.len(), 1);
        assert!(tree[0].flags.contains(&"Using filesort".to_string()));
    }
}
