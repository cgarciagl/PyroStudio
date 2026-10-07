use super::provider::{AiCompletionRequest, AiMessage, AiProvider};
use super::security::{redact_sensitive_text, SYSTEM_SECURITY_INSTRUCTIONS};
use crate::db::backend::DatabaseBackend;
use crate::db::error::PyroError;
use crate::db::health::get_health_report;
use crate::db::models::SchemaDiffResult;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartSearchResultItem {
    pub item_type: String, // "table" | "column" | "index" | "routine" | "trigger"
    pub database: String,
    pub table_name: Option<String>,
    pub name: String,
    pub data_type: Option<String>,
    pub comment: Option<String>,
    pub relevance_score: f32,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartSearchResult {
    pub query: String,
    pub results: Vec<SmartSearchResultItem>,
    pub ai_suggestion: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryHistoryInsightItem {
    pub title: String,
    pub category: String, // "frequency" | "slowness" | "errors" | "anti_pattern"
    pub sql_sample: String,
    pub metric_value: String,
    pub description: String,
    pub recommendation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryHistoryIntelligenceReport {
    pub total_analyzed: usize,
    pub insights: Vec<QueryHistoryInsightItem>,
    pub ai_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseHealthSummaryResult {
    pub database: String,
    pub overall_score: u32,
    pub status: String,
    pub observed_facts: Vec<String>,
    pub ai_interpretation: String,
    pub priority_actions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationReviewResult {
    pub summary: String,
    pub risk_level: String, // "low" | "medium" | "high" | "critical"
    pub potential_impacts: Vec<String>,
    pub suggested_migration_strategy: Vec<String>,
    pub full_markdown: String,
}

/// Smart search over database metadata with natural language & keyword relevance.
pub async fn smart_search(
    backend: &dyn DatabaseBackend,
    database: &str,
    query: &str,
    provider: Option<&dyn AiProvider>,
) -> Result<SmartSearchResult, PyroError> {
    let clean_db = database.replace('\'', "''");
    let clean_kw = query.replace('\'', "''").trim().to_string();

    let mut results = Vec::new();

    // 1. Search columns and tables in information_schema
    let col_sql = format!(
        "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_COMMENT \
         FROM information_schema.COLUMNS \
         WHERE TABLE_SCHEMA = '{clean_db}' \
         AND (TABLE_NAME LIKE '%{clean_kw}%' OR COLUMN_NAME LIKE '%{clean_kw}%' OR COLUMN_COMMENT LIKE '%{clean_kw}%') \
         LIMIT 40;"
    );

    if let Ok(res) = backend.execute_query(&col_sql, Some(database)).await {
        for row in res.rows {
            let tbl = row
                .get(0)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let col = row
                .get(1)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let dtype = row
                .get(2)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let comment = row.get(3).and_then(|v| v.as_str()).map(|s| s.to_string());

            let mut score = 0.5f32;
            let lower_kw = clean_kw.to_lowercase();
            if col.to_lowercase() == lower_kw {
                score = 1.0;
            } else if col.to_lowercase().contains(&lower_kw) {
                score = 0.8;
            } else if tbl.to_lowercase().contains(&lower_kw) {
                score = 0.7;
            }

            results.push(SmartSearchResultItem {
                item_type: "column".to_string(),
                database: database.to_string(),
                table_name: Some(tbl.clone()),
                name: col.clone(),
                data_type: Some(dtype.clone()),
                comment: comment.clone(),
                relevance_score: score,
                snippet: format!(
                    "`{tbl}`.`{col}` ({dtype}){}",
                    comment.map(|c| format!(" - {c}")).unwrap_or_default()
                ),
            });
        }
    }

    // 2. Search tables
    let tbl_sql = format!(
        "SELECT TABLE_NAME, ENGINE, TABLE_COMMENT \
         FROM information_schema.TABLES \
         WHERE TABLE_SCHEMA = '{clean_db}' \
         AND (TABLE_NAME LIKE '%{clean_kw}%' OR TABLE_COMMENT LIKE '%{clean_kw}%') \
         LIMIT 20;"
    );

    if let Ok(res) = backend.execute_query(&tbl_sql, Some(database)).await {
        for row in res.rows {
            let tbl = row
                .get(0)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let engine = row
                .get(1)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let comment = row.get(2).and_then(|v| v.as_str()).map(|s| s.to_string());

            results.push(SmartSearchResultItem {
                item_type: "table".to_string(),
                database: database.to_string(),
                table_name: Some(tbl.clone()),
                name: tbl.clone(),
                data_type: Some(engine.clone()),
                comment: comment.clone(),
                relevance_score: 0.9,
                snippet: format!(
                    "Tabla `{tbl}` [{engine}]{}",
                    comment.map(|c| format!(" - {c}")).unwrap_or_default()
                ),
            });
        }
    }

    // Sort by relevance score descending
    results.sort_by(|a, b| {
        b.relevance_score
            .partial_cmp(&a.relevance_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // Optional AI suggestion if provider is available
    let ai_suggestion = if let Some(p) = provider {
        if !results.is_empty() {
            let summary_list: Vec<String> =
                results.iter().take(5).map(|r| r.snippet.clone()).collect();
            let prompt = format!(
                "The user searched for '{}' in database '{}'. Matching items:\n{}\n\nProvide a 1-sentence tip on which table or relation to query.",
                redact_sensitive_text(query), database, summary_list.join("\n")
            );
            let req = AiCompletionRequest {
                system_prompt: Some(SYSTEM_SECURITY_INSTRUCTIONS.to_string()),
                messages: vec![AiMessage::user(prompt)],
                tools: vec![],
                temperature: Some(0.1),
                max_tokens: Some(150),
            };
            p.complete(&req).await.ok().map(|r| r.content)
        } else {
            None
        }
    } else {
        None
    };

    Ok(SmartSearchResult {
        query: query.to_string(),
        results,
        ai_suggestion,
    })
}

/// Generates a Database Health summary clearly separating observed facts from AI interpretation.
pub async fn summarize_database_health(
    backend: &dyn DatabaseBackend,
    database: &str,
    provider: Option<&dyn AiProvider>,
) -> Result<DatabaseHealthSummaryResult, PyroError> {
    let health = get_health_report(backend, database).await?;

    let status_str = if health.overall_score >= 80 {
        "Saludable"
    } else if health.overall_score >= 50 {
        "Advertencia"
    } else {
        "Crítico"
    };

    let mut observed_facts = Vec::new();
    observed_facts.push(format!(
        "Puntuación general de salud: {}/100 (Estado: {})",
        health.overall_score, status_str
    ));
    observed_facts.push(format!(
        "Versión del servidor: {} (Uptime: {}s)",
        health.server_version, health.uptime_seconds
    ));
    observed_facts.push(format!(
        "Total observaciones: {} (Críticos: {}, Advertencias: {}, Info: {})",
        health.issues.len(),
        health.summary.critical_count,
        health.summary.warning_count,
        health.summary.info_count
    ));

    for issue in &health.issues {
        observed_facts.push(format!(
            "[{:?}] {}: {}",
            issue.severity, issue.title, issue.description
        ));
    }

    let mut priority_actions = Vec::new();
    for issue in &health.issues {
        if let Some(ref sug) = issue.suggestion {
            priority_actions.push(format!("{}: {}", issue.title, sug));
        }
    }

    let ai_interpretation = if let Some(p) = provider {
        let prompt = format!(
            "Analyze these database health facts for `{database}`:\n{}\n\n\
             Provide an executive summary distinguishing observed factual metrics from AI optimization advice.",
            observed_facts.join("\n")
        );
        let req = AiCompletionRequest {
            system_prompt: Some(SYSTEM_SECURITY_INSTRUCTIONS.to_string()),
            messages: vec![AiMessage::user(prompt)],
            tools: vec![],
            temperature: Some(0.2),
            max_tokens: Some(800),
        };
        p.complete(&req)
            .await
            .map(|r| r.content)
            .unwrap_or_else(|_| "Auditoría completada satisfactoriamente.".to_string())
    } else {
        format!("Auditoría basada en reglas: Puntuación de salud {}/100 con {} problema(s) detectado(s).", health.overall_score, health.issues.len())
    };

    Ok(DatabaseHealthSummaryResult {
        database: database.to_string(),
        overall_score: health.overall_score,
        status: status_str.to_string(),
        observed_facts,
        ai_interpretation,
        priority_actions,
    })
}

/// Reviews a Schema Diff or migration plan to evaluate data loss risks and lock impacts.
pub async fn review_schema_migration(
    diff: &SchemaDiffResult,
    provider: &dyn AiProvider,
) -> Result<MigrationReviewResult, PyroError> {
    let diff_json = serde_json::to_string_pretty(diff).unwrap_or_default();
    let prompt = format!(
        "Review the following Schema Diff and migration plan for MariaDB/MySQL:\n\n\
         ```json\n{}\n```\n\n\
         Please evaluate:\n\
         1. **Risk Level:** Low, Medium, High, or Critical\n\
         2. **Potential Impacts:** (e.g. adding NOT NULL column without default, dropping columns with data, table locks on large tables)\n\
         3. **Zero-Downtime Migration Strategy:** Step-by-step phased approach (e.g., 1. Add nullable column, 2. Backfill data, 3. Add constraint/index).\n\
         4. Clearly state that this is an AI recommendation for human review.",
        redact_sensitive_text(&diff_json)
    );

    let req = AiCompletionRequest {
        system_prompt: Some(SYSTEM_SECURITY_INSTRUCTIONS.to_string()),
        messages: vec![AiMessage::user(prompt)],
        tools: vec![],
        temperature: Some(0.1),
        max_tokens: Some(2000),
    };

    let resp = provider.complete(&req).await?;
    let content = resp.content;

    let risk_level = if content.to_uppercase().contains("CRITICAL") {
        "critical"
    } else if content.to_uppercase().contains("HIGH") {
        "high"
    } else if content.to_uppercase().contains("MEDIUM") {
        "medium"
    } else {
        "low"
    };

    Ok(MigrationReviewResult {
        summary: "Revisión de migración de esquema completada.".to_string(),
        risk_level: risk_level.to_string(),
        potential_impacts: Vec::new(),
        suggested_migration_strategy: Vec::new(),
        full_markdown: content,
    })
}
