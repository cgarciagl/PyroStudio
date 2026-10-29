use super::security::redact_sensitive_text;
use crate::db::backend::DatabaseBackend;
use crate::db::error::PyroError;
use crate::db::explain::analyze_slow_query;
use crate::db::models::{ColumnMetadata, ExplainRow, IndexMetadata};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::OnceLock;

/// Structured representation of table metadata within a database context.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableContextInfo {
    pub name: String,
    pub engine: Option<String>,
    pub rows_count: Option<i64>,
    pub comment: Option<String>,
    pub columns: Vec<ColumnMetadata>,
    pub indexes: Vec<IndexMetadata>,
    pub ddl: Option<String>,
}

/// Structured representation of foreign keys / relationships.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelationshipInfo {
    pub table_name: String,
    pub column_name: String,
    pub referenced_table_name: String,
    pub referenced_column_name: String,
    pub constraint_name: String,
}

/// Error context captured from execution failure.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorContext {
    pub sql: String,
    pub error_message: String,
    pub sqlstate: Option<String>,
    pub error_code: Option<u32>,
}

/// Developer notes associated with database objects.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseNote {
    pub target_type: String, // "database" | "table" | "column" | "query"
    pub target_name: String,
    pub note_text: String,
}

/// Complete or reduced database context payload for AI assistance.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseContext {
    pub database_name: String,
    pub server_version: String,
    pub tables: Vec<TableContextInfo>,
    pub relationships: Vec<RelationshipInfo>,
    pub query: Option<String>,
    pub explain_plan: Option<Vec<ExplainRow>>,
    pub error_context: Option<ErrorContext>,
    pub notes: Vec<DatabaseNote>,
    pub is_truncated: bool,
}

impl DatabaseContext {
    /// Formats the context into a clean, markdown-delimited prompt payload.
    pub fn to_prompt_text(&self) -> String {
        let mut out = String::new();
        out.push_str(&format!(
            "### Database Context\n- **Database:** `{}`\n- **Engine/Version:** {}\n\n",
            self.database_name, self.server_version
        ));

        if !self.tables.is_empty() {
            out.push_str("### Relevant Tables & Schema:\n");
            for tbl in &self.tables {
                out.push_str(&format!("#### Table `{}`\n", tbl.name));
                if let Some(ref c) = tbl.comment {
                    if !c.trim().is_empty() {
                        out.push_str(&format!("- Comment: {}\n", redact_sensitive_text(c)));
                    }
                }
                if let Some(rows) = tbl.rows_count {
                    out.push_str(&format!("- Estimated rows: {}\n", rows));
                }
                if let Some(ref ddl) = tbl.ddl {
                    out.push_str("```sql\n");
                    out.push_str(&redact_sensitive_text(ddl));
                    out.push_str("\n```\n");
                } else if !tbl.columns.is_empty() {
                    out.push_str(
                        "| Column | Type | Nullable | Key | Default |\n|---|---|---|---|---|\n",
                    );
                    for col in &tbl.columns {
                        out.push_str(&format!(
                            "| `{}` | `{}` | {} | {} | {} |\n",
                            col.name,
                            col.column_type,
                            if col.is_nullable { "YES" } else { "NO" },
                            col.column_key,
                            col.column_default.as_deref().unwrap_or("NULL")
                        ));
                    }
                }
                out.push('\n');
            }
        }

        if !self.relationships.is_empty() {
            out.push_str("### Foreign Key Relationships:\n");
            for r in &self.relationships {
                out.push_str(&format!(
                    "- `{}`.`{}` -> `{}`.`{}` ({})\n",
                    r.table_name,
                    r.column_name,
                    r.referenced_table_name,
                    r.referenced_column_name,
                    r.constraint_name
                ));
            }
            out.push('\n');
        }

        if !self.notes.is_empty() {
            out.push_str("### Developer Notes:\n");
            for n in &self.notes {
                out.push_str(&format!(
                    "- [{}:{}] {}\n",
                    n.target_type,
                    n.target_name,
                    redact_sensitive_text(&n.note_text)
                ));
            }
            out.push('\n');
        }

        if let Some(ref q) = self.query {
            out.push_str("### Target Query:\n```sql\n");
            out.push_str(&redact_sensitive_text(q));
            out.push_str("\n```\n\n");
        }

        if let Some(ref err) = self.error_context {
            out.push_str("### Error Details:\n```text\n");
            out.push_str(&format!(
                "Error: {}\n",
                redact_sensitive_text(&err.error_message)
            ));
            if let Some(code) = err.error_code {
                out.push_str(&format!("Error Code: {}\n", code));
            }
            if let Some(ref state) = err.sqlstate {
                out.push_str(&format!("SQLSTATE: {}\n", state));
            }
            out.push_str("```\n\n");
        }

        if let Some(ref plan) = self.explain_plan {
            out.push_str("### EXPLAIN Execution Plan:\n");
            out.push_str("| ID | Select Type | Table | Type | Key | Rows | Extra |\n|---|---|---|---|---|---|---|\n");
            for row in plan {
                out.push_str(&format!(
                    "| {} | {} | {} | {} | {} | {} | {} |\n",
                    row.id,
                    row.select_type,
                    row.table,
                    row.r#type,
                    row.key.as_deref().unwrap_or("-"),
                    row.rows,
                    row.extra.as_deref().unwrap_or("-")
                ));
            }
            out.push('\n');
        }

        out
    }
}

