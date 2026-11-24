use super::context::ContextBuilder;
use super::provider::{AiCompletionRequest, AiMessage, AiProvider};
use super::security::{
    format_isolated_context, is_english_lang, redact_sensitive_text, system_instructions_for,
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
    language: &str,
) -> Result<SqlExplanationResult, PyroError> {
    let en = is_english_lang(Some(language));
    let context = ContextBuilder::new(backend, database)
        .with_query(Some(sql.to_string()))
        .with_explain(true)
        .build()
        .await?;

    let context_text = context.to_prompt_text();
    let engine_name = backend.engine().display_name();
    let user_prompt = if en {
        format!(
            "Please provide a comprehensive explanation in English of the following SQL query executed on {engine_name}.\n\n\
             {}\n\n\
             Analyze and explain entirely in English:\n\
             1. What the query does\n\
             2. Tables and columns involved\n\
             3. JOINs and filtering criteria\n\
             4. Index usage and EXPLAIN plan evaluation\n\
             5. Potential performance bottlenecks or risks\n\
             Respond in clear, structured Markdown in English.",
            format_isolated_context("database_context", &context_text)
        )
    } else {
        format!(
            "Please provide a comprehensive explanation in Spanish (Español) of the following SQL query executed on {engine_name}.\n\n\
             {}\n\n\
             Analyze and explain entirely in Spanish:\n\
             1. Qué hace la consulta\n\
             2. Tablas y columnas involucradas\n\
             3. JOINs y criterios de filtrado\n\
             4. Utilización de índices y evaluación del plan EXPLAIN\n\
             5. Posibles cuellos de botella de rendimiento o riesgos\n\
             Respond in clear, structured Markdown in Spanish.",
            format_isolated_context("database_context", &context_text)
        )
    };

    let req = AiCompletionRequest {
        system_prompt: Some(system_instructions_for(backend.engine(), Some(language))),
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
        summary: if en {
            "Detailed explanation of the query and its execution plan.".to_string()
        } else {
            "Explicación detallada de la consulta y su plan de ejecución.".to_string()
        },
        tables_involved,
        joins_explanation: None,
        filters_explanation: None,
        index_usage_explanation: None,
        potential_issues: Vec::new(),
        full_markdown: content,
    })
}

