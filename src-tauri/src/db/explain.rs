use super::backend::DatabaseBackend;
use super::error::PyroError;
use super::models::{ExplainNode, ExplainRow, SlowQueryAnalysis};
use super::query::value_to_i64;

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
                .or_else(|| value_to_i64(v).map(|n| n.to_string()))
        });
        let r_ref = ref_idx
            .and_then(|i| r.get(i))
            .and_then(|v| v.as_str())
            .filter(|s| !s.eq_ignore_ascii_case("null"))
            .map(|s| s.to_string());
        let row_count = rows_idx
            .and_then(|i| r.get(i))
            .and_then(value_to_i64)
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

    // Try EXPLAIN FORMAT=TREE if supported (MySQL 8.0.16+ / MariaDB)
    let tree_plan = {
        let tree_sql = format!("EXPLAIN FORMAT=TREE {trimmed}");
        if let Ok(tree_res) = backend.execute_query(&tree_sql, database).await {
            tree_res
                .rows
                .first()
                .and_then(|r| r.first())
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        } else {
            None
        }
    };

    // Safe detection of ANALYZE support using benign SELECT 1 without executing user query
    let is_analyze_supported = {
        backend
            .execute_query("ANALYZE FORMAT=JSON SELECT 1", database)
            .await
            .is_ok()
            || backend
                .execute_query("EXPLAIN ANALYZE SELECT 1", database)
                .await
                .is_ok()
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
        tree_plan,
    })
}

use super::models::{AnalyzeExecutionResult, HealthSeverity, NodeTelemetry, PlanDiscrepancy};
use super::safe_mode::{analyze_sql_safety, DangerLevel};

/// Safely executes `ANALYZE FORMAT=JSON` (or fallback `EXPLAIN ANALYZE`),
/// extracting execution telemetry (r_rows, r_loops, r_table_time_ms) and comparing
/// against optimizer estimates to highlight discrepancies.
pub async fn execute_analyze_format_json(
    backend: &dyn DatabaseBackend,
    database: Option<&str>,
    sql: &str,
    allow_execution: bool,
) -> Result<AnalyzeExecutionResult, PyroError> {
    let trimmed = sql.trim().trim_end_matches(';');

    // 1. Safety check: ANALYZE executes the query!
    let safety = analyze_sql_safety(trimmed);
    if (safety.is_destructive
        || safety.danger_level == DangerLevel::Critical
        || safety.requires_explicit_confirmation)
        && !allow_execution
    {
        return Err(PyroError::InvalidOperation(format!(
            "ANALYZE FORMAT=JSON ejecuta la instrucción en el servidor. La sentencia fue clasificada como '{:?}' ({}). Requiere confirmación explícita para ejecutarse.",
            safety.danger_level, safety.message
        )));
    }

    // 2. Execute ANALYZE FORMAT=JSON
    let analyze_sql = format!("ANALYZE FORMAT=JSON {trimmed}");
    let start = std::time::Instant::now();
    let res = backend.execute_query(&analyze_sql, database).await?;
    let duration_ms = start.elapsed().as_secs_f64() * 1000.0;

    // 3. Extract JSON plan
    let raw_str = res
        .rows
        .first()
        .and_then(|r| r.first())
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            PyroError::Database("El servidor no retornó un plan JSON válido para ANALYZE".into())
        })?;

    let json_val: serde_json::Value = serde_json::from_str(raw_str)
        .map_err(|e| PyroError::Database(format!("Error parseando JSON de ANALYZE: {e}")))?;

    // 4. Extract telemetry and discrepancies recursively
    let mut node_telemetry = Vec::new();
    let mut discrepancies = Vec::new();
    let mut total_actual_rows = 0.0;
    let mut total_estimated_rows = 0.0;
    let mut warnings = Vec::new();

    extract_telemetry_recursive(
        &json_val,
        &mut node_telemetry,
        &mut discrepancies,
        &mut total_actual_rows,
        &mut total_estimated_rows,
    );

    if discrepancies.is_empty() {
        warnings.push("Las estimaciones del optimizador coinciden razonablemente con la telemetría real de ejecución.".into());
    }

    Ok(AnalyzeExecutionResult {
        sql: sql.to_string(),
        total_execution_time_ms: duration_ms,
        estimated_total_rows: total_estimated_rows,
        actual_total_rows: total_actual_rows,
        json_plan: json_val,
        discrepancies,
        node_telemetry,
        rows_affected: res.affected_rows,
        warnings,
    })
}

