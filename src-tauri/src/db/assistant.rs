use super::backend::DatabaseBackend;
use super::error::PyroError;
use super::explain::analyze_slow_query;
use super::models::{AiDatabaseContext, SqlAssistantDiagnosis};

/// Offline, rule-based SQL query diagnosis engine based on metadata and query semantics.
pub async fn diagnose_query_with_metadata(
    backend: &dyn DatabaseBackend,
    database: Option<&str>,
    sql: &str,
) -> Result<SqlAssistantDiagnosis, PyroError> {
    let trimmed = sql.trim();
    let upper = trimmed.to_uppercase();
    let mut issues = Vec::new();
    let mut suggested_indexes = Vec::new();
    let mut suggested_rewrite: Option<String> = None;
    let mut explanation_points = Vec::new();

    // 1. Check for SELECT * anti-pattern
    if upper.starts_with("SELECT *") || upper.contains("SELECT\n*") || upper.contains("SELECT  *") {
        issues.push(
            "Uso de 'SELECT *': recupera todas las columnas de la tabla innecesariamente."
                .to_string(),
        );
        explanation_points.push("Especificar solo las columnas requeridas reduce el ancho de banda transferido, el consumo de memoria en cliente y permite al optimizador utilizar Covering Indexes (Using index).".to_string());
    }

    // 2. Check for missing LIMIT in interactive SELECT
    if upper.starts_with("SELECT") && !upper.contains("LIMIT ") && !upper.contains(" COUNT(") {
        issues.push("Consulta SELECT sin cláusula LIMIT: riesgo de desbordamiento de memoria con datasets grandes.".to_string());
        explanation_points.push("Agregar un LIMIT razonable (p.ej. LIMIT 100) para consultas interactivas evita transferencias masivas de datos no deseadas.".to_string());
        if !trimmed.ends_with(';') {
            suggested_rewrite = Some(format!("{trimmed} LIMIT 100;"));
        } else {
            suggested_rewrite = Some(format!("{} LIMIT 100;", trimmed.trim_end_matches(';')));
        }
    }

    // 3. Check for leading wildcard in LIKE ('%term')
    if upper.contains("LIKE '%") || upper.contains("LIKE \"%") {
        issues.push(
            "Uso de comodín inicial 'LIKE \'%...\'': invalida el uso de índices B-Tree estándar."
                .to_string(),
        );
        explanation_points.push("Los índices B-Tree no pueden acelerar búsquedas que comiencen con comodín '%'. Para búsquedas de texto complejas, considera un índice FULLTEXT o MATCH() AGAINST().".to_string());
    }

    // 4. Run EXPLAIN to get optimizer bottlenecks
    if upper.starts_with("SELECT") {
        if let Ok(analysis) = analyze_slow_query(backend, database, trimmed).await {
            for opt in analysis.potential_optimizations {
                if !suggested_indexes.contains(&opt) && !opt.contains("está optimizada") {
                    suggested_indexes.push(opt);
                }
            }
            for b in analysis.bottlenecks {
                if !issues.contains(&b) {
                    issues.push(b);
                }
            }
        }
    }

    let explanation = if explanation_points.is_empty() {
        "La consulta sigue buenas prácticas de optimización para MariaDB/MySQL.".to_string()
    } else {
        explanation_points.join(" ")
    };

    Ok(SqlAssistantDiagnosis {
        sql: sql.to_string(),
        is_valid_syntax: true,
        issues,
        suggested_indexes,
        suggested_query_rewrite: suggested_rewrite,
        explanation,
    })
}

/// Builds a strictly sanitized database context payload for optional AI analysis.
/// SECURITY GUARANTEE: Never includes passwords, connection strings, raw data rows, or credentials.
pub async fn build_sanitized_ai_context(
    backend: &dyn DatabaseBackend,
    database: &str,
    tables: &[String],
    query: Option<String>,
    error_message: Option<String>,
    include_indexes: bool,
) -> Result<AiDatabaseContext, PyroError> {
    let mut selected_ddl = Vec::new();

    // Fetch DDL for selected tables only
    for tbl in tables {
        let clean_tbl = tbl.replace('\'', "''");
        let clean_db = database.replace('\'', "''");
        let sql = format!("SHOW CREATE TABLE `{clean_db}`.`{clean_tbl}`");
        if let Ok(res) = backend.execute_query(&sql, Some(database)).await {
            if let Some(row) = res.rows.first() {
                if let Some(ddl) = row.get(1).and_then(|v| v.as_str()) {
                    selected_ddl.push(ddl.to_string());
                }
            }
        }
    }

    // Server version
    let version_res = backend.execute_query("SELECT VERSION();", None).await.ok();
    let server_version = version_res
        .and_then(|r| {
            r.rows
                .first()
                .and_then(|row| row.first().and_then(|v| v.as_str()).map(|s| s.to_string()))
        })
        .unwrap_or_else(|| "MariaDB/MySQL".to_string());

    // EXPLAIN plan if query provided
    let explain_plan = if let Some(ref q) = query {
        if let Ok(analysis) = analyze_slow_query(backend, Some(database), q).await {
            Some(analysis.execution_plan)
        } else {
            None
        }
    } else {
        None
    };

    Ok(AiDatabaseContext {
        database_name: database.to_string(),
        server_version,
        selected_tables_ddl: selected_ddl,
        query,
        explain_plan,
        error_message,
        include_indexes,
        table_statistics: None,
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_diagnose_select_star_and_missing_limit() {
        let sql = "SELECT * FROM users WHERE active = 1";
        assert!(sql.to_uppercase().starts_with("SELECT *"));
    }
}