/// Helper that parses SQL to find table identifiers referenced in FROM, JOIN, UPDATE, INTO clauses.
pub fn extract_referenced_tables(sql: &str) -> HashSet<String> {
    static TABLE_RE: OnceLock<Regex> = OnceLock::new();
    let re = TABLE_RE.get_or_init(|| {
        Regex::new(r#"(?i)\b(?:FROM|JOIN|UPDATE|INTO|TABLE)\s+[`]?([a-zA-Z0-9_$]+)[`]?\b"#)
            .expect("Valid regex")
    });

    let mut tables = HashSet::new();
    for cap in re.captures_iter(sql) {
        if let Some(m) = cap.get(1) {
            let name = m.as_str().to_lowercase();
            // Exclude common SQL keywords that may follow INTO or TABLE
            if name != "select" && name != "values" && name != "dual" {
                tables.insert(name);
            }
        }
    }
    tables
}

/// Context builder to gather on-demand database context with relevance filtering and redaction.
pub struct ContextBuilder<'a> {
    backend: &'a dyn DatabaseBackend,
    database: String,
    explicit_tables: Vec<String>,
    query: Option<String>,
    error_context: Option<ErrorContext>,
    notes: Vec<DatabaseNote>,
    include_explain: bool,
    max_tables: usize,
}

impl<'a> ContextBuilder<'a> {
    pub fn new(backend: &'a dyn DatabaseBackend, database: impl Into<String>) -> Self {
        Self {
            backend,
            database: database.into(),
            explicit_tables: Vec::new(),
            query: None,
            error_context: None,
            notes: Vec::new(),
            include_explain: true,
            max_tables: 8,
        }
    }

    pub fn with_tables(mut self, tables: Vec<String>) -> Self {
        self.explicit_tables = tables;
        self
    }

    pub fn with_query(mut self, query: Option<String>) -> Self {
        self.query = query;
        self
    }

    pub fn with_error(mut self, error: Option<ErrorContext>) -> Self {
        self.error_context = error;
        self
    }

    pub fn with_notes(mut self, notes: Vec<DatabaseNote>) -> Self {
        self.notes = notes;
        self
    }

    pub fn with_explain(mut self, include: bool) -> Self {
        self.include_explain = include;
        self
    }

