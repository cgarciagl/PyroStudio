use super::provider::{
    AiCompletionRequest, AiMessage, AiMessageRole, AiProvider, ToolCall, ToolDefinition,
};
use super::security::{redact_sensitive_text, SYSTEM_SECURITY_INSTRUCTIONS};
use crate::db::backend::DatabaseBackend;
use crate::db::error::PyroError;
use crate::db::explain::analyze_slow_query;
use crate::db::health::get_health_report;
use crate::db::index::list_indexes;
use crate::db::safe_mode::{analyze_sql_safety, DangerLevel};
use crate::db::table::list_tables;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentActivityStep {
    pub step_number: usize,
    pub title: String,
    pub tool_name: Option<String>,
    pub status: String, // "running" | "completed" | "error"
    pub details: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProposedAction {
    pub title: String,
    pub sql: String,
    pub description: String,
    pub risk_level: String, // "low" | "medium" | "high" | "critical"
    pub requires_confirmation: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentAuditEntry {
    pub id: String,
    pub timestamp: String,
    pub question: String,
    pub tools_invoked: Vec<String>,
    pub total_steps: usize,
    pub duration_ms: u64,
    pub total_tokens: Option<u32>,
    pub proposed_actions: Vec<ProposedAction>,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRunResult {
    pub question: String,
    pub final_answer: String,
    pub activity_steps: Vec<AgentActivityStep>,
    pub proposed_actions: Vec<ProposedAction>,
    pub audit_entry: AgentAuditEntry,
    pub duration_ms: u64,
}

/// Returns the standard tool definitions available to the Database Agent.
pub fn get_agent_tools() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "list_tables".to_string(),
            description: "Lists all tables, views, and engines in the current database.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {},
                "required": []
            }),
        },
        ToolDefinition {
            name: "get_table_schema".to_string(),
            description: "Gets the full DDL and column metadata for a specified table.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "table_name": { "type": "string", "description": "The table name to inspect" }
                },
                "required": ["table_name"]
            }),
        },
        ToolDefinition {
            name: "get_table_indexes".to_string(),
            description: "Lists all indexes (PRIMARY, UNIQUE, INDEX, FULLTEXT) for a given table.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "table_name": { "type": "string", "description": "The table name" }
                },
                "required": ["table_name"]
            }),
        },
        ToolDefinition {
            name: "explain_query".to_string(),
            description: "Runs EXPLAIN on a SELECT query to inspect index usage and bottlenecks.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "sql": { "type": "string", "description": "The SELECT query to explain" }
                },
                "required": ["sql"]
            }),
        },
        ToolDefinition {
            name: "get_database_health".to_string(),
            description: "Fetches overall database health metrics, missing primary keys, and potential performance warnings.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {},
                "required": []
            }),
        },
        ToolDefinition {
            name: "search_schema".to_string(),
            description: "Searches for columns, tables, or comments matching a keyword in the database.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "keyword": { "type": "string", "description": "Keyword to search for in schema" }
                },
                "required": ["keyword"]
            }),
        },
        ToolDefinition {
            name: "run_safe_select".to_string(),
            description: "Executes a strictly READ-ONLY SELECT query with automatic LIMIT to inspect sample data (max 20 rows).".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "sql": { "type": "string", "description": "The SELECT query to execute" }
                },
                "required": ["sql"]
            }),
        },
    ]
}

