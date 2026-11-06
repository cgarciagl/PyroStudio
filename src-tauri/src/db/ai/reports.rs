use super::context::ContextBuilder;
use super::provider::{AiCompletionRequest, AiMessage, AiProvider};
use super::security::{format_isolated_context, system_instructions};
use crate::db::backend::DatabaseBackend;
use crate::db::error::PyroError;
use crate::db::health::get_health_report;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedReport {
    pub title: String,
    pub database: String,
    pub report_type: String, // "health" | "performance" | "schema" | "security" | "optimization"
    pub timestamp: String,
    pub markdown: String,
    pub html: String,
    pub json_data: serde_json::Value,
    /// Why the AI section is missing or failed. `None` when AI was not
    /// requested or worked.
    #[serde(default)]
    pub ai_notice: Option<String>,
}

/// Tables documented in a schema report (each costs one DDL lookup).
const SCHEMA_REPORT_MAX_TABLES: usize = 200;
/// Characters of report facts sent to the model.
const AI_INPUT_MAX_CHARS: usize = 30_000;

pub async fn generate_database_report(
    backend: &dyn DatabaseBackend,
    database: &str,
    report_type: &str,
    provider: Option<&dyn AiProvider>,
) -> Result<GeneratedReport, PyroError> {
    let now = chrono::Utc::now().to_rfc3339();

    let (title, report_type, mut md, json_data, ai_task) = match report_type {
        "health" => {
            let health = get_health_report(backend, database).await?;
            let status_str = if health.overall_score >= 80 {
                "Saludable"
            } else if health.overall_score >= 50 {
                "Advertencia"
            } else {
                "Crítico"
            };

            let mut md = String::new();
            md.push_str(&format!(
                "# Informe de Salud de Base de Datos: `{database}`\n\n"
            ));
            md.push_str(&format!("- **Fecha:** {now}\n"));
            md.push_str(&format!(
                "- **Versión del Motor:** {}\n",
                health.server_version
            ));
            md.push_str(&format!(
                "- **Puntuación Global:** {} / 100\n",
                health.overall_score
            ));
            md.push_str(&format!("- **Estado:** {}\n\n", status_str));

            md.push_str("## Resumen General de Métricas\n");
            md.push_str(&format!(
                "- **Observaciones Críticas:** {}\n",
                health.summary.critical_count
            ));
            md.push_str(&format!(
                "- **Advertencias:** {}\n",
                health.summary.warning_count
            ));
            md.push_str(&format!(
                "- **Informativas:** {}\n\n",
                health.summary.info_count
            ));

            if !health.issues.is_empty() {
                md.push_str("## Hallazgos y Observaciones\n");
                for issue in &health.issues {
                    md.push_str(&format!(
                        "- **[{:?}]** `{}`: {}\n",
                        issue.severity, issue.title, issue.description
                    ));
                }
                md.push('\n');
            }

            let suggestions: Vec<_> = health
                .issues
                .iter()
                .filter_map(|i| i.suggestion.as_ref().map(|s| (&i.title, s)))
                .collect();
            if !suggestions.is_empty() {
                md.push_str("## Recomendaciones Prioritarias\n");
                for (i, (title, sug)) in suggestions.iter().enumerate() {
                    md.push_str(&format!("{}. **{}**: {}\n", i + 1, title, sug));
                }
                md.push('\n');
            }

            (
                format!("Informe de Salud - {database}"),
                "health".to_string(),
                md,
                serde_json::to_value(&health).unwrap_or_default(),
                "Based ONLY on the health report facts above, write an executive analysis: \
                 overall risk, the 3-5 most important problems ordered by impact, and concrete \
                 next steps (with SQL or configuration changes when applicable).",
            )
        }

        // "schema" and any unknown report type.
        _ => {
            let ctx = ContextBuilder::new(backend, database)
                .with_explain(false)
                .with_max_tables(SCHEMA_REPORT_MAX_TABLES)
                .build()
                .await?;
            let mut md = String::new();
            md.push_str(&format!(
                "# Diccionario de Datos y Esquema: `{database}`\n\n"
            ));
            md.push_str(&format!("- **Fecha:** {now}\n"));
            md.push_str(&format!(
                "- **Versión del Motor:** {}\n",
                ctx.server_version
            ));
            md.push_str(&format!(
                "- **Tablas Inspeccionadas:** {}\n",
                ctx.tables.len()
            ));
            if ctx.is_truncated {
                md.push_str(&format!(
                    "- **Nota:** se documentan las primeras {SCHEMA_REPORT_MAX_TABLES} tablas; \
                     {} tabla(s) adicional(es) solo se listan por nombre.\n",
                    ctx.other_tables.len()
                ));
            }
            md.push('\n');

            for tbl in &ctx.tables {
                md.push_str(&format!("## Tabla `{}`\n", tbl.name));
                if let Some(ref c) = tbl.comment {
                    if !c.trim().is_empty() {
                        md.push_str(&format!("*Comentario:* {}\n\n", c));
                    }
                }
                if let Some(ref ddl) = tbl.ddl {
                    md.push_str("```sql\n");
                    md.push_str(ddl);
                    md.push_str("\n```\n\n");
                }
            }

            if !ctx.relationships.is_empty() {
                md.push_str("## Relaciones (claves foráneas)\n");
                for r in &ctx.relationships {
                    md.push_str(&format!(
                        "- `{}`.`{}` → `{}`.`{}` ({})\n",
                        r.table_name,
                        r.column_name,
                        r.referenced_table_name,
                        r.referenced_column_name,
                        r.constraint_name
                    ));
                }
                md.push('\n');
            }

            if !ctx.other_tables.is_empty() {
                md.push_str("## Otras tablas (sin detalle)\n");
                md.push_str(
                    &ctx.other_tables
                        .iter()
                        .map(|t| format!("`{t}`"))
                        .collect::<Vec<_>>()
                        .join(", "),
                );
                md.push_str("\n\n");
            }

            (
                format!("Diccionario de Datos - {database}"),
                report_type.to_string(),
                md,
                serde_json::to_value(&ctx).unwrap_or_default(),
                "Based ONLY on the schema above, write: the likely business purpose of the \
                 database and of each main table group, a data dictionary of the key \
                 entities, relationships between them, and design issues worth reviewing \
                 (missing keys or indexes, naming inconsistencies, nullable foreign keys…).",
            )
        }
    };

    let mut ai_notice = None;
    if let Some(p) = provider {
        match ai_analysis(backend, p, &md, ai_task).await {
            Ok(analysis) => {
                md.push_str("## Análisis de IA\n\n");
                md.push_str(
                    "> Interpretación generada por IA a partir de los datos anteriores. \
                     Verifíquela antes de aplicar cambios.\n\n",
                );
                md.push_str(analysis.trim());
                md.push_str("\n");
            }
            Err(e) => ai_notice = Some(format!("El análisis de IA falló: {e}")),
        }
    }

    let html = format!(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>{}</title>\
         <style>body{{font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:30px;background:#0d0f14;color:#e2e8f0;line-height:1.6}}\
         h1{{color:#ff5c16}}pre{{white-space:pre-wrap;word-break:break-word}}</style>\
         </head><body><h1>{}</h1><pre>{}</pre></body></html>",
        escape_html(&title),
        escape_html(&title),
        escape_html(&md)
    );

    Ok(GeneratedReport {
        title,
        database: database.to_string(),
        report_type,
        timestamp: now,
        markdown: md,
        html,
        json_data,
        ai_notice,
    })
}

async fn ai_analysis(
    backend: &dyn DatabaseBackend,
    provider: &dyn AiProvider,
    facts_md: &str,
    task: &str,
) -> Result<String, PyroError> {
    let facts: String = facts_md.chars().take(AI_INPUT_MAX_CHARS).collect();
    let prompt = format!(
        "{}\n\n{task}\n\nRespond entirely in Spanish (Español), in Markdown, using `###` \
         headings. Distinguish observed facts from your interpretation and never invent \
         metrics, tables or columns that are not in the report.",
        format_isolated_context("database_report", &facts)
    );
    let req = AiCompletionRequest {
        system_prompt: Some(system_instructions(backend.engine())),
        messages: vec![AiMessage::user(prompt)],
        tools: vec![],
        temperature: Some(0.2),
        max_tokens: Some(2000),
    };
    Ok(provider.complete(&req).await?.content)
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::escape_html;

    #[test]
    fn report_html_is_escaped() {
        assert_eq!(
            escape_html("<script>a && \"b\"</script>"),
            "&lt;script&gt;a &amp;&amp; &quot;b&quot;&lt;/script&gt;"
        );
    }
}
