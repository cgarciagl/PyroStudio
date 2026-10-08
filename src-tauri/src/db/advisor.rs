use std::collections::{BTreeMap, HashMap};
use super::backend::DatabaseBackend;
use super::error::PyroError;
use super::models::{IndexAdvisorReport, IndexColumn, IndexMetadata, IndexRecommendation};
use super::query::{value_to_i64, value_to_u64};

/// Finds redundant indexes using the leftmost prefix rule.
pub fn find_redundant_indexes(
    table_name: &str,
    indexes: &[IndexMetadata],
) -> Vec<IndexRecommendation> {
    let mut recommendations = Vec::new();

    for i in 0..indexes.len() {
        let idx_a = &indexes[i];
        let cols_a: Vec<&str> = idx_a
            .columns
            .iter()
            .map(|c| c.column_name.as_str())
            .collect();

        for j in 0..indexes.len() {
            if i == j {
                continue;
            }
            let idx_b = &indexes[j];
            let cols_b: Vec<&str> = idx_b
                .columns
                .iter()
                .map(|c| c.column_name.as_str())
                .collect();

            // Check exact duplicate
            if cols_a == cols_b
                && !idx_a.is_primary
                && !idx_b.is_primary
                && idx_a.key_name > idx_b.key_name
            {
                recommendations.push(IndexRecommendation {
                    table_name: table_name.to_string(),
                    recommendation: format!("Eliminar índice duplicado '{}'", idx_a.key_name),
                    reason: format!(
                        "El índice '{}' tiene exactamente las mismas columnas ({}) que el índice '{}'.",
                        idx_a.key_name,
                        cols_a.join(", "),
                        idx_b.key_name
                    ),
                    estimated_benefit: "Ahorro de espacio en disco y reducción de sobrecarga de I/O en INSERT/UPDATE/DELETE.".to_string(),
                    potential_cost: "Ninguno (el índice equivalente cubre todas las consultas).".to_string(),
                    sql_proposal: format!("ALTER TABLE `{table_name}` DROP INDEX `{}`;", idx_a.key_name),
                    index_name: idx_a.key_name.clone(),
                    columns: cols_a.iter().map(|s| s.to_string()).collect(),
                    is_redundant: true,
                    redundant_with: Some(idx_b.key_name.clone()),
                });
                break;
            }

            // Check leftmost prefix: If cols_a is a strict prefix of cols_b and neither is unique with special constraints
            if !idx_a.is_primary
                && !idx_a.is_unique
                && cols_b.len() > cols_a.len()
                && cols_b.starts_with(&cols_a)
            {
                recommendations.push(IndexRecommendation {
                    table_name: table_name.to_string(),
                    recommendation: format!("Eliminar índice redundante por prefijo izquierdo '{}'", idx_a.key_name),
                    reason: format!(
                        "El índice '{}' ({}) es un prefijo exacto del índice más amplio '{}' ({}). MariaDB puede usar el índice compuesto para búsquedas por prefijo.",
                        idx_a.key_name,
                        cols_a.join(", "),
                        idx_b.key_name,
                        cols_b.join(", ")
                    ),
                    estimated_benefit: "Liberación de memoria en buffer pool y aceleración de escrituras.".to_string(),
                    potential_cost: "Bajo o nulo.".to_string(),
                    sql_proposal: format!("ALTER TABLE `{table_name}` DROP INDEX `{}`;", idx_a.key_name),
                    index_name: idx_a.key_name.clone(),
                    columns: cols_a.iter().map(|s| s.to_string()).collect(),
                    is_redundant: true,
                    redundant_with: Some(idx_b.key_name.clone()),
                });
                break;
            }
        }
    }

    recommendations
}

/// Analyzes an entire database schema using high-performance bulk queries.
pub async fn analyze_database_indexes(
    backend: &dyn DatabaseBackend,
    database: &str,
) -> Result<IndexAdvisorReport, PyroError> {
    analyze_indexes_internal(backend, database, None).await
}

/// Analyzes a single table specifically.
pub async fn analyze_table_indexes(
    backend: &dyn DatabaseBackend,
    database: &str,
    table_name: &str,
) -> Result<IndexAdvisorReport, PyroError> {
    analyze_indexes_internal(backend, database, Some(table_name)).await
}

