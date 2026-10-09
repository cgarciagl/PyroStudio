use super::context::ContextBuilder;
use super::provider::{AiCompletionRequest, AiMessage, AiProvider};
use super::security::{
    format_isolated_context, redact_sensitive_text, SYSTEM_SECURITY_INSTRUCTIONS,
};
use crate::db::backend::DatabaseBackend;
use crate::db::error::PyroError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlExplanationResult {
    pub sql: String,
    pub summary: String,
    pub tables_involved: Vec<String>,
    pub joins_explanation: Option<String>,
    pub filters_explanation: Option<String>,
    pub index_usage_explanation: Option<String>,
    pub potential_issues: Vec<String>,
    pub full_markdown: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlGenerationResult {
    pub prompt: String,
    pub generated_sql: String,
    pub explanation: String,
    pub tables_used: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlOptimizationResult {
    pub original_sql: String,
    pub suggested_sql: String,
    pub why: String,
    pub expected_improvement: String,
    pub risks: String,
    pub suggested_indexes: Vec<String>,
    pub full_markdown: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlErrorFixResult {
    pub original_sql: String,
    pub error_message: String,
    pub what_happened: String,
    pub likely_cause: String,
    pub how_to_fix: String,
    pub corrected_sql: Option<String>,
    pub full_markdown: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlTestCasesResult {
    pub sql: String,
    pub test_cases_markdown: String,
    pub test_queries: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlDocumentationResult {
    pub target_name: String,
    pub markdown_doc: String,
    pub html_doc: String,
    pub sql_comments: String,
}

/// Helper to parse SQL code block from LLM response.
fn extract_sql_code_block(text: &str) -> Option<String> {
    if let Some(start) = text.find("```sql") {
        let after_start = &text[start + 6..];
        if let Some(end) = after_start.find("```") {
            return Some(after_start[..end].trim().to_string());
        }
    } else if let Some(start) = text.find("```") {
        let after_start = &text[start + 3..];
        if let Some(end) = after_start.find("```") {
            return Some(after_start[..end].trim().to_string());
        }
    }
    None
}

/// Explains a SQL query by fusing real EXPLAIN plan with AI reasoning.
pub async fn explain_sql(
    backend: &dyn DatabaseBackend,
    database: &str,
    sql: &str,
    provider: &dyn AiProvider,
) -> Result<SqlExplanationResult, PyroError> {
    let context = ContextBuilder::new(backend, database)
        .with_query(Some(sql.to_string()))
        .with_explain(true)
        .build()
        .await?;

    let context_text = context.to_prompt_text();
    let user_prompt = format!(
        "Please provide a comprehensive explanation in Spanish (Español) of the following SQL query executed on MariaDB/MySQL.\n\n\
         {}\n\n\
         Analyze and explain entirely in Spanish:\n\
         1. Qué hace la consulta\n\
         2. Tablas y columnas involucradas\n\
         3. JOINs y criterios de filtrado\n\
         4. Utilización de índices y evaluación del plan EXPLAIN\n\
         5. Posibles cuellos de botella de rendimiento o riesgos\n\
         Respond in clear, structured Markdown in Spanish.",
        format_isolated_context("database_context", &context_text)
    );

    let req = AiCompletionRequest {
        system_prompt: Some(SYSTEM_SECURITY_INSTRUCTIONS.to_string()),
        messages: vec![AiMessage::user(user_prompt)],
        tools: vec![],
        temperature: Some(0.2),
        max_tokens: Some(2048),
    };

    let resp = provider.complete(&req).await?;
    let content = resp.content;

    let tables_involved = context.tables.into_iter().map(|t| t.name).collect();

    Ok(SqlExplanationResult {
        sql: sql.to_string(),
        summary: "Explicación detallada de la consulta y su plan de ejecución.".to_string(),
        tables_involved,
        joins_explanation: None,
        filters_explanation: None,
        index_usage_explanation: None,
        potential_issues: Vec::new(),
        full_markdown: content,
    })
}

/// Generates MariaDB/MySQL SQL from a natural language prompt with schema context.
pub async fn generate_sql(
    backend: &dyn DatabaseBackend,
    database: &str,
    user_prompt: &str,
    provider: &dyn AiProvider,
) -> Result<SqlGenerationResult, PyroError> {
    let context = ContextBuilder::new(backend, database)
        .with_explain(false)
        .build()
        .await?;

    let context_text = context.to_prompt_text();
    let prompt_body = format!(
        "Generate a correct, optimized MariaDB/MySQL query for the following user request:\n\
         User Request: \"{}\"\n\n\
         {}\n\n\
         INSTRUCTIONS:\n\
         1. Return the generated SQL query inside a ```sql ... ``` code block.\n\
         2. Follow with a concise explanation in Spanish (Español) of how the query works.\n\
         3. Ensure appropriate LIMITs, correct JOIN keys, and proper table aliases.\n\
         4. ALL EXPLANATIONS AND COMMENTS MUST BE IN SPANISH.",
        redact_sensitive_text(user_prompt),
        format_isolated_context("database_context", &context_text)
    );

    let req = AiCompletionRequest {
        system_prompt: Some(SYSTEM_SECURITY_INSTRUCTIONS.to_string()),
        messages: vec![AiMessage::user(prompt_body)],
        tools: vec![],
        temperature: Some(0.1),
        max_tokens: Some(2048),
    };

    let resp = provider.complete(&req).await?;
    let content = resp.content;

    let generated_sql =
        extract_sql_code_block(&content).unwrap_or_else(|| content.trim().to_string());

    Ok(SqlGenerationResult {
        prompt: user_prompt.to_string(),
        generated_sql,
        explanation: content,
        tables_used: Vec::new(),
    })
}

/// Optimizes a SQL query using schema and EXPLAIN plan.
pub async fn optimize_sql(
    backend: &dyn DatabaseBackend,
    database: &str,
    sql: &str,
    provider: &dyn AiProvider,
) -> Result<SqlOptimizationResult, PyroError> {
    let context = ContextBuilder::new(backend, database)
        .with_query(Some(sql.to_string()))
        .with_explain(true)
        .build()
        .await?;

    let context_text = context.to_prompt_text();
    let prompt_body = format!(
        "Please analyze and optimize this MariaDB/MySQL SQL query:\n\n\
         {}\n\n\
         INSTRUCTIONS (RESPOND IN SPANISH / EN ESPAÑOL):\n\
         1. Propose an optimized SQL query inside a ```sql ... ``` code block.\n\
         2. Explain WHY the rewrite is better in Spanish (avoiding full table scans, reducing memory/buffers, using covering indexes).\n\
         3. State the expected improvement in Spanish.\n\
         4. Highlight any risks or semantic differences in Spanish.\n\
         5. Suggest CREATE INDEX statements if missing indexes are the bottleneck.",
        format_isolated_context("database_context", &context_text)
    );

    let req = AiCompletionRequest {
        system_prompt: Some(SYSTEM_SECURITY_INSTRUCTIONS.to_string()),
        messages: vec![AiMessage::user(prompt_body)],
        tools: vec![],
        temperature: Some(0.1),
        max_tokens: Some(2048),
    };

    let resp = provider.complete(&req).await?;
    let content = resp.content;

    let suggested_sql = extract_sql_code_block(&content).unwrap_or_else(|| sql.to_string());

    Ok(SqlOptimizationResult {
        original_sql: sql.to_string(),
        suggested_sql,
        why: "Optimización basada en plan de ejecución e índices.".to_string(),
        expected_improvement: "Potencial reducción de tiempo y uso de memoria.".to_string(),
        risks: "Verificar consistencia con la lógica de negocio antes de aplicar en producción."
            .to_string(),
        suggested_indexes: Vec::new(),
        full_markdown: content,
    })
}

/// Diagnoses a query execution error and proposes a fix.
pub async fn fix_sql_error(
    backend: &dyn DatabaseBackend,
    database: &str,
    sql: &str,
    error_message: &str,
    sqlstate: Option<String>,
    error_code: Option<u32>,
    provider: &dyn AiProvider,
) -> Result<SqlErrorFixResult, PyroError> {
    let context = ContextBuilder::new(backend, database)
        .with_query(Some(sql.to_string()))
        .with_error(Some(super::context::ErrorContext {
            sql: sql.to_string(),
            error_message: error_message.to_string(),
            sqlstate: sqlstate.clone(),
            error_code,
        }))
        .with_explain(false)
        .build()
        .await?;

    let context_text = context.to_prompt_text();
    let prompt_body = format!(
        "The following SQL query failed with an error in MariaDB/MySQL:\n\n\
         {}\n\n\
         Please provide ALL EXPLANATIONS IN SPANISH (EN ESPAÑOL):\n\
         1. **Qué ocurrió:** Explicación clara y concisa del error en español.\n\
         2. **Causa probable:** La causa raíz en español (ej. columna desconocida, error de sintaxis, falta de join).\n\
         3. **SQL Corregido:** La consulta corregida dentro de un bloque ```sql ... ```.\n\
         4. **Cómo prevenirlo:** Buenas prácticas para evitarlo en el futuro en español.",
        format_isolated_context("database_context", &context_text)
    );

    let req = AiCompletionRequest {
        system_prompt: Some(SYSTEM_SECURITY_INSTRUCTIONS.to_string()),
        messages: vec![AiMessage::user(prompt_body)],
        tools: vec![],
        temperature: Some(0.1),
        max_tokens: Some(2048),
    };

    let resp = provider.complete(&req).await?;
    let content = resp.content;

    let corrected_sql = extract_sql_code_block(&content);

    Ok(SqlErrorFixResult {
        original_sql: sql.to_string(),
        error_message: error_message.to_string(),
        what_happened: "Error durante la ejecución en el motor MariaDB/MySQL.".to_string(),
        likely_cause: "Inconsistencia de identificadores o sintaxis SQL.".to_string(),
        how_to_fix: "Aplica la consulta corregida sugerida a continuación.".to_string(),
        corrected_sql,
        full_markdown: content,
    })
}

/// Generates comprehensive SQL test cases for a target query.
pub async fn generate_sql_tests(
    backend: &dyn DatabaseBackend,
    database: &str,
    sql: &str,
    provider: &dyn AiProvider,
) -> Result<SqlTestCasesResult, PyroError> {
    let context = ContextBuilder::new(backend, database)
        .with_query(Some(sql.to_string()))
        .with_explain(false)
        .build()
        .await?;

    let context_text = context.to_prompt_text();
    let prompt_body = format!(
        "Generate comprehensive SQL test cases for the following query on MariaDB/MySQL in Spanish (Español):\n\n\
         {}\n\n\
         Provide test cases covering (with explanations in Spanish):\n\
         1. Caso normal (Happy path)\n\
         2. Conjunto de resultados vacío\n\
         3. Valores NULL en columnas de filtro/join\n\
         4. Valores límite y frontera (0, negativos, INT máximo, marcas de tiempo)\n\
         5. Valores duplicados en llaves de unión\n\
         6. Consulta de prueba para volumen alto de datos / rendimiento\n\n\
         Format each test case with SQL queries inside ```sql ... ``` code blocks.",
        format_isolated_context("database_context", &context_text)
    );

    let req = AiCompletionRequest {
        system_prompt: Some(SYSTEM_SECURITY_INSTRUCTIONS.to_string()),
        messages: vec![AiMessage::user(prompt_body)],
        tools: vec![],
        temperature: Some(0.2),
        max_tokens: Some(2500),
    };

    let resp = provider.complete(&req).await?;
    let content = resp.content;

    Ok(SqlTestCasesResult {
        sql: sql.to_string(),
        test_cases_markdown: content,
        test_queries: Vec::new(),
    })
}

/// Generates documentation (Markdown, HTML, SQL comments) for schema objects.
pub async fn generate_documentation(
    backend: &dyn DatabaseBackend,
    database: &str,
    target_type: &str,
    target_name: &str,
    provider: &dyn AiProvider,
) -> Result<SqlDocumentationResult, PyroError> {
    let context = ContextBuilder::new(backend, database)
        .with_tables(vec![target_name.to_string()])
        .with_explain(false)
        .build()
        .await?;

    let context_text = context.to_prompt_text();
    let prompt_body = format!(
        "Generate technical documentation in Spanish (Español) for the {} `{}` in database `{}`:\n\n\
         {}\n\n\
         Please provide entirely in Spanish:\n\
         1. **Resumen en Markdown & Diccionario de Datos:** Tablas, columnas, claves, propósito de negocio.\n\
         2. **Comentarios SQL:** Sentencias ALTER TABLE o COMMENT de columnas.\n\
         3. Nota: Distinguir claramente entre metadatos observados del esquema e interpretaciones de la IA.",
        target_type, target_name, database,
        format_isolated_context("database_context", &context_text)
    );

    let req = AiCompletionRequest {
        system_prompt: Some(SYSTEM_SECURITY_INSTRUCTIONS.to_string()),
        messages: vec![AiMessage::user(prompt_body)],
        tools: vec![],
        temperature: Some(0.2),
        max_tokens: Some(2500),
    };

    let resp = provider.complete(&req).await?;
    let content = resp.content;

    let sql_comments = extract_sql_code_block(&content).unwrap_or_default();

    Ok(SqlDocumentationResult {
        target_name: target_name.to_string(),
        markdown_doc: content.clone(),
        html_doc: format!("<div class=\"db-doc\">{content}</div>"),
        sql_comments,
    })
}
