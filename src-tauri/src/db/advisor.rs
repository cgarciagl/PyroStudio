use super::backend::DatabaseBackend;
use super::error::PyroError;
use super::index::list_indexes;
use super::models::{IndexAdvisorReport, IndexMetadata, IndexRecommendation};
use super::table::list_tables;

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

/// Analyzes an entire database schema to identify redundant indexes and unindexed foreign keys.
pub async fn analyze_database_indexes(
    backend: &dyn DatabaseBackend,
    database: &str,
) -> Result<IndexAdvisorReport, PyroError> {
    let clean_db = database.replace('\'', "''");
    let tables = list_tables(backend, database).await?;
    let mut recommendations = Vec::new();
    let mut redundant_count = 0;
    let mut missing_count = 0;

    for table in &tables {
        if table.table_type != "BASE TABLE" {
            continue;
        }

        // 1. Fetch indexes for this table
        if let Ok(indexes) = list_indexes(backend, database, &table.name).await {
            let redundant = find_redundant_indexes(&table.name, &indexes);
            redundant_count += redundant.len();
            recommendations.extend(redundant);

            // 2. Check unindexed foreign keys
            let fk_sql = format!(
                r#"
                SELECT 
                    CONSTRAINT_NAME,
                    COLUMN_NAME,
                    REFERENCED_TABLE_NAME,
                    REFERENCED_COLUMN_NAME
                FROM information_schema.KEY_COLUMN_USAGE
                WHERE TABLE_SCHEMA = '{clean_db}' 
                  AND TABLE_NAME = '{}' 
                  AND REFERENCED_TABLE_NAME IS NOT NULL
                "#,
                table.name.replace('\'', "''")
            );

            if let Ok(fk_res) = backend.execute_query(&fk_sql, Some(database)).await {
                for row in fk_res.rows {
                    let col_name = row.get(1).and_then(|v| v.as_str()).unwrap_or_default();
                    let ref_tbl = row.get(2).and_then(|v| v.as_str()).unwrap_or_default();

                    // Check if this column is the first column in any existing index
                    let is_indexed = indexes.iter().any(|idx| {
                        idx.columns
                            .first()
                            .map(|c| c.column_name.as_str() == col_name)
                            .unwrap_or(false)
                    });

                    if !is_indexed && !col_name.is_empty() {
                        let new_idx_name = format!("idx_{}_{}", table.name, col_name);
                        missing_count += 1;
                        recommendations.push(IndexRecommendation {
                            table_name: table.name.clone(),
                            recommendation: format!("Crear índice sobre Foreign Key '{col_name}'"),
                            reason: format!(
                                "La columna '{col_name}' referencia a '{ref_tbl}' pero no tiene un índice como columna líder. Esto puede causar bloqueos de tabla completa y JOINs lentos.",
                            ),
                            estimated_benefit: "Alta aceleración en JOINs, eliminaciones y comprobaciones de integridad referencial.".to_string(),
                            potential_cost: "Leve incremento en almacenamiento y costo de escritura.".to_string(),
                            sql_proposal: format!(
                                "ALTER TABLE `{}` ADD INDEX `{}` (`{}`);",
                                table.name, new_idx_name, col_name
                            ),
                            index_name: new_idx_name,
                            columns: vec![col_name.to_string()],
                            is_redundant: false,
                            redundant_with: None,
                        });
                    }
                }
            }
        }
    }

    Ok(IndexAdvisorReport {
        database_name: database.to_string(),
        recommendations,
        redundant_indexes_count: redundant_count,
        missing_indexes_count: missing_count,
        analyzed_tables_count: tables.len(),
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

        let prefix_only = IndexMetadata {
            key_name: "idx_user_status".to_string(),
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

        let indexes = vec![composite, prefix_only];
        let redundant = find_redundant_indexes("users", &indexes);

        assert_eq!(redundant.len(), 1);
        assert_eq!(redundant[0].index_name, "idx_user_status");
        assert!(redundant[0].is_redundant);
        assert_eq!(
            redundant[0].redundant_with.as_deref(),
            Some("idx_user_status_created")
        );
    }
}
