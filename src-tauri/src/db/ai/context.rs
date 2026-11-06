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
    /// Names of the database tables whose schema was not included, so the
    /// model knows they exist without paying for their full DDL.
    #[serde(default)]
    pub other_tables: Vec<String>,
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

        if !self.other_tables.is_empty() {
            out.push_str("### Other Tables In Database (names only, schema not included):\n");
            out.push_str(
                &self
                    .other_tables
                    .iter()
                    .map(|t| format!("`{t}`"))
                    .collect::<Vec<_>>()
                    .join(", "),
            );
            out.push_str("\n\n");
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
///
/// Handles schema-qualified names (`db.table`, `` `db`.`table` ``), quoted
/// identifiers and comma-separated lists (`FROM a x, b y`); the table name is
/// always the last part of a qualified reference.
pub fn extract_referenced_tables(sql: &str) -> HashSet<String> {
    // One table reference: optional `schema.` prefix, then the table name.
    const IDENT: &str = r#"(?:`[^`]+`|"[^"]+"|[A-Za-z0-9_$]+)"#;
    static LIST_RE: OnceLock<Regex> = OnceLock::new();
    static REF_RE: OnceLock<Regex> = OnceLock::new();
    let list_re = LIST_RE.get_or_init(|| {
        let reference = format!(r"{IDENT}(?:\s*\.\s*{IDENT})?");
        let item = format!(r"{reference}(?:\s+(?:AS\s+)?[A-Za-z0-9_$]+)?");
        Regex::new(&format!(
            r"(?i)\b(?:FROM|JOIN|UPDATE|INTO|TABLE)\s+({item}(?:\s*,\s*{item})*)"
        ))
        .expect("Valid regex")
    });
    let ref_re = REF_RE.get_or_init(|| {
        Regex::new(&format!(r"^\s*({IDENT})(?:\s*\.\s*({IDENT}))?")).expect("Valid regex")
    });

    let mut tables = HashSet::new();
    for cap in list_re.captures_iter(sql) {
        let Some(list) = cap.get(1) else { continue };
        for item in list.as_str().split(',') {
            let Some(r) = ref_re.captures(item) else {
                continue;
            };
            let Some(m) = r.get(2).or_else(|| r.get(1)) else {
                continue;
            };
            let name = m
                .as_str()
                .trim_matches(|c| c == '`' || c == '"')
                .to_lowercase();
            // Exclude common SQL keywords that may follow INTO or TABLE
            if !name.is_empty() && name != "select" && name != "values" && name != "dual" {
                tables.insert(name);
            }
        }
    }
    tables
}

/// Upper bound of table names listed without schema in a context.
const MAX_OTHER_TABLES: usize = 300;

/// Tables whose name appears as a word in `text`, tolerating singular/plural
/// (`pedido` ↔ `pedidos`, `cliente` ↔ `clientes`, `user` ↔ `users`).
fn tables_mentioned_in<'a>(text: &str, tables: impl Iterator<Item = &'a str>) -> HashSet<String> {
    let forms = |w: &str| -> Vec<String> {
        let mut out = vec![w.to_string()];
        for suffix in ["s", "es"] {
            if let Some(stem) = w.strip_suffix(suffix).filter(|s| s.len() >= 3) {
                out.push(stem.to_string());
            }
        }
        out
    };
    let word_forms: HashSet<String> = text
        .to_lowercase()
        .split(|c: char| !(c.is_alphanumeric() || c == '_' || c == '$'))
        .filter(|w| w.len() >= 3)
        .flat_map(forms)
        .collect();
    tables
        .filter(|t| {
            forms(&t.to_lowercase())
                .iter()
                .any(|f| word_forms.contains(f))
        })
        .map(str::to_lowercase)
        .collect()
}

/// Context builder to gather on-demand database context with relevance filtering and redaction.
pub struct ContextBuilder<'a> {
    backend: &'a dyn DatabaseBackend,
    database: String,
    explicit_tables: Vec<String>,
    query: Option<String>,
    hint: Option<String>,
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
            hint: None,
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

    /// Free text (e.g. a natural-language request) used to pick relevant
    /// tables when no query names them; also lists every other table by name.
    pub fn with_hint(mut self, hint: Option<String>) -> Self {
        self.hint = hint;
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

    /// Maximum tables whose full schema is included (default 8).
    pub fn with_max_tables(mut self, max: usize) -> Self {
        self.max_tables = max.max(1);
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

        let mut other_tables = Vec::new();
        let introspector = crate::db::introspect::introspector(self.backend);
        if let Ok(all_tables) = introspector.list_tables(self.backend, &db_name).await {
            if let Some(ref hint) = self.hint {
                target_tables.extend(tables_mentioned_in(
                    hint,
                    all_tables.iter().map(|t| t.name.as_str()),
                ));
            }
            let list_others = self.hint.is_some() || target_tables.is_empty();
            let mut matched_count = 0;
            for tbl in all_tables {
                let tbl_name = tbl.name;
                if tbl_name.is_empty() {
                    continue;
                }

                let is_targeted =
                    target_tables.is_empty() || target_tables.contains(&tbl_name.to_lowercase());
                if !is_targeted || matched_count >= self.max_tables {
                    if is_targeted {
                        is_truncated = true;
                    }
                    if list_others && other_tables.len() < MAX_OTHER_TABLES {
                        other_tables.push(tbl_name);
                    }
                    continue;
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
                    rows_count: tbl.rows_count,
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
                let head = crate::db::safe_mode::clean_sql_statement(q)
                    .trim_start()
                    .trim_start_matches('(')
                    .to_uppercase();
                if head.starts_with("SELECT") || head.starts_with("WITH") {
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
            other_tables,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_qualified_quoted_and_comma_separated_tables() {
        let sql =
            "SELECT * FROM `shop`.`orders` o, `items` i JOIN shop.customers c ON c.id = o.cid";
        let tables = extract_referenced_tables(sql);
        assert!(tables.contains("orders"), "{tables:?}");
        assert!(tables.contains("customers"), "{tables:?}");
        assert!(tables.contains("items"), "{tables:?}");
        assert!(!tables.contains("shop"), "{tables:?}");

        let tables = extract_referenced_tables("SELECT * FROM a x, b AS y, c WHERE x.id = y.id");
        for t in ["a", "b", "c"] {
            assert!(tables.contains(t), "{t} missing in {tables:?}");
        }
    }

    #[test]
    fn picks_tables_mentioned_in_a_request() {
        let names = ["clientes", "pedido", "productos", "log"];
        let found = tables_mentioned_in(
            "Total de pedidos por cliente en 2024",
            names.iter().copied(),
        );
        assert!(found.contains("clientes"), "{found:?}");
        assert!(found.contains("pedido"), "{found:?}");
        assert!(!found.contains("productos"), "{found:?}");
        assert!(!found.contains("log"), "{found:?}");
    }

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
            other_tables: vec![],
        };

        let prompt = ctx.to_prompt_text();
        assert!(prompt.contains("### Database Context"));
        assert!(prompt.contains("`ecommerce_db`"));
        assert!(prompt.contains("#### Table `orders`"));
        assert!(prompt.contains("fk_orders_customer"));
        assert!(prompt.contains("SELECT * FROM orders WHERE total > 100"));
    }
}