/// Executes a tool call safely in Read-Only mode against the database backend.
pub async fn execute_agent_tool(
    backend: &dyn DatabaseBackend,
    database: &str,
    tool_call: &ToolCall,
) -> Result<String, PyroError> {
    let clean_db = database.replace('\'', "''");

    match tool_call.name.as_str() {
        "list_tables" => {
            let tables = list_tables(backend, database).await?;
            let summary: Vec<serde_json::Value> = tables
                .into_iter()
                .map(|t| {
                    json!({
                        "name": t.name,
                        "type": t.table_type,
                        "engine": t.engine,
                        "rows": t.rows_count,
                        "comment": t.comment,
                    })
                })
                .collect();
            Ok(json!({ "tables": summary }).to_string())
        }

        "get_table_schema" => {
            let tbl = tool_call
                .arguments
                .get("table_name")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if tbl.is_empty() {
                return Err(PyroError::InvalidOperation("table_name is required".into()));
            }
            let clean_tbl = tbl.replace('\'', "''");
            let show_sql = format!("SHOW CREATE TABLE `{clean_db}`.`{clean_tbl}`");
            let res = backend.execute_query(&show_sql, Some(database)).await?;
            let ddl = res
                .rows
                .first()
                .and_then(|r| r.get(1).and_then(|v| v.as_str()))
                .unwrap_or("");
            Ok(json!({ "table": tbl, "ddl": ddl }).to_string())
        }

        "get_table_indexes" => {
            let tbl = tool_call
                .arguments
                .get("table_name")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if tbl.is_empty() {
                return Err(PyroError::InvalidOperation("table_name is required".into()));
            }
            let indexes = list_indexes(backend, database, tbl).await?;
            Ok(json!({ "table": tbl, "indexes": indexes }).to_string())
        }

        "explain_query" => {
            let sql = tool_call
                .arguments
                .get("sql")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if sql.is_empty() {
                return Err(PyroError::InvalidOperation("sql is required".into()));
            }
            let analysis = analyze_slow_query(backend, Some(database), sql).await?;
            Ok(json!({
                "sql": sql,
                "execution_plan": analysis.execution_plan,
                "bottlenecks": analysis.bottlenecks,
                "potential_optimizations": analysis.potential_optimizations,
            })
            .to_string())
        }

        "get_database_health" => {
            let health = get_health_report(backend, database).await?;
            Ok(json!({
                "overall_score": health.overall_score,
                "issues_count": health.issues.len(),
                "critical_count": health.summary.critical_count,
                "warning_count": health.summary.warning_count,
                "info_count": health.summary.info_count,
                "top_issues": health.issues.iter().take(5).collect::<Vec<_>>(),
            })
            .to_string())
        }

        "search_schema" => {
            let keyword = tool_call
                .arguments
                .get("keyword")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let clean_kw = keyword.replace('\'', "''");
            let sql = format!(
                "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_COMMENT \
                 FROM information_schema.COLUMNS \
                 WHERE TABLE_SCHEMA = '{clean_db}' \
                 AND (TABLE_NAME LIKE '%{clean_kw}%' OR COLUMN_NAME LIKE '%{clean_kw}%' OR COLUMN_COMMENT LIKE '%{clean_kw}%') \
                 LIMIT 25;"
            );
            let res = backend.execute_query(&sql, Some(database)).await?;
            let matches: Vec<serde_json::Value> = res
                .rows
                .into_iter()
                .map(|r| {
                    json!({
                        "table": r.get(0).and_then(|v| v.as_str()),
                        "column": r.get(1).and_then(|v| v.as_str()),
                        "type": r.get(2).and_then(|v| v.as_str()),
                        "comment": r.get(3).and_then(|v| v.as_str()),
                    })
                })
                .collect();
            Ok(json!({ "keyword": keyword, "matches": matches }).to_string())
        }

        "run_safe_select" => {
            let raw_sql = tool_call
                .arguments
                .get("sql")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let safety = analyze_sql_safety(raw_sql);
            if safety.is_destructive || !matches!(safety.danger_level, DangerLevel::Safe) {
                return Err(PyroError::InvalidOperation(
                    "Operación bloqueada: El Agente solo puede ejecutar consultas SELECT de lectura segura."
                        .into(),
                ));
            }

            let trimmed = raw_sql.trim().trim_end_matches(';');
            let limited_sql = if !trimmed.to_uppercase().contains("LIMIT ") {
                format!("{trimmed} LIMIT 20;")
            } else {
                format!("{trimmed};")
            };

            let res = backend.execute_query(&limited_sql, Some(database)).await?;
            Ok(json!({
                "columns": res.columns,
                "rows_count": res.rows.len(),
                "sample_rows": res.rows.iter().take(5).collect::<Vec<_>>(),
            })
            .to_string())
        }

        _ => Err(PyroError::InvalidOperation(format!(
            "Herramienta desconocida solicitada por el agente: {}",
            tool_call.name
        ))),
    }
}

