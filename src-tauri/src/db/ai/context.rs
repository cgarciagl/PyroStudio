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

        // 2. Fetch server version
        let version_res = self
            .backend
            .execute_query("SELECT VERSION();", None)
            .await
            .ok();
        let server_version = version_res
            .and_then(|r| {
                r.rows
                    .first()
                    .and_then(|row| row.first().and_then(|v| v.as_str()).map(|s| s.to_string()))
            })
            .unwrap_or_else(|| "MariaDB/MySQL".to_string());

        // 3. Fetch schema tables list
        let mut tables_context = Vec::new();
        let mut is_truncated = false;

        // If specific tables were targeted, fetch them first; otherwise fetch top tables
        let clean_db = db_name.replace('\'', "''");
        let tables_sql = format!(
            "SELECT TABLE_NAME, ENGINE, TABLE_ROWS, TABLE_COMMENT \
             FROM information_schema.TABLES \
             WHERE TABLE_SCHEMA = '{clean_db}' \
             ORDER BY TABLE_NAME LIMIT 50;"
        );

        if let Ok(res) = self
            .backend
            .execute_query(&tables_sql, Some(&db_name))
            .await
        {
            let mut matched_count = 0;
            for row in res.rows {
                let tbl_name = row
                    .get(0)
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
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

                let engine = row.get(1).and_then(|v| v.as_str()).map(|s| s.to_string());
                let rows_count = row.get(2).and_then(|v| v.as_i64());
                let comment = row.get(3).and_then(|v| v.as_str()).map(|s| s.to_string());

                // Fetch DDL for table
                let clean_tbl = tbl_name.replace('\'', "''");
                let show_sql = format!("SHOW CREATE TABLE `{clean_db}`.`{clean_tbl}`");
                let ddl = if let Ok(ddl_res) =
                    self.backend.execute_query(&show_sql, Some(&db_name)).await
                {
                    ddl_res
                        .rows
                        .first()
                        .and_then(|r| r.get(1).and_then(|v| v.as_str()).map(|s| s.to_string()))
                } else {
                    None
                };

                tables_context.push(TableContextInfo {
                    name: tbl_name,
                    engine,
                    rows_count,
                    comment,
                    columns: Vec::new(),
                    indexes: Vec::new(),
                    ddl,
                });
            }
        }

        // 4. Fetch foreign key relationships for target tables
        let mut relationships = Vec::new();
        let fk_sql = format!(
            "SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, CONSTRAINT_NAME \
             FROM information_schema.KEY_COLUMN_USAGE \
             WHERE TABLE_SCHEMA = '{clean_db}' AND REFERENCED_TABLE_NAME IS NOT NULL \
             LIMIT 30;"
        );
        if let Ok(res) = self.backend.execute_query(&fk_sql, Some(&db_name)).await {
            for row in res.rows {
                let t_name = row
                    .get(0)
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let c_name = row
                    .get(1)
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let ref_t = row
                    .get(2)
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let ref_c = row
                    .get(3)
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let c_const = row
                    .get(4)
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                // Only include relationship if related to any target table
                if target_tables.is_empty()
                    || target_tables.contains(&t_name.to_lowercase())
                    || target_tables.contains(&ref_t.to_lowercase())
                {
                    relationships.push(RelationshipInfo {
                        table_name: t_name,
                        column_name: c_name,
                        referenced_table_name: ref_t,
                        referenced_column_name: ref_c,
                        constraint_name: c_const,
                    });
                }
            }
        }

        // 5. EXPLAIN plan if query provided
        let explain_plan = if self.include_explain {
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
