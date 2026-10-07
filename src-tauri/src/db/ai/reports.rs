use super::context::ContextBuilder;
use super::provider::AiProvider;
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
}

pub async fn generate_database_report(
    backend: &dyn DatabaseBackend,
    database: &str,
    report_type: &str,
    provider: Option<&dyn AiProvider>,
) -> Result<GeneratedReport, PyroError> {
    let _ = provider; // For future AI enriched analysis
    let now = chrono::Utc::now().to_rfc3339();

    match report_type {
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

            let html = format!(
                "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Health Report - {database}</title>\
                 <style>body{{font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:30px;background:#0d0f14;color:#e2e8f0;line-height:1.6}}\
                 h1,h2{{color:#ff5c16}}table{{border-collapse:collapse;width:100%}}th,td{{border:1px solid #262e42;padding:8px 12px}}\
                 .badge{{display:inline-block;padding:3px 8px;border-radius:4px;font-weight:bold;font-size:12px;background:#1e2434}}\
                 </style></head><body><h1>Informe de Salud: {database}</h1><p>Puntuación: <strong>{}/100</strong> ({})</p>\
                 <pre>{}</pre></body></html>",
                health.overall_score, status_str, md
            );

            Ok(GeneratedReport {
                title: format!("Informe de Salud - {database}"),
                database: database.to_string(),
                report_type: "health".to_string(),
                timestamp: now,
                markdown: md,
                html,
                json_data: serde_json::to_value(&health).unwrap_or_default(),
            })
        }

        "schema" | _ => {
            let ctx = ContextBuilder::new(backend, database)
                .with_explain(false)
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
                "- **Tablas Inspeccionadas:** {}\n\n",
                ctx.tables.len()
            ));

            for tbl in &ctx.tables {
                md.push_str(&format!("## Tabla `{}`\n", tbl.name));
                if let Some(ref c) = tbl.comment {
                    md.push_str(&format!("*Comentario:* {}\n\n", c));
                }
                if let Some(ref ddl) = tbl.ddl {
                    md.push_str("```sql\n");
                    md.push_str(ddl);
                    md.push_str("\n```\n\n");
                }
            }

            let html = format!(
                "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Schema Report - {database}</title>\
                 <style>body{{font-family:sans-serif;padding:30px;background:#0d0f14;color:#e2e8f0;line-height:1.6}}h1,h2{{color:#ff5c16}}</style>\
                 </head><body><h1>Diccionario de Datos: {database}</h1><pre>{}</pre></body></html>",
                md
            );

            Ok(GeneratedReport {
                title: format!("Diccionario de Datos - {database}"),
                database: database.to_string(),
                report_type: report_type.to_string(),
                timestamp: now,
                markdown: md,
                html,
                json_data: serde_json::to_value(&ctx).unwrap_or_default(),
            })
        }
    }
}
