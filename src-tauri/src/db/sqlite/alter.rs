//! Column changes that SQLite's `ALTER TABLE` cannot express (type, NULL,
//! DEFAULT), done with the official 12-step table rebuild:
//! <https://www.sqlite.org/lang_altertable.html#otheralter>.
//!
//! The new table reuses the original `CREATE TABLE` text with only the edited
//! column definition rewritten, so CHECK, FOREIGN KEY, COLLATE, `WITHOUT ROWID`
//! and the other constraints survive the rebuild.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::db::backend::DatabaseBackend;
use crate::db::dialect::{Dialect, SQLITE_DIALECT};
use crate::db::error::PyroError;

/// Name given to the rebuilt table until it replaces the original.
const REBUILD_PREFIX: &str = "pyro_rebuild_";

/// Temporary table whose CHECK turns `foreign_key_check` rows into an error,
/// so the script aborts before COMMIT on every transport.
const FK_GUARD_TABLE: &str = "temp.pyro_fk_guard";

/// Words that end a column type and start its constraints.
const CONSTRAINT_KEYWORDS: [&str; 11] = [
    "CONSTRAINT",
    "PRIMARY",
    "NOT",
    "NULL",
    "UNIQUE",
    "CHECK",
    "DEFAULT",
    "COLLATE",
    "REFERENCES",
    "GENERATED",
    "AS",
];