fn extract_telemetry_recursive(
    value: &serde_json::Value,
    nodes: &mut Vec<NodeTelemetry>,
    discrepancies: &mut Vec<PlanDiscrepancy>,
    total_actual: &mut f64,
    total_est: &mut f64,
) {
    match value {
        serde_json::Value::Object(map) => {
            // Check if map represents a table access
            if let Some(tbl) = map.get("table").and_then(|v| v.as_object()) {
                let table_name = tbl
                    .get("table_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("—")
                    .to_string();
                let access_type = tbl
                    .get("access_type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("ALL")
                    .to_string();

                let est_rows = tbl.get("rows").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let act_rows = tbl.get("r_rows").and_then(|v| v.as_f64());
                let est_filt = tbl.get("filtered").and_then(|v| v.as_f64());
                let act_filt = tbl.get("r_filtered").and_then(|v| v.as_f64());
                let loops = tbl.get("r_loops").and_then(|v| v.as_u64());
                let read_time = tbl.get("r_table_time_ms").and_then(|v| v.as_f64());

                *total_est += est_rows;
                if let Some(ar) = act_rows {
                    *total_actual += ar;
                }

                let ratio = if let Some(ar) = act_rows {
                    if est_rows > 0.0 {
                        Some(ar / est_rows)
                    } else if ar > 0.0 {
                        Some(ar)
                    } else {
                        Some(1.0)
                    }
                } else {
                    None
                };

                // Check for significant discrepancies
                if let (Some(ar), Some(r)) = (act_rows, ratio) {
                    if r >= 10.0 && ar >= 100.0 {
                        discrepancies.push(PlanDiscrepancy {
                            target: table_name.clone(),
                            metric: "Filas Examinadas (Subestimación Severa)".into(),
                            estimated: est_rows,
                            actual: ar,
                            ratio: r,
                            severity: HealthSeverity::Critical,
                            description: format!(
                                "El optimizador estimó {} filas pero el motor examinó {} filas reales ({}x más).",
                                est_rows, ar, r as u64
                            ),
                            recommendation: format!(
                                "Ejecuta 'ANALYZE TABLE `{}`' para actualizar estadísticas de cardinalidad o revisa si faltan índices compuestos en las condiciones WHERE/JOIN.",
                                table_name
                            ),
                        });
                    } else if r >= 3.0 && ar >= 50.0 {
                        discrepancies.push(PlanDiscrepancy {
                            target: table_name.clone(),
                            metric: "Filas Examinadas (Subestimación Moderada)".into(),
                            estimated: est_rows,
                            actual: ar,
                            ratio: r,
                            severity: HealthSeverity::Warning,
                            description: format!(
                                "Se examinaron {} filas reales frente a {} estimadas ({}x).",
                                ar, est_rows, r as u64
                            ),
                            recommendation: format!(
                                "Considera actualizar estadísticas con 'ANALYZE TABLE `{}`'.",
                                table_name
                            ),
                        });
                    } else if r <= 0.1 && est_rows >= 500.0 {
                        discrepancies.push(PlanDiscrepancy {
                            target: table_name.clone(),
                            metric: "Filas Examinadas (Sobreestimación)".into(),
                            estimated: est_rows,
                            actual: ar,
                            ratio: r,
                            severity: HealthSeverity::Information,
                            description: format!(
                                "El optimizador sobreestimó las filas (estimó {}, examinó {}).",
                                est_rows, ar
                            ),
                            recommendation: "El plan fue conservador; no requiere acción inmediata a menos que haya forzado un tipo de join inadecuado.".into(),
                        });
                    }
                }

                // Check loops discrepancy
                if let Some(l) = loops {
                    if l > 1000 {
                        discrepancies.push(PlanDiscrepancy {
                            target: table_name.clone(),
                            metric: "Iteraciones de Bucle (r_loops)".into(),
                            estimated: 1.0,
                            actual: l as f64,
                            ratio: l as f64,
                            severity: HealthSeverity::Warning,
                            description: format!(
                                "La tabla '{}' fue iterada {} veces en un Nested Loop Join.",
                                table_name, l
                            ),
                            recommendation: format!(
                                "Asegura que la clave de unión en '{}' esté indexada para convertir el Nested Loop a un acceso directo por índice.",
                                table_name
                            ),
                        });
                    }
                }

                nodes.push(NodeTelemetry {
                    table_name,
                    access_type,
                    estimated_rows: est_rows,
                    actual_rows: act_rows,
                    estimated_filtered: est_filt,
                    actual_filtered: act_filt,
                    loops,
                    read_time_ms: read_time,
                    discrepancy_ratio: ratio,
                });
            }

            // Recurse into all keys
            for val in map.values() {
                extract_telemetry_recursive(val, nodes, discrepancies, total_actual, total_est);
            }
        }
        serde_json::Value::Array(arr) => {
            for item in arr {
                extract_telemetry_recursive(item, nodes, discrepancies, total_actual, total_est);
            }
        }
        _ => {}
    }
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

    #[test]
    fn test_extract_analyze_telemetry_discrepancy() {
        let json_sample = serde_json::json!({
            "query_block": {
                "select_id": 1,
                "r_total_time_ms": 14.5,
                "table": {
                    "table_name": "orders",
                    "access_type": "ALL",
                    "rows": 10,
                    "r_rows": 1500,
                    "filtered": 100.0,
                    "r_filtered": 25.0,
                    "r_loops": 1,
                    "r_table_time_ms": 12.3
                }
            }
        });

        let mut nodes = Vec::new();
        let mut discrepancies = Vec::new();
        let mut total_actual = 0.0;
        let mut total_est = 0.0;

        extract_telemetry_recursive(
            &json_sample,
            &mut nodes,
            &mut discrepancies,
            &mut total_actual,
            &mut total_est,
        );

        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].table_name, "orders");
        assert_eq!(nodes[0].estimated_rows, 10.0);
        assert_eq!(nodes[0].actual_rows, Some(1500.0));
        assert_eq!(total_actual, 1500.0);
        assert_eq!(total_est, 10.0);

        // Discrepancy detected (1500 vs 10 is 150x ratio -> Critical)
        assert_eq!(discrepancies.len(), 1);
        assert_eq!(discrepancies[0].target, "orders");
        assert_eq!(discrepancies[0].severity, HealthSeverity::Critical);
        assert!(discrepancies[0].description.contains("150x"));
    }
}
