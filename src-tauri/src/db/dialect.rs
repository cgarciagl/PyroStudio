use serde_json::Value;

use super::error::PyroError;
use super::models::CreateIndexRequest;
use super::sql_utils::{self, validate_identifier};

/// SQL syntax that differs between engines. Services build statements through
/// the session's dialect instead of branching on the engine.
pub trait Dialect: Send + Sync {
    fn quote_identifier(&self, name: &str) -> Result<String, PyroError>;

    fn string_literal(&self, text: &str) -> String;

    /// Statement that opens an explicit transaction.
    fn begin_transaction(&self) -> &'static str;

    /// Clause appended to single-row `UPDATE`/`DELETE` statements.
    fn single_row_limit(&self) -> &'static str;

    fn truncate_table(&self, table_ref: &str) -> String;

    fn insert_ignore(&self) -> &'static str;

    /// Upsert suffix that overwrites `columns` with the incoming row.
    fn upsert_suffix(&self, quoted_columns: &[String]) -> String;

    fn create_index(&self, req: &CreateIndexRequest) -> Result<String, PyroError>;

    fn drop_index(
        &self,
        schema: Option<&str>,
        table: &str,
        index: &str,
    ) -> Result<String, PyroError>;

    /// `schema.table`, or just `table` when no schema is given.
    fn qualify_table(&self, schema: Option<&str>, table: &str) -> Result<String, PyroError> {
        let table = self.quote_identifier(table)?;
        match non_blank(schema) {
            Some(schema) => Ok(format!("{}.{table}", self.quote_identifier(schema)?)),
            None => Ok(table),
        }
    }

    /// Escaped literal for transports without bound parameters.
    fn value_literal(&self, value: &Value) -> String {
        match value {
            Value::Null => "NULL".into(),
            Value::Bool(flag) => if *flag { "1" } else { "0" }.into(),
            Value::Number(number) => number.to_string(),
            Value::String(text) if text.eq_ignore_ascii_case("NULL") => "NULL".into(),
            Value::String(text) => self.string_literal(text),
            other => self.string_literal(&other.to_string()),
        }
    }
}

pub fn non_blank(name: Option<&str>) -> Option<&str> {
    name.map(str::trim).filter(|name| !name.is_empty())
}

pub struct MySqlDialect;
pub struct SqliteDialect;

pub static MYSQL_DIALECT: MySqlDialect = MySqlDialect;
pub static SQLITE_DIALECT: SqliteDialect = SqliteDialect;

impl Dialect for MySqlDialect {
    fn quote_identifier(&self, name: &str) -> Result<String, PyroError> {
        sql_utils::quote_identifier(name)
    }

    fn string_literal(&self, text: &str) -> String {
        format!("'{}'", text.replace('\'', "''").replace('\\', "\\\\"))
    }

    fn begin_transaction(&self) -> &'static str {
        "START TRANSACTION"
    }

    fn single_row_limit(&self) -> &'static str {
        " LIMIT 1"
    }

    fn truncate_table(&self, table_ref: &str) -> String {
        format!("TRUNCATE TABLE {table_ref};")
    }

    fn insert_ignore(&self) -> &'static str {
        "INSERT IGNORE INTO"
    }

    fn upsert_suffix(&self, quoted_columns: &[String]) -> String {
        let updates = quoted_columns
            .iter()
            .map(|column| format!("{column} = VALUES({column})"))
            .collect::<Vec<_>>()
            .join(", ");
        format!(" ON DUPLICATE KEY UPDATE {updates}")
    }

    fn create_index(&self, req: &CreateIndexRequest) -> Result<String, PyroError> {
        let table_ref = self.qualify_table(Some(&req.database), &req.table)?;
        let name = self.quote_identifier(&req.index_name)?;
        let columns = quoted_index_columns(self, &req.columns)?;
        let keyword = match req.index_type.to_uppercase().as_str() {
            "UNIQUE" => "UNIQUE INDEX",
            "FULLTEXT" => "FULLTEXT INDEX",
            "SPATIAL" => "SPATIAL INDEX",
            _ => "INDEX",
        };
        let comment = req
            .comment
            .as_deref()
            .filter(|comment| !comment.is_empty())
            .map(|comment| format!(" COMMENT '{}'", comment.replace('\'', "''")))
            .unwrap_or_default();
        Ok(format!(
            "ALTER TABLE {table_ref} ADD {keyword} {name} ({columns}){comment};"
        ))
    }

    fn drop_index(
        &self,
        schema: Option<&str>,
        table: &str,
        index: &str,
    ) -> Result<String, PyroError> {
        let table_ref = self.qualify_table(schema, table)?;
        if index == "PRIMARY" {
            return Ok(format!("ALTER TABLE {table_ref} DROP PRIMARY KEY;"));
        }
        let index = self.quote_identifier(index)?;
        Ok(format!("ALTER TABLE {table_ref} DROP INDEX {index};"))
    }
}

impl Dialect for SqliteDialect {
    fn quote_identifier(&self, name: &str) -> Result<String, PyroError> {
        validate_identifier(name)?;
        Ok(format!("\"{}\"", name.trim().replace('"', "\"\"")))
    }

    /// SQLite has no backslash escapes: only quotes are doubled.
    fn string_literal(&self, text: &str) -> String {
        format!("'{}'", text.replace('\'', "''"))
    }