/// Leading words of table-level constraints (not column definitions).
const TABLE_CONSTRAINT_KEYWORDS: [&str; 5] =
    ["CONSTRAINT", "PRIMARY", "UNIQUE", "CHECK", "FOREIGN"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnChangeRequest {
    pub database: String,
    pub table: String,
    pub column: String,
    pub new_name: String,
    pub new_type: String,
    pub nullable: bool,
    /// Default as typed by the user: `NULL`, a number, a `CURRENT_*` keyword,
    /// an expression in parentheses or plain text. Empty means no default.
    #[serde(default)]
    pub default_value: Option<String>,
}

impl ColumnChangeRequest {
    fn schema(&self) -> &str {
        let schema = self.database.trim();
        if schema.is_empty() {
            "main"
        } else {
            schema
        }
    }

    fn renames_column(&self) -> bool {
        self.new_name.trim() != self.column
    }
}

/// Statements that apply the change: nothing when the definition is the
/// same, a plain `RENAME COLUMN` when only the name changes and the 12-step
/// rebuild otherwise.
pub async fn plan_column_change(
    backend: &dyn DatabaseBackend,
    req: &ColumnChangeRequest,
) -> Result<Vec<String>, PyroError> {
    let catalog = TableCatalog::load(backend, req.schema(), &req.table).await?;
    if !catalog.column(&req.column)?.definition_matches(req) {
        return rebuild_script(&catalog, req);
    }
    if !req.renames_column() {
        return Ok(Vec::new());
    }
    Ok(vec![format!(
        "ALTER TABLE {} RENAME COLUMN {} TO {};",
        SQLITE_DIALECT.qualify_table(Some(req.schema()), &req.table)?,
        SQLITE_DIALECT.quote_identifier(&req.column)?,
        SQLITE_DIALECT.quote_identifier(&req.new_name)?
    )])
}

/// Runs a planned script in one session; on failure the transaction is rolled
/// back and the connection settings restored.
pub async fn apply_script(
    backend: &dyn DatabaseBackend,
    statements: &[String],
) -> Result<(), PyroError> {
    let queries: Vec<&str> = statements.iter().map(String::as_str).collect();
    if let Err(error) = backend.execute_batch(&queries, None).await {
        let cleanup = [
            "ROLLBACK",
            "PRAGMA legacy_alter_table = OFF",
            "PRAGMA foreign_keys = ON",
        ];
        for statement in cleanup {
            let _ = backend.execute_query(statement, None).await;
        }
        return Err(error);
    }
    Ok(())
}

/// What the rebuild needs to know about the table.
struct TableCatalog {
    schema: String,
    table: String,
    create_sql: String,
    /// `CREATE INDEX` / `CREATE TRIGGER` statements dropped with the table.
    dependents: Vec<String>,
    columns: Vec<DeclaredColumn>,
    foreign_keys_enabled: bool,
}

/// Row of `pragma_table_info`.
struct DeclaredColumn {
    name: String,
    declared_type: String,
    not_null: bool,
    default: Option<String>,
}

impl DeclaredColumn {
    /// Whether the request keeps the type, NULL-ability and default.
    fn definition_matches(&self, req: &ColumnChangeRequest) -> bool {
        self.declared_type.eq_ignore_ascii_case(req.new_type.trim())
            && self.not_null != req.nullable
            && self.default == default_expression(req.default_value.as_deref())
    }
}

impl TableCatalog {
    async fn load(
        backend: &dyn DatabaseBackend,
        schema: &str,
        table: &str,
    ) -> Result<Self, PyroError> {
        let catalog = SQLITE_DIALECT.qualify_table(Some(schema), "sqlite_master")?;
        let table_literal = SQLITE_DIALECT.string_literal(table);
        let objects = rows(
            backend,
            &format!(
                "SELECT type, sql FROM {catalog} WHERE tbl_name = {table_literal} AND sql IS NOT NULL \
                 ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name"
            ),
        )
        .await?;
        let create_sql = objects
            .iter()
            .find(|row| text(row, 0) == "table")
            .map(|row| text(row, 1))
            .ok_or_else(|| {
                PyroError::InvalidOperation(format!("No se encontró la tabla '{table}'."))
            })?;
        let dependents = objects
            .iter()
            .filter(|row| text(row, 0) != "table")
            .map(|row| text(row, 1))
            .collect();
        let columns = rows(
            backend,
            &format!(
                "SELECT name, type, \"notnull\", dflt_value FROM pragma_table_info({table_literal}, {}) ORDER BY cid",
                SQLITE_DIALECT.string_literal(schema)
            ),
        )
        .await?
        .iter()
        .map(|row| DeclaredColumn {
            name: text(row, 0),
            declared_type: text(row, 1),
            not_null: text(row, 2) == "1",
            default: Some(text(row, 3)).filter(|default| !default.is_empty()),
        })
        .collect();
        let foreign_keys_enabled = rows(backend, "PRAGMA foreign_keys")
            .await?
            .first()
            .is_some_and(|row| text(row, 0) == "1");
        Ok(Self {
            schema: schema.to_string(),
            table: table.to_string(),
            create_sql,
            dependents,
            columns,
            foreign_keys_enabled,
        })
    }

    fn column(&self, name: &str) -> Result<&DeclaredColumn, PyroError> {
        self.columns
            .iter()
            .find(|column| column.name.eq_ignore_ascii_case(name))
            .ok_or_else(|| {
                PyroError::InvalidOperation(format!("No se encontró la columna '{name}'."))
            })
    }
}

fn rebuild_script(
    catalog: &TableCatalog,
    req: &ColumnChangeRequest,
) -> Result<Vec<String>, PyroError> {
    let dialect = &SQLITE_DIALECT;
    let schema = Some(catalog.schema.as_str());
    let table = dialect.qualify_table(schema, &catalog.table)?;
    let rebuilt_name = format!("{REBUILD_PREFIX}{}", catalog.table);
    let rebuilt = dialect.qualify_table(schema, &rebuilt_name)?;
    let create_rebuilt = rewrite_create_table(&catalog.create_sql, &rebuilt, req)?;

    let source_names: Vec<String> = catalog.columns.iter().map(|c| c.name.clone()).collect();
    let target_names: Vec<String> = source_names
        .iter()
        .map(|name| {
            if name.eq_ignore_ascii_case(&req.column) {
                req.new_name.trim().to_string()
            } else {
                name.clone()
            }
        })
        .collect();
    let source_columns = quoted_list(&source_names)?;
    let target_columns = quoted_list(&target_names)?;
    let guard_check = format!(
        "SELECT count(*) FROM pragma_foreign_key_check({}, {})",
        dialect.string_literal(&catalog.table),
        dialect.string_literal(&catalog.schema)
    );
    let restore_foreign_keys = if catalog.foreign_keys_enabled {
        "ON"
    } else {
        "OFF"
    };

    let mut script = vec![
        "PRAGMA foreign_keys = OFF;".to_string(),
        // Rename without rewriting or validating views that reference the table.
        "PRAGMA legacy_alter_table = ON;".to_string(),
        "BEGIN;".to_string(),
        format!("{create_rebuilt};"),
        format!("INSERT INTO {rebuilt} ({target_columns}) SELECT {source_columns} FROM {table};"),
        format!("DROP TABLE {table};"),
        format!(
            "ALTER TABLE {rebuilt} RENAME TO {};",
            dialect.quote_identifier(&catalog.table)?
        ),
    ];
    script.extend(catalog.dependents.iter().map(|sql| format!("{sql};")));
    script.extend([
        format!(
            "CREATE TABLE {FK_GUARD_TABLE} (violations INTEGER CONSTRAINT \"foreign_key_check sin violaciones\" CHECK (violations = 0));"
        ),
        format!("INSERT INTO {FK_GUARD_TABLE} {guard_check};"),
        format!("DROP TABLE {FK_GUARD_TABLE};"),
        "COMMIT;".to_string(),
        "PRAGMA legacy_alter_table = OFF;".to_string(),
        format!("PRAGMA foreign_keys = {restore_foreign_keys};"),
    ]);
    Ok(script)
}

fn quoted_list(columns: &[String]) -> Result<String, PyroError> {
    let quoted = columns
        .iter()
        .map(|column| SQLITE_DIALECT.quote_identifier(column))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(quoted.join(", "))
}

/// `CREATE TABLE` for `new_table_ref` with the changed column rewritten.
fn rewrite_create_table(
    create_sql: &str,
    new_table_ref: &str,
    req: &ColumnChangeRequest,
) -> Result<String, PyroError> {
    let body = TableBody::parse(create_sql)?;
    let mut found = false;
    let items = body
        .items
        .iter()
        .map(|item| {
            if !found && is_column_named(item, &req.column) {
                found = true;
                rewrite_column_item(item, req)
            } else {
                item.trim().to_string()
            }
        })
        .collect::<Vec<_>>();
    if !found {
        return Err(PyroError::InvalidOperation(format!(
            "No se encontró la columna '{}' en la definición de la tabla.",
            req.column
        )));
    }
    Ok(format!(
        "CREATE TABLE {new_table_ref} (\n  {}\n){}",
        items.join(",\n  "),
        body.options
    ))
}

/// Column definitions and table constraints of a `CREATE TABLE`, plus the
/// options after the closing parenthesis (`WITHOUT ROWID`, `STRICT`).
struct TableBody {
    items: Vec<String>,
    options: String,
}

impl TableBody {
    fn parse(create_sql: &str) -> Result<Self, PyroError> {
        let malformed = || {
            PyroError::InvalidOperation("No se pudo interpretar la definición de la tabla.".into())
        };
        let tokens = tokenize(create_sql);
        let open = tokens
            .iter()
            .position(|token| token.text == "(")
            .ok_or_else(malformed)?;
        let mut depth = 0usize;
        let mut items = vec![String::new()];
        let mut close = None;
        for (index, token) in tokens.iter().enumerate().skip(open + 1) {
            match token.text.as_str() {
                "(" => depth += 1,
                ")" if depth == 0 => {
                    close = Some(index);
                    break;
                }
                ")" => depth -= 1,
                "," if depth == 0 => {
                    items.push(String::new());
                    continue;
                }
                _ => {}
            }
            let item = items.last_mut().expect("items never empty");
            item.push_str(&token.leading);
            item.push_str(&token.text);
        }
        let close = close.ok_or_else(malformed)?;
        let options = tokens[close + 1..]
            .iter()
            .map(|token| format!("{}{}", token.leading, token.text))
            .collect::<String>();
        Ok(Self {
            items,
            options: options.trim_end().trim_end_matches(';').to_string(),
        })
    }
}

fn is_column_named(item: &str, column: &str) -> bool {
    let tokens = significant_tokens(item);
    let Some(first) = tokens.first() else {
        return false;
    };
    let is_table_constraint = TABLE_CONSTRAINT_KEYWORDS
        .iter()
        .any(|keyword| first.text.eq_ignore_ascii_case(keyword));
    !is_table_constraint && unquote(&first.text).eq_ignore_ascii_case(column)
}

/// `name type constraints…` with the new name, type, NULL-ability and
/// default; every other constraint of the column is kept.
fn rewrite_column_item(item: &str, req: &ColumnChangeRequest) -> String {
    let tokens = significant_tokens(item);
    let constraints_start = tokens
        .iter()
        .skip(1)
        .position(|token| is_constraint_keyword(&token.text))
        .map_or(tokens.len(), |position| position + 1);
    let kept = without_null_and_default(&tokens[constraints_start..]);

    let mut parts = vec![quote_name(req.new_name.trim())];
    if !req.new_type.trim().is_empty() {
        parts.push(req.new_type.trim().to_string());
    }
    parts.extend(kept);
    if !req.nullable {
        parts.push("NOT NULL".into());
    }
    if let Some(default) = default_expression(req.default_value.as_deref()) {
        parts.push(format!("DEFAULT {default}"));
    }
    parts.join(" ")
}

/// Constraint tokens without `[CONSTRAINT name] NOT NULL [ON CONFLICT x]`,
/// `NULL` and `DEFAULT value`, which the request redefines.
fn without_null_and_default(tokens: &[Token]) -> Vec<String> {
    let mut kept = Vec::new();
    let mut index = 0;
    while index < tokens.len() {
        let word = tokens[index].text.to_ascii_uppercase();
        let next = tokens.get(index + 1).map(|t| t.text.to_ascii_uppercase());
        let skip = match (word.as_str(), next.as_deref()) {
            ("CONSTRAINT", _) if starts_redefined_clause(tokens, index + 2) => 2,
            ("NOT", Some("NULL")) => 2 + conflict_clause_len(tokens, index + 2),
            ("NULL", _) => 1 + conflict_clause_len(tokens, index + 1),
            ("DEFAULT", _) => 1 + default_value_len(tokens, index + 1),
            _ => 0,
        };
        if skip == 0 {
            kept.push(tokens[index].text.clone());
            index += 1;
        } else {
            index += skip;
        }
    }
    kept
}

fn starts_redefined_clause(tokens: &[Token], index: usize) -> bool {
    tokens.get(index).is_some_and(|token| {
        matches!(
            token.text.to_ascii_uppercase().as_str(),
            "NOT" | "NULL" | "DEFAULT"
        )
    })
}

/// Length of an optional `ON CONFLICT <resolution>`.
fn conflict_clause_len(tokens: &[Token], index: usize) -> usize {
    let is_on = tokens
        .get(index)
        .is_some_and(|token| token.text.eq_ignore_ascii_case("ON"));
    if is_on {
        3
    } else {
        0
    }
}

/// A default is one token, or a sign followed by a number.
fn default_value_len(tokens: &[Token], index: usize) -> usize {
    match tokens.get(index).map(|token| token.text.as_str()) {
        Some("+" | "-") => 2,
        Some(_) => 1,
        None => 0,
    }
}

fn is_constraint_keyword(word: &str) -> bool {
    CONSTRAINT_KEYWORDS
        .iter()
        .any(|keyword| word.eq_ignore_ascii_case(keyword))
}

/// SQL for a default typed by the user; `None` when there is no default.
fn default_expression(raw: Option<&str>) -> Option<String> {
    let raw = raw.map(str::trim).filter(|raw| !raw.is_empty())?;
    let upper = raw.to_ascii_uppercase();
    let is_keyword = matches!(
        upper.as_str(),
        "NULL" | "CURRENT_TIMESTAMP" | "CURRENT_DATE" | "CURRENT_TIME" | "TRUE" | "FALSE"
    );
    let is_number = raw.parse::<f64>().is_ok();
    let is_expression = raw.starts_with('(') && raw.ends_with(')');
    let is_literal = raw.len() >= 2 && raw.starts_with('\'') && raw.ends_with('\'');
    Some(if is_keyword {
        upper
    } else if is_number || is_expression || is_literal {
        raw.to_string()
    } else {
        SQLITE_DIALECT.string_literal(raw)
    })
}

fn quote_name(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// Identifier without its quotes (`"a"`, `[a]`, `` `a` ``).
fn unquote(identifier: &str) -> String {
    let inner = |open: char, close: char| {
        identifier
            .strip_prefix(open)
            .and_then(|rest| rest.strip_suffix(close))
    };
    if let Some(name) = inner('"', '"') {
        name.replace("\"\"", "\"")
    } else if let Some(name) = inner('`', '`') {
        name.replace("``", "`")
    } else if let Some(name) = inner('[', ']') {
        name.to_string()
    } else {
        identifier.to_string()
    }
}

/// SQL token with the whitespace and comments that precede it.
#[derive(Debug, Clone)]
struct Token {
    leading: String,
    text: String,
}

/// Tokens of a column definition with each parenthesized group kept whole. A
/// group written right after a word stays glued to it (`VARCHAR(10)`,
/// `stock(id)`); after a space it is its own token (`CHECK (a > 0)`).
fn significant_tokens(item: &str) -> Vec<Token> {
    let mut grouped: Vec<Token> = Vec::new();
    let mut depth = 0usize;
    for token in tokenize(item) {
        let inside_group = depth > 0;
        let glued_group = token.text == "(" && token.leading.is_empty() && !grouped.is_empty();
        match token.text.as_str() {
            "(" => depth += 1,
            ")" => depth = depth.saturating_sub(1),
            _ => {}
        }
        match grouped.last_mut() {
            Some(last) if inside_group => {
                last.text.push_str(&token.leading);
                last.text.push_str(&token.text);
            }
            Some(last) if glued_group => last.text.push_str(&token.text),
            _ => grouped.push(Token {
                leading: String::new(),
                text: token.text,
            }),
        }
    }
    grouped
}

/// Splits SQL into words, quoted names, literals and single-character
/// symbols, never breaking inside quotes or comments.
fn tokenize(sql: &str) -> Vec<Token> {
    let chars: Vec<char> = sql.chars().collect();
    let mut tokens = Vec::new();
    let mut leading = String::new();
    let mut index = 0;
    while index < chars.len() {
        let current = chars[index];
        let next = chars.get(index + 1).copied();
        if current.is_whitespace() {
            leading.push(current);
            index += 1;
            continue;
        }
        let end = match (current, next) {
            ('-', Some('-')) => line_comment_end(&chars, index),
            ('/', Some('*')) => block_comment_end(&chars, index),
            ('\'' | '"' | '`', _) => quoted_end(&chars, index, current),
            ('[', _) => quoted_end(&chars, index, ']'),
            _ if is_word_char(current) => {
                let mut end = index;
                while end < chars.len() && is_word_char(chars[end]) {
                    end += 1;
                }
                end
            }
            _ => index + 1,
        };
        let text: String = chars[index..end].iter().collect();
        if text.starts_with("--") || text.starts_with("/*") {
            leading.push_str(&text);
        } else {
            tokens.push(Token {
                leading: std::mem::take(&mut leading),
                text,
            });
        }
        index = end;
    }
    tokens
}

fn is_word_char(character: char) -> bool {
    character.is_alphanumeric() || matches!(character, '_' | '.' | '$')
}

fn line_comment_end(chars: &[char], start: usize) -> usize {
    chars[start..]
        .iter()
        .position(|&c| c == '\n')
        .map_or(chars.len(), |offset| start + offset)
}

fn block_comment_end(chars: &[char], start: usize) -> usize {
    (start + 2..chars.len().saturating_sub(1))
        .find(|&i| chars[i] == '*' && chars[i + 1] == '/')
        .map_or(chars.len(), |i| i + 2)
}

/// End of a quoted run; a doubled closing quote is an escaped quote.
fn quoted_end(chars: &[char], start: usize, close: char) -> usize {
    let mut index = start + 1;
    while index < chars.len() {
        if chars[index] == close {
            if close != ']' && chars.get(index + 1) == Some(&close) {
                index += 2;
                continue;
            }
            return index + 1;
        }
        index += 1;
    }
    chars.len()
}

async fn rows(backend: &dyn DatabaseBackend, sql: &str) -> Result<Vec<Vec<Value>>, PyroError> {
    Ok(backend.execute_query(sql, None).await?.rows)
}

fn text(row: &[Value], index: usize) -> String {
    match row.get(index) {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Null) | None => String::new(),
        Some(other) => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn change(
        column: &str,
        new_type: &str,
        nullable: bool,
        default: Option<&str>,
    ) -> ColumnChangeRequest {
        ColumnChangeRequest {
            database: "main".into(),
            table: "t".into(),
            column: column.into(),
            new_name: column.into(),
            new_type: new_type.into(),
            nullable,
            default_value: default.map(str::to_string),
        }
    }

    #[test]
    fn splits_items_respecting_nested_parentheses_and_quotes() {
        let body = TableBody::parse(
            "CREATE TABLE t (a DECIMAL(10, 2) CHECK (a > 0), \"b,c\" TEXT DEFAULT 'x,y', PRIMARY KEY (a)) WITHOUT ROWID",
        )
        .unwrap();
        assert_eq!(body.items.len(), 3);
        assert_eq!(body.items[1].trim(), "\"b,c\" TEXT DEFAULT 'x,y'");
        assert_eq!(body.options.trim(), "WITHOUT ROWID");
    }

    #[test]
    fn rewrites_type_null_and_default_keeping_other_constraints() {
        let item =
            "qty integer CONSTRAINT nn NOT NULL DEFAULT -1 CHECK (qty >= -1) REFERENCES stock(id)";
        assert_eq!(
            rewrite_column_item(item, &change("qty", "REAL", true, Some("0.5"))),
            "\"qty\" REAL CHECK (qty >= -1) REFERENCES stock(id) DEFAULT 0.5"
        );
        assert_eq!(
            rewrite_column_item(
                "name TEXT",
                &change("name", "VARCHAR(80)", false, Some("sin nombre"))
            ),
            "\"name\" VARCHAR(80) NOT NULL DEFAULT 'sin nombre'"
        );
    }

    #[test]
    fn finds_quoted_column_names_but_not_table_constraints() {
        assert!(is_column_named("\"Order Id\" INTEGER", "order id"));
        assert!(is_column_named("[qty] INT", "qty"));
        assert!(!is_column_named("PRIMARY KEY (qty)", "primary"));
    }

    #[test]
    fn defaults_are_quoted_only_when_they_are_plain_text() {
        assert_eq!(
            default_expression(Some("current_timestamp")).unwrap(),
            "CURRENT_TIMESTAMP"
        );
        assert_eq!(default_expression(Some("42")).unwrap(), "42");
        assert_eq!(default_expression(Some("(1 + 1)")).unwrap(), "(1 + 1)");
        assert_eq!(default_expression(Some("O'Reilly")).unwrap(), "'O''Reilly'");
        assert_eq!(default_expression(Some("  ")), None);
    }
}