/// Runs the multi-step Database Agent reasoning loop.
pub async fn run_database_agent(
    backend: &dyn DatabaseBackend,
    database: &str,
    question: &str,
    provider: &dyn AiProvider,
    max_steps: Option<usize>,
) -> Result<AgentRunResult, PyroError> {
    let start_time = Instant::now();
    let max_iterations = max_steps.unwrap_or(8).min(12);

    let tools = get_agent_tools();
    let mut activity_steps = Vec::new();
    let mut tools_invoked = Vec::new();
    let mut total_tokens = 0u32;

    let mut messages = vec![AiMessage::user(format!(
        "User question about database `{database}`:\n\"{}\"\n\n\
         Use your available database tools to inspect schema, explain plans, or search metadata before providing a final diagnostic.",
        redact_sensitive_text(question)
    ))];

    let mut step = 0;
    let mut final_answer = String::new();

    while step < max_iterations {
        step += 1;

        let req = AiCompletionRequest {
            system_prompt: Some(SYSTEM_SECURITY_INSTRUCTIONS.to_string()),
            messages: messages.clone(),
            tools: tools.clone(),
            temperature: Some(0.1),
            max_tokens: Some(2048),
        };

        let resp = provider.complete(&req).await?;
        if let Some(toks) = resp.total_tokens {
            total_tokens += toks;
        }

        if resp.tool_calls.is_empty() {
            // Agent reached final conclusion
            final_answer = resp.content.clone();
            activity_steps.push(AgentActivityStep {
                step_number: step,
                title: "Generando diagnóstico y recomendaciones finales".to_string(),
                tool_name: None,
                status: "completed".to_string(),
                details: Some("Conclusión del agente completada.".to_string()),
            });
            break;
        }

        // 1. Record the assistant's turn with ALL invoked tool_calls and extra_content (e.g. thought_signature)
        messages.push(AiMessage {
            role: AiMessageRole::Assistant,
            content: resp.content.clone(),
            tool_call_id: None,
            tool_calls: resp.tool_calls.clone(),
            extra_content: resp.extra_content.clone(),
        });

        // 2. Execute each tool call and append individual Tool role responses
        for tc in &resp.tool_calls {
            tools_invoked.push(tc.name.clone());

            let step_title = format!("Ejecutando herramienta `{}`", tc.name);
            activity_steps.push(AgentActivityStep {
                step_number: step,
                title: step_title,
                tool_name: Some(tc.name.clone()),
                status: "running".to_string(),
                details: Some(tc.arguments.to_string()),
            });

            let tool_res = match execute_agent_tool(backend, database, tc).await {
                Ok(out) => out,
                Err(err) => json!({ "error": err.to_string() }).to_string(),
            };

            // Record completed step
            if let Some(last) = activity_steps.last_mut() {
                last.status = "completed".to_string();
            }

            // Append tool response message
            messages.push(AiMessage {
                role: AiMessageRole::Tool,
                content: tool_res,
                tool_call_id: Some(tc.id.clone()),
                tool_calls: vec![],
                extra_content: None,
            });
        }
    }

    if final_answer.is_empty() {
        final_answer = "El agente ha completado la investigación máxima permitida. Revisa el registro de actividades y las acciones propuestas.".to_string();
    }

    // Extract proposed actions from final text
    let mut proposed_actions = Vec::new();
    if final_answer.contains("CREATE INDEX") || final_answer.contains("ALTER TABLE") {
        if let Some(start) = final_answer.find("```sql") {
            let after = &final_answer[start + 6..];
            if let Some(end) = after.find("```") {
                let sql_action = after[..end].trim().to_string();
                let safety = analyze_sql_safety(&sql_action);
                let risk_level = match safety.danger_level {
                    DangerLevel::Safe => "low",
                    DangerLevel::Medium => "medium",
                    DangerLevel::Critical => "critical",
                };
                proposed_actions.push(ProposedAction {
                    title: "Acción SQL recomendada por el agente".to_string(),
                    sql: sql_action,
                    description: "Recomendación para mejorar el rendimiento o corregir estructura."
                        .to_string(),
                    risk_level: risk_level.to_string(),
                    requires_confirmation: true,
                });
            }
        }
    }

    let duration_ms = start_time.elapsed().as_millis() as u64;

    let audit_entry = AgentAuditEntry {
        id: format!("audit_{}", start_time.elapsed().as_micros()),
        timestamp: chrono::Utc::now().to_rfc3339(),
        question: question.to_string(),
        tools_invoked,
        total_steps: step,
        duration_ms,
        total_tokens: Some(total_tokens),
        proposed_actions: proposed_actions.clone(),
        summary: final_answer.clone(),
    };

    Ok(AgentRunResult {
        question: question.to_string(),
        final_answer,
        activity_steps,
        proposed_actions,
        audit_entry,
        duration_ms,
    })
}