    fn begin_transaction(&self) -> &'static str {
        "BEGIN"
    }

    /// `UPDATE … LIMIT` needs a compile-time option SQLite builds usually lack;
    /// rows are already identified by primary key or `rowid`.
    fn single_row_limit(&self) -> &'static str {
        ""
    }

    fn truncate_table(&self, table_ref: &str) -> String {
        format!("DELETE FROM {table_ref};")
    }

    fn insert_ignore(&self) -> &'static str {
        "INSERT OR IGNORE INTO"
    }

    fn upsert_suffix(&self, quoted_columns: &[String]) -> String {
        let updates = quoted_columns
            .iter()
            .map(|column| format!("{column} = excluded.{column}"))
            .collect::<Vec<_>>()
            .join(", ");
        format!(" ON CONFLICT DO UPDATE SET {updates}")
    }

    /// The schema prefixes the index name; the table is never qualified.
    fn create_index(&self, req: &CreateIndexRequest) -> Result<String, PyroError> {
        let keyword = match req.index_type.to_uppercase().as_str() {
            "UNIQUE" => "UNIQUE INDEX",
            "INDEX" | "BTREE" | "" => "INDEX",
            other => {
                return Err(PyroError::InvalidOperation(format!(
                    "SQLite no admite índices de tipo {other}."
                )))
            }
        };
        let name = self.qualify_table(Some(&req.database), &req.index_name)?;
        let table = self.quote_identifier(&req.table)?;
        let columns = quoted_index_columns(self, &req.columns)?;
        Ok(format!("CREATE {keyword} {name} ON {table} ({columns});"))
    }

    fn drop_index(
        &self,
        schema: Option<&str>,
        _table: &str,
        index: &str,
    ) -> Result<String, PyroError> {
        if index == "PRIMARY" {
            return Err(PyroError::InvalidOperation(
                "SQLite no permite eliminar la clave primaria; hay que recrear la tabla.".into(),
            ));
        }
        Ok(format!(
            "DROP INDEX {};",
            self.qualify_table(schema, index)?
        ))
    }
}

fn quoted_index_columns(dialect: &dyn Dialect, columns: &[String]) -> Result<String, PyroError> {
    if columns.is_empty() {
        return Err(PyroError::InvalidOperation(
            "Debes especificar al menos una columna para el índice.".into(),
        ));
    }
    let quoted = columns
        .iter()
        .map(|column| dialect.quote_identifier(column))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(quoted.join(", "))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn index_request(index_type: &str) -> CreateIndexRequest {
        CreateIndexRequest {
            database: "main".into(),
            table: "orders".into(),
            index_name: "idx_customer".into(),
            index_type: index_type.into(),
            columns: vec!["customer_id".into(), "created_at".into()],
            comment: None,
        }
    }

    #[test]
    fn sqlite_quotes_with_double_quotes() {
        assert_eq!(
            SQLITE_DIALECT.quote_identifier("a\"b").unwrap(),
            "\"a\"\"b\""
        );
        assert_eq!(
            SQLITE_DIALECT.qualify_table(Some("main"), "t").unwrap(),
            "\"main\".\"t\""
        );
        assert_eq!(MYSQL_DIALECT.qualify_table(None, "t").unwrap(), "`t`");
    }

    #[test]
    fn sqlite_literals_do_not_escape_backslashes() {
        assert_eq!(
            SQLITE_DIALECT.value_literal(&json!("C:\\x'y")),
            "'C:\\x''y'"
        );
        assert_eq!(MYSQL_DIALECT.value_literal(&json!("C:\\x")), "'C:\\\\x'");
        assert_eq!(
            MYSQL_DIALECT.value_literal(&json!("O'R")),
            crate::db::query::json_value_to_sql_literal(&json!("O'R"))
        );
    }

    #[test]
    fn sqlite_index_ddl_prefixes_the_index_name_with_the_schema() {
        assert_eq!(
            SQLITE_DIALECT.create_index(&index_request("UNIQUE")).unwrap(),
            "CREATE UNIQUE INDEX \"main\".\"idx_customer\" ON \"orders\" (\"customer_id\", \"created_at\");"
        );
        assert!(SQLITE_DIALECT
            .create_index(&index_request("FULLTEXT"))
            .is_err());
        assert_eq!(
            SQLITE_DIALECT
                .drop_index(Some("main"), "orders", "idx_customer")
                .unwrap(),
            "DROP INDEX \"main\".\"idx_customer\";"
        );
    }

    #[test]
    fn mysql_index_ddl_is_unchanged() {
        assert_eq!(
            MYSQL_DIALECT.create_index(&index_request("INDEX")).unwrap(),
            "ALTER TABLE `main`.`orders` ADD INDEX `idx_customer` (`customer_id`, `created_at`);"
        );
        assert_eq!(
            MYSQL_DIALECT.drop_index(None, "orders", "PRIMARY").unwrap(),
            "ALTER TABLE `orders` DROP PRIMARY KEY;"
        );
    }

    #[test]
    fn upserts_follow_each_engine_syntax() {
        let columns = vec!["\"name\"".to_string()];
        assert_eq!(
            SQLITE_DIALECT.upsert_suffix(&columns),
            " ON CONFLICT DO UPDATE SET \"name\" = excluded.\"name\""
        );
    }
}