/// Generates engine-specific SQL from a natural language prompt with schema context.
pub async fn generate_sql(
    backend: &dyn DatabaseBackend,
    database: &str,
    user_prompt: &str,
    provider: &dyn AiProvider,
    language: &str,
) -> Result<SqlGenerationResult, PyroError> {
    let en = is_english_lang(Some(language));
    // The request (and any SQL embedded in it, e.g. the editor query sent as
    // context) decides which tables get full schema; the rest are listed by name.
    let context = ContextBuilder::new(backend, database)
        .with_tables(
            super::context::extract_referenced_tables(user_prompt)
                .into_iter()
                .collect(),
        )
        .with_hint(Some(user_prompt.to_string()))
        .with_explain(false)
        .build()
        .await?;

    let context_text = context.to_prompt_text();
    let engine_name = backend.engine().display_name();
    let prompt_body = if en {
        format!(
            "Generate a correct, optimized {engine_name} query for the following user request:\n\
             User Request: \"{}\"\n\n\
             {}\n\n\
             INSTRUCTIONS:\n\
             1. Return the generated SQL query inside a ```sql ... ``` code block.\n\
             2. Follow with a concise explanation in English of how the query works.\n\
             3. Ensure appropriate LIMITs, correct JOIN keys, and proper table aliases.\n\
             4. ALL EXPLANATIONS AND COMMENTS MUST BE IN ENGLISH.",
            redact_sensitive_text(user_prompt),
            format_isolated_context("database_context", &context_text)
        )
    } else {
        format!(
            "Generate a correct, optimized {engine_name} query for the following user request:\n\
             User Request: \"{}\"\n\n\
             {}\n\n\
             INSTRUCTIONS:\n\
             1. Return the generated SQL query inside a ```sql ... ``` code block.\n\
             2. Follow with a concise explanation in Spanish (Español) of how the query works.\n\
             3. Ensure appropriate LIMITs, correct JOIN keys, and proper table aliases.\n\
             4. ALL EXPLANATIONS AND COMMENTS MUST BE IN SPANISH.",
            redact_sensitive_text(user_prompt),
            format_isolated_context("database_context", &context_text)
        )
    };

    let req = AiCompletionRequest {
        system_prompt: Some(system_instructions_for(backend.engine(), Some(language))),
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
    language: &str,
) -> Result<SqlOptimizationResult, PyroError> {
    let en = is_english_lang(Some(language));
    let context = ContextBuilder::new(backend, database)
        .with_query(Some(sql.to_string()))
        .with_explain(true)
        .build()
        .await?;

    let context_text = context.to_prompt_text();
    let engine_name = backend.engine().display_name();
    let prompt_body = if en {
        format!(
            "Please analyze and optimize this {engine_name} SQL query:\n\n\
             {}\n\n\
             INSTRUCTIONS (RESPOND IN ENGLISH):\n\
             1. Propose an optimized SQL query inside a ```sql ... ``` code block.\n\
             2. Explain WHY the rewrite is better in English (avoiding full table scans, reducing memory/buffers, using covering indexes).\n\
             3. State the expected improvement in English.\n\
             4. Highlight any risks or semantic differences in English.\n\
             5. Suggest CREATE INDEX statements if missing indexes are the bottleneck.",
            format_isolated_context("database_context", &context_text)
        )
    } else {
        format!(
            "Please analyze and optimize this {engine_name} SQL query:\n\n\
             {}\n\n\
             INSTRUCTIONS (RESPOND IN SPANISH / EN ESPAÑOL):\n\
             1. Propose an optimized SQL query inside a ```sql ... ``` code block.\n\
             2. Explain WHY the rewrite is better in Spanish (avoiding full table scans, reducing memory/buffers, using covering indexes).\n\
             3. State the expected improvement in Spanish.\n\
             4. Highlight any risks or semantic differences in Spanish.\n\
             5. Suggest CREATE INDEX statements if missing indexes are the bottleneck.",
            format_isolated_context("database_context", &context_text)
        )
    };

    let req = AiCompletionRequest {
        system_prompt: Some(system_instructions_for(backend.engine(), Some(language))),
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
        why: if en {
            "Optimization based on execution plan and indexes.".to_string()
        } else {
            "Optimización basada en plan de ejecución e índices.".to_string()
        },
        expected_improvement: if en {
            "Potential reduction in execution time and memory usage.".to_string()
        } else {
            "Potencial reducción de tiempo y uso de memoria.".to_string()
        },
        risks: if en {
            "Verify consistency with business logic before applying to production.".to_string()
        } else {
            "Verificar consistencia con la lógica de negocio antes de aplicar en producción."
                .to_string()
        },
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
    language: &str,
) -> Result<SqlErrorFixResult, PyroError> {
    let en = is_english_lang(Some(language));
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
    let engine_name = backend.engine().display_name();
    let prompt_body = if en {
        format!(
            "The following SQL query failed with an error in {engine_name}:\n\n\
             {}\n\n\
             Please provide ALL EXPLANATIONS IN ENGLISH:\n\
             1. **What happened:** Clear and concise explanation of the error in English.\n\
             2. **Likely cause:** Root cause in English (e.g. unknown column, syntax error, missing join).\n\
             3. **Corrected SQL:** The fixed query inside a ```sql ... ``` code block.\n\
             4. **How to prevent it:** Best practices to avoid this in the future in English.",
            format_isolated_context("database_context", &context_text)
        )
    } else {
        format!(
            "The following SQL query failed with an error in {engine_name}:\n\n\
             {}\n\n\
             Please provide ALL EXPLANATIONS IN SPANISH (EN ESPAÑOL):\n\
             1. **Qué ocurrió:** Explicación clara y concisa del error en español.\n\
             2. **Causa probable:** La causa raíz en español (ej. columna desconocida, error de sintaxis, falta de join).\n\
             3. **SQL Corregido:** La consulta corregida dentro de un bloque ```sql ... ```.\n\
             4. **Cómo prevenirlo:** Buenas prácticas para evitarlo en el futuro en español.",
            format_isolated_context("database_context", &context_text)
        )
    };

    let req = AiCompletionRequest {
        system_prompt: Some(system_instructions_for(backend.engine(), Some(language))),
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
        what_happened: if en {
            format!("Execution error in the {engine_name} engine.")
        } else {
            format!("Error durante la ejecución en el motor {engine_name}.")
        },
        likely_cause: if en {
            "Identifier mismatch or SQL syntax issue.".to_string()
        } else {
            "Inconsistencia de identificadores o sintaxis SQL.".to_string()
        },
        how_to_fix: if en {
            "Apply the corrected query suggested below.".to_string()
        } else {
            "Aplica la consulta corregida sugerida a continuación.".to_string()
        },
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
    language: &str,
) -> Result<SqlTestCasesResult, PyroError> {
    let en = is_english_lang(Some(language));
    let context = ContextBuilder::new(backend, database)
        .with_query(Some(sql.to_string()))
        .with_explain(false)
        .build()
        .await?;

    let context_text = context.to_prompt_text();
    let engine_name = backend.engine().display_name();
    let prompt_body = if en {
        format!(
            "Generate comprehensive SQL test cases for the following query on {engine_name} in English:\n\n\
             {}\n\n\
             Provide test cases covering (with explanations in English):\n\
             1. Normal case (Happy path)\n\
             2. Empty result set\n\
             3. NULL values in filter/join columns\n\
             4. Boundary and edge values (0, negatives, max INT, timestamps)\n\
             5. Duplicate values in join keys\n\
             6. High-volume / performance test query\n\n\
             Format each test case with SQL queries inside ```sql ... ``` code blocks.",
            format_isolated_context("database_context", &context_text)
        )
    } else {
        format!(
            "Generate comprehensive SQL test cases for the following query on {engine_name} in Spanish (Español):\n\n\
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
        )
    };

    let req = AiCompletionRequest {
        system_prompt: Some(system_instructions_for(backend.engine(), Some(language))),
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
    language: &str,
) -> Result<SqlDocumentationResult, PyroError> {
    let en = is_english_lang(Some(language));
    // A "query" target carries the SQL text itself: document the query and the
    // tables it references. Any other target type names a single object.
    let is_query = target_type.eq_ignore_ascii_case("query");
    let builder = ContextBuilder::new(backend, database).with_explain(false);
    let builder = if is_query {
        builder.with_query(Some(target_name.to_string()))
    } else {
        builder.with_tables(vec![target_name.to_string()])
    };
    let context = builder.build().await?;

    let context_text = context.to_prompt_text();
    let subject = if is_query {
        format!("the SQL query included in the context below, executed in database `{database}`")
    } else {
        format!("the {target_type} `{target_name}` in database `{database}`")
    };
    let prompt_body = if en {
        format!(
            "Generate technical documentation in English for {subject}:\n\n\
             {}\n\n\
             Please provide entirely in English:\n\
             1. **Markdown Summary & Data Dictionary:** Tables, columns, keys, business purpose.\n\
             2. **SQL Comments:** ALTER TABLE or column COMMENT statements.\n\
             3. Note: Clearly distinguish observed schema metadata from AI interpretations.",
            format_isolated_context("database_context", &context_text)
        )
    } else {
        format!(
            "Generate technical documentation in Spanish (Español) for {subject}:\n\n\
             {}\n\n\
             Please provide entirely in Spanish:\n\
             1. **Resumen en Markdown & Diccionario de Datos:** Tablas, columnas, claves, propósito de negocio.\n\
             2. **Comentarios SQL:** Sentencias ALTER TABLE o COMMENT de columnas.\n\
             3. Nota: Distinguir claramente entre metadatos observados del esquema e interpretaciones de la IA.",
            format_isolated_context("database_context", &context_text)
        )
    };

    let req = AiCompletionRequest {
        system_prompt: Some(system_instructions_for(backend.engine(), Some(language))),
        messages: vec![AiMessage::user(prompt_body)],
        tools: vec![],
        temperature: Some(0.2),
        max_tokens: Some(2500),
    };

    let resp = provider.complete(&req).await?;
    let content = resp.content;

    let sql_comments = extract_sql_code_block(&content).unwrap_or_default();

    Ok(SqlDocumentationResult {
        target_name: if is_query {
            "Consulta SQL".to_string()
        } else {
            target_name.to_string()
        },
        markdown_doc: content.clone(),
        html_doc: format!("<div class=\"db-doc\">{content}</div>"),
        sql_comments,
    })
}