async fn analyze_indexes_internal(
    backend: &dyn DatabaseBackend,
    database: &str,
    target_table: Option<&str>,
) -> Result<IndexAdvisorReport, PyroError> {
    let clean_db = database.replace('\'', "''");

    // Build filter clause if target table is specified
    let table_filter = match target_table {
        Some(tbl) => format!("AND TABLE_NAME = '{}'", tbl.replace('\'', "''")),
        None => String::new(),
    };

    // 1. Bulk query all indexes from information_schema.STATISTICS (1 single fast query)
    let stats_sql = format!(
        r#"
        SELECT 
            TABLE_NAME,
            INDEX_NAME,
            NON_UNIQUE,
            INDEX_TYPE,
            SEQ_IN_INDEX,
            COLUMN_NAME,
            SUB_PART,
            COLLATION,
            INDEX_COMMENT
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = '{clean_db}' {table_filter}
        ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;
        "#
    );

    // Map: table_name -> (map: key_name -> IndexMetadata)
    let mut tables_indexes_map: HashMap<String, BTreeMap<String, IndexMetadata>> = HashMap::new();

    if let Ok(stats_res) = backend.execute_query(&stats_sql, Some(database)).await {
        let col_idx = |name: &str| -> usize {
            stats_res
                .columns
                .iter()
                .position(|c| c.eq_ignore_ascii_case(name))
                .unwrap_or(999)
        };

        let t_idx = col_idx("TABLE_NAME");
        let kn_idx = col_idx("INDEX_NAME");
        let nu_idx = col_idx("NON_UNIQUE");
        let it_idx = col_idx("INDEX_TYPE");
        let seq_idx = col_idx("SEQ_IN_INDEX");
        let cn_idx = col_idx("COLUMN_NAME");
        let sp_idx = col_idx("SUB_PART");
        let col_col_idx = col_idx("COLLATION");
        let ic_idx = col_idx("INDEX_COMMENT");

        for row in &stats_res.rows {
            let table_name = row.get(t_idx).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let key_name = row.get(kn_idx).and_then(|v| v.as_str()).unwrap_or("").to_string();
            if table_name.is_empty() || key_name.is_empty() {
                continue;
            }

            let non_unique = row.get(nu_idx).and_then(value_to_i64).unwrap_or(1);
            let is_unique = non_unique == 0;
            let is_primary = key_name == "PRIMARY";
            let index_type = row.get(it_idx).and_then(|v| v.as_str()).unwrap_or("BTREE").to_string();
            let seq = row.get(seq_idx).and_then(value_to_u64).unwrap_or(1) as u32;
            let col_name = row.get(cn_idx).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let sub_part = row.get(sp_idx).and_then(value_to_i64);
            let collation = row.get(col_col_idx).and_then(|v| v.as_str()).map(|s| s.to_string());
            let comment_str = row.get(ic_idx).and_then(|v| v.as_str()).map(|s| s.to_string());

            let col = IndexColumn {
                seq_in_index: seq,
                column_name: col_name,
                sub_part,
                collation,
            };

            let table_map = tables_indexes_map.entry(table_name).or_default();
            let entry = table_map.entry(key_name.clone()).or_insert_with(|| IndexMetadata {
                key_name,
                is_primary,
                is_unique,
                index_type,
                columns: vec![],
                comment: comment_str,
            });
            entry.columns.push(col);
        }
    }

    // 2. Bulk query unindexed foreign keys (1 single fast query)
    let fk_sql = format!(
        r#"
        SELECT 
            TABLE_NAME,
            CONSTRAINT_NAME,
            COLUMN_NAME,
            REFERENCED_TABLE_NAME,
            REFERENCED_COLUMN_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = '{clean_db}' {table_filter}
          AND REFERENCED_TABLE_NAME IS NOT NULL;
        "#
    );

    // Map: table_name -> Vec<(col_name, ref_tbl)>
    let mut tables_fk_map: HashMap<String, Vec<(String, String)>> = HashMap::new();

    if let Ok(fk_res) = backend.execute_query(&fk_sql, Some(database)).await {
        let col_idx = |name: &str| -> usize {
            fk_res
                .columns
                .iter()
                .position(|c| c.eq_ignore_ascii_case(name))
                .unwrap_or(999)
        };

        let t_idx = col_idx("TABLE_NAME");
        let cn_idx = col_idx("COLUMN_NAME");
        let rt_idx = col_idx("REFERENCED_TABLE_NAME");

        for row in &fk_res.rows {
            let table_name = row.get(t_idx).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let col_name = row.get(cn_idx).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let ref_tbl = row.get(rt_idx).and_then(|v| v.as_str()).unwrap_or("").to_string();

            if !table_name.is_empty() && !col_name.is_empty() {
                tables_fk_map.entry(table_name).or_default().push((col_name, ref_tbl));
            }
        }
    }

    // 3. Process analysis in memory
    let mut recommendations = Vec::new();
    let mut redundant_count = 0;
    let mut missing_count = 0;

    let analyzed_tables_count = if target_table.is_some() {
        1
    } else {
        let mut all_tables = std::collections::HashSet::new();
        for k in tables_indexes_map.keys() {
            all_tables.insert(k.clone());
        }
        for k in tables_fk_map.keys() {
            all_tables.insert(k.clone());
        }
        if all_tables.is_empty() {
            1
        } else {
            all_tables.len()
        }
    };

    for (table_name, indexes_map) in &tables_indexes_map {
        let index_list: Vec<IndexMetadata> = indexes_map.values().cloned().collect();

        // Check redundant indexes
        let redundant = find_redundant_indexes(table_name, &index_list);
        redundant_count += redundant.len();
        recommendations.extend(redundant);

        // Check FKs for this table
        if let Some(fks) = tables_fk_map.get(table_name) {
            for (col_name, ref_tbl) in fks {
                let is_indexed = index_list.iter().any(|idx| {
                    idx.columns
                        .first()
                        .map(|c| c.column_name.as_str() == col_name)
                        .unwrap_or(false)
                });

                if !is_indexed {
                    let new_idx_name = format!("idx_{}_{}", table_name, col_name);
                    missing_count += 1;
                    recommendations.push(IndexRecommendation {
                        table_name: table_name.clone(),
                        recommendation: format!("Crear índice sobre Foreign Key '{col_name}'"),
                        reason: format!(
                            "La columna '{col_name}' referencia a '{ref_tbl}' pero no tiene un índice como columna líder. Esto puede causar bloqueos de tabla completa y JOINs lentos.",
                        ),
                        estimated_benefit: "Alta aceleración en JOINs, eliminaciones y comprobaciones de integridad referencial.".to_string(),
                        potential_cost: "Leve incremento en almacenamiento y costo de escritura.".to_string(),
                        sql_proposal: format!(
                            "ALTER TABLE `{}` ADD INDEX `{}` (`{}`);",
                            table_name, new_idx_name, col_name
                        ),
                        index_name: new_idx_name,
                        columns: vec![col_name.clone()],
                        is_redundant: false,
                        redundant_with: None,
                    });
                }
            }
        }
    }

    Ok(IndexAdvisorReport {
        database_name: database.to_string(),
        recommendations,
        redundant_indexes_count: redundant_count,
        missing_indexes_count: missing_count,
        analyzed_tables_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::IndexColumn;

    #[test]
    fn test_detect_prefix_redundant_index() {
        let composite = IndexMetadata {
            key_name: "idx_user_status_created".to_string(),
            is_primary: false,
            is_unique: false,
            index_type: "BTREE".to_string(),
            columns: vec![
                IndexColumn {
                    seq_in_index: 1,
                    column_name: "status".to_string(),
                    sub_part: None,
                    collation: Some("A".to_string()),
                },
                IndexColumn {
                    seq_in_index: 2,
                    column_name: "created_at".to_string(),
                    sub_part: None,
                    collation: Some("A".to_string()),
                },
            ],
            comment: None,
        };

        let simple = IndexMetadata {
            key_name: "idx_status".to_string(),
            is_primary: false,
            is_unique: false,
            index_type: "BTREE".to_string(),
            columns: vec![IndexColumn {
                seq_in_index: 1,
                column_name: "status".to_string(),
                sub_part: None,
                collation: Some("A".to_string()),
            }],
            comment: None,
        };

        let recs = find_redundant_indexes("users", &[composite, simple]);
        assert_eq!(recs.len(), 1);
        assert_eq!(recs[0].index_name, "idx_status");
        assert!(recs[0].is_redundant);
        assert_eq!(
            recs[0].redundant_with,
            Some("idx_user_status_created".to_string())
        );
    }
}