    pub async fn build(self) -> Result<DatabaseContext, PyroError> {
        let db_name = self.database.clone();

        // 1. Determine relevant tables
        let mut target_tables = HashSet::new();
        for t in self.explicit_tables {
            target_tables.insert(t.to_lowercase());
        }

        if let Some(ref q) = self.query {
            for t in extract_referenced_tables(q) {
                target_tables.insert(t);
            }
        }

        // 2. Fetch server version and engine
        let engine = self.backend.engine();
        let server_version = match engine {
            crate::db::engine::DbEngine::Sqlite => {
                let res = self
                    .backend
                    .execute_query("SELECT sqlite_version();", None)
                    .await
                    .ok();
                res.and_then(|r| {
                    r.rows.first().and_then(|row| {
                        row.first()
                            .and_then(|v| v.as_str())
                            .map(|s| format!("SQLite {s}"))
                    })
                })
                .unwrap_or_else(|| "SQLite 3".to_string())
            }
            crate::db::engine::DbEngine::MySql => {
                let version_res = self
                    .backend
                    .execute_query("SELECT VERSION();", None)
                    .await
                    .ok();
                version_res
                    .and_then(|r| {
                        r.rows.first().and_then(|row| {
                            row.first().and_then(|v| v.as_str()).map(|s| s.to_string())
                        })
                    })
                    .unwrap_or_else(|| "MariaDB/MySQL".to_string())
            }
        };

        // 3. Fetch schema tables list via introspector
        let mut tables_context = Vec::new();
        let mut is_truncated = false;

        let introspector = crate::db::introspect::introspector(self.backend);
        if let Ok(all_tables) = introspector.list_tables(self.backend, &db_name).await {
            let mut matched_count = 0;
            for tbl in all_tables {
                let tbl_name = tbl.name;
                if tbl_name.is_empty() {
                    continue;
                }

                let is_targeted =
                    target_tables.is_empty() || target_tables.contains(&tbl_name.to_lowercase());
                if !is_targeted {
                    continue;
                }

                if matched_count >= self.max_tables {
                    is_truncated = true;
                    break;
                }
                matched_count += 1;

                let ddl = if let Ok(storage) = introspector
                    .table_storage(self.backend, &db_name, &tbl_name)
                    .await
                {
                    Some(storage.ddl)
                } else {
                    None
                };

                let columns = if ddl.is_none() {
                    introspector
                        .table_columns(self.backend, &db_name, &tbl_name)
                        .await
                        .unwrap_or_default()
                } else {
                    Vec::new()
                };

                tables_context.push(TableContextInfo {
                    name: tbl_name,
                    engine: tbl.engine,
                    rows_count: tbl.rows_count.map(|r| r as i64),
                    comment: tbl.comment,
                    columns,
                    indexes: Vec::new(),
                    ddl,
                });
            }
        }

        // 4. Fetch foreign key relationships for target tables via introspector
        let mut relationships = Vec::new();
        if let Ok(all_fks) = introspector.foreign_keys(self.backend, &db_name).await {
            for (tbl_name, fks) in all_fks {
                if !target_tables.is_empty() && !target_tables.contains(&tbl_name.to_lowercase()) {
                    continue;
                }
                for fk in fks {
                    relationships.push(RelationshipInfo {
                        table_name: tbl_name.clone(),
                        column_name: fk.column_name,
                        referenced_table_name: fk.referenced_table,
                        referenced_column_name: fk.referenced_column,
                        constraint_name: fk.name,
                    });
                    if relationships.len() >= 30 {
                        break;
                    }
                }
                if relationships.len() >= 30 {
                    break;
                }
            }
        }

        // 5. EXPLAIN plan if query provided (MySQL only, as SlowQueryAnalysis is formatted for MySQL)
        let explain_plan = if self.include_explain && engine == crate::db::engine::DbEngine::MySql {
            if let Some(ref q) = self.query {
                if q.trim().to_uppercase().starts_with("SELECT") {
                    analyze_slow_query(self.backend, Some(&db_name), q)
                        .await
                        .ok()
                        .map(|a| a.execution_plan)
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };

        Ok(DatabaseContext {
            database_name: db_name,
            server_version,
            tables: tables_context,
            relationships,
            query: self.query,
            explain_plan,
            error_context: self.error_context,
            notes: self.notes,
            is_truncated,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_referenced_tables() {
        let sql = "SELECT u.id, o.total FROM users u JOIN orders o ON u.id = o.user_id WHERE u.status = 1";
        let tables = extract_referenced_tables(sql);
        assert!(tables.contains("users"));
        assert!(tables.contains("orders"));
    }

    #[test]
    fn test_extract_update_and_into() {
        let sql = "UPDATE products SET price = 100 WHERE category_id = 5";
        let tables = extract_referenced_tables(sql);
        assert!(tables.contains("products"));

        let insert_sql = "INSERT INTO customer_logs (user_id, msg) VALUES (1, 'hello')";
        let insert_tables = extract_referenced_tables(insert_sql);
        assert!(insert_tables.contains("customer_logs"));
    }

    #[test]
    fn test_database_context_formatting() {
        let ctx = DatabaseContext {
            database_name: "ecommerce_db".to_string(),
            server_version: "10.11.4-MariaDB".to_string(),
            tables: vec![TableContextInfo {
                name: "orders".to_string(),
                engine: Some("InnoDB".to_string()),
                rows_count: Some(50000),
                comment: Some("Customer purchase orders".to_string()),
                columns: vec![],
                indexes: vec![],
                ddl: Some("CREATE TABLE `orders` (`id` int(11) PRIMARY KEY);".to_string()),
            }],
            relationships: vec![RelationshipInfo {
                table_name: "orders".to_string(),
                column_name: "customer_id".to_string(),
                referenced_table_name: "customers".to_string(),
                referenced_column_name: "id".to_string(),
                constraint_name: "fk_orders_customer".to_string(),
            }],
            query: Some("SELECT * FROM orders WHERE total > 100".to_string()),
            explain_plan: None,
            error_context: None,
            notes: vec![],
            is_truncated: false,
        };

        let prompt = ctx.to_prompt_text();
        assert!(prompt.contains("### Database Context"));
        assert!(prompt.contains("`ecommerce_db`"));
        assert!(prompt.contains("#### Table `orders`"));
        assert!(prompt.contains("fk_orders_customer"));
        assert!(prompt.contains("SELECT * FROM orders WHERE total > 100"));
    }
}
