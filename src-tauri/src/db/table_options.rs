//! Table-level options of MariaDB/MySQL tables (engine, charset, collation,
//! AUTO_INCREMENT, row format, statistics…): reading them and building the
//! `ALTER TABLE` that changes only what the user edited.

use super::backend::DatabaseBackend;
use super::dialect::Dialect;
use super::engine::DbEngine;
use super::error::PyroError;
use super::query::value_to_u64;
use super::row_filter::target_database;
use serde::{Deserialize, Serialize};

/// Editable options of one table. Empty strings / `None` mean "server default".
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct TableOptions {
    pub engine: String,
    pub charset: String,
    pub collation: String,
    pub auto_increment: Option<u64>,
    /// `""` = DEFAULT.
    pub row_format: String,
    pub avg_row_length: Option<u64>,
    pub max_rows: Option<u64>,
    pub key_block_size: Option<u64>,
    /// `""` = DEFAULT, `"0"` or `"1"`.
    pub stats_auto_recalc: String,
    /// `""` = DEFAULT, `"0"` or `"1"`.
    pub stats_persistent: String,
    pub stats_sample_pages: Option<u64>,
    pub checksum: bool,
    pub encrypted: bool,
    pub comment: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharsetInfo {
    pub name: String,
    pub default_collation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollationInfo {
    pub name: String,
    pub charset: String,
}

/// Current options plus the values the server offers for the selectors.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableOptionsInfo {
    pub options: TableOptions,
    pub engines: Vec<String>,
    pub charsets: Vec<CharsetInfo>,
    pub collations: Vec<CollationInfo>,
    pub row_formats: Vec<String>,
    pub is_mariadb: bool,
    pub partitioned: bool,
}

/// Change requested from the options editor.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableOptionsChange {
    pub current: TableOptions,
    pub desired: TableOptions,
    /// Re-encode the existing columns (`CONVERT TO CHARACTER SET`) instead of
    /// only changing the default for new columns.
    #[serde(default)]
    pub convert_charset: bool,
}

const ROW_FORMATS: [&str; 6] = [
    "DYNAMIC",
    "COMPACT",
    "REDUNDANT",
    "COMPRESSED",
    "FIXED",
    "PAGE",
];

fn ensure_mysql(backend: &dyn DatabaseBackend) -> Result<(), PyroError> {
    match backend.engine() {
        DbEngine::MySql => Ok(()),
        DbEngine::Sqlite => Err(PyroError::InvalidOperation(
            "Table options are only available for MariaDB/MySQL.".into(),
        )),
    }
}

fn cell_str(row: &[serde_json::Value], idx: usize) -> String {
    match row.get(idx) {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Null) | None => String::new(),
        Some(other) => other.to_string(),
    }
}

/// Options explicitly set on the table, from `information_schema.TABLES.CREATE_OPTIONS`
/// (e.g. `row_format=DYNAMIC stats_persistent=1 \`ENCRYPTED\`=YES partitioned`).
fn apply_create_options(options: &mut TableOptions, create_options: &str) -> bool {
    let mut partitioned = false;
    for token in create_options.split_whitespace() {
        let (key, value) = match token.split_once('=') {
            Some((k, v)) => (k, v),
            None => (token, ""),
        };
        let key = key
            .trim_matches(|c| c == '`' || c == '"')
            .to_ascii_lowercase();
        let value = value.trim_matches(|c| c == '\'' || c == '"' || c == '`');
        let number = value.parse::<u64>().ok();
        match key.as_str() {
            "partitioned" => partitioned = true,
            "row_format" => options.row_format = value.to_ascii_uppercase(),
            "avg_row_length" => options.avg_row_length = number,
            "max_rows" => options.max_rows = number,
            "key_block_size" => options.key_block_size = number,
            "stats_auto_recalc" => options.stats_auto_recalc = value.to_string(),
            "stats_persistent" => options.stats_persistent = value.to_string(),
            "stats_sample_pages" => options.stats_sample_pages = number,
            "checksum" => options.checksum = value == "1",
            "encryption" | "encrypted" => {
                options.encrypted = matches!(value.to_ascii_uppercase().as_str(), "Y" | "YES")
            }
            _ => {}
        }
    }
    partitioned
}

/// `AUTO_INCREMENT=n` from `SHOW CREATE TABLE` (information_schema can be stale on MySQL 8).
fn auto_increment_from_ddl(ddl: &str) -> Option<u64> {
    let options_line = ddl.lines().rev().find(|line| line.starts_with(')'))?;
    let rest = &options_line[options_line.find("AUTO_INCREMENT=")? + "AUTO_INCREMENT=".len()..];
    rest.chars()
        .take_while(|c| c.is_ascii_digit())
        .collect::<String>()
        .parse()
        .ok()
}

pub async fn get_table_options(
    backend: &dyn DatabaseBackend,
    is_mariadb: bool,
    database: &str,
    table: &str,
) -> Result<TableOptionsInfo, PyroError> {
    ensure_mysql(backend)?;
    let dialect = backend.engine().dialect();
    let db = target_database(database);
    let schema_lit = dialect.string_literal(database);
    let table_lit = dialect.string_literal(table);

    let status = backend
        .execute_query(
            &format!(
                "SELECT ENGINE, TABLE_COLLATION, AUTO_INCREMENT, CREATE_OPTIONS, TABLE_COMMENT \
                 FROM information_schema.TABLES WHERE TABLE_SCHEMA = {schema_lit} AND TABLE_NAME = {table_lit}"
            ),
            db,
        )
        .await?;
    let row = status
        .rows
        .first()
        .ok_or_else(|| PyroError::InvalidOperation(format!("Table `{table}` not found.")))?;

    let mut options = TableOptions {
        engine: cell_str(row, 0),
        collation: cell_str(row, 1),
        auto_increment: row.get(2).and_then(value_to_u64),
        comment: cell_str(row, 4),
        ..Default::default()
    };
    let partitioned = apply_create_options(&mut options, &cell_str(row, 3));

    let table_ref = dialect.qualify_table(db, table)?;
    if let Ok(ddl) = backend
        .execute_query(&format!("SHOW CREATE TABLE {table_ref}"), db)
        .await
    {
        if let Some(text) = ddl.rows.first().map(|r| cell_str(r, 1)) {
            options.auto_increment = auto_increment_from_ddl(&text).or(options.auto_increment);
        }
    }

    let engines = backend
        .execute_query(
            "SELECT ENGINE FROM information_schema.ENGINES WHERE SUPPORT IN ('YES', 'DEFAULT') ORDER BY ENGINE",
            db,
        )
        .await?
        .rows
        .iter()
        .map(|r| cell_str(r, 0))
        .filter(|e| !e.is_empty())
        .collect();

    let charsets = backend
        .execute_query(
            "SELECT CHARACTER_SET_NAME, DEFAULT_COLLATE_NAME FROM information_schema.CHARACTER_SETS ORDER BY CHARACTER_SET_NAME",
            db,
        )
        .await?
        .rows
        .iter()
        .map(|r| CharsetInfo {
            name: cell_str(r, 0),
            default_collation: cell_str(r, 1),
        })
        .collect();

    let collations: Vec<CollationInfo> = backend
        .execute_query(
            "SELECT COLLATION_NAME, CHARACTER_SET_NAME FROM information_schema.COLLATIONS \
             WHERE CHARACTER_SET_NAME IS NOT NULL ORDER BY COLLATION_NAME",
            db,
        )
        .await?
        .rows
        .iter()
        .map(|r| CollationInfo {
            name: cell_str(r, 0),
            charset: cell_str(r, 1),
        })
        .collect();

    options.charset = collations
        .iter()
        .find(|c| c.name.eq_ignore_ascii_case(&options.collation))
        .map(|c| c.charset.clone())
        .unwrap_or_else(|| {
            options
                .collation
                .split('_')
                .next()
                .unwrap_or_default()
                .to_string()
        });

    Ok(TableOptionsInfo {
        options,
        engines,
        charsets,
        collations,
        row_formats: ROW_FORMATS.iter().map(|s| s.to_string()).collect(),
        is_mariadb,
        partitioned,
    })
}

/// Charset, collation and engine names: plain words only.
fn plain_word(value: &str, what: &str) -> Result<String, PyroError> {
    let value = value.trim();
    if !value.is_empty() && value.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        Ok(value.to_string())
    } else {
        Err(PyroError::InvalidOperation(format!(
            "Invalid {what}: {value}"
        )))
    }
}

fn stat_flag(value: &str) -> Result<&'static str, PyroError> {
    match value.trim() {
        "" => Ok("DEFAULT"),
        "0" => Ok("0"),
        "1" => Ok("1"),
        other => Err(PyroError::InvalidOperation(format!(
            "Invalid statistics flag: {other}"
        ))),
    }
}

/// `ALTER TABLE` with only the options that differ between `current` and `desired`;
/// `None` when nothing changed.
pub fn build_alter_table_options(
    dialect: &dyn Dialect,
    is_mariadb: bool,
    database: &str,
    table: &str,
    change: &TableOptionsChange,
) -> Result<Option<String>, PyroError> {
    let cur = &change.current;
    let new = &change.desired;
    let mut clauses: Vec<String> = Vec::new();

    if !new.engine.eq_ignore_ascii_case(&cur.engine) && !new.engine.trim().is_empty() {
        clauses.push(format!("ENGINE={}", plain_word(&new.engine, "engine")?));
    }

    let charset_changed = !new.charset.eq_ignore_ascii_case(&cur.charset);
    let collation_changed = !new.collation.eq_ignore_ascii_case(&cur.collation);
    if (charset_changed || collation_changed || change.convert_charset)
        && !new.charset.trim().is_empty()
    {
        let charset = plain_word(&new.charset, "character set")?;
        let collate = if new.collation.trim().is_empty() {
            String::new()
        } else {
            format!(" COLLATE {}", plain_word(&new.collation, "collation")?)
        };
        if change.convert_charset {
            clauses.push(format!("CONVERT TO CHARACTER SET {charset}{collate}"));
        } else {
            clauses.push(format!("DEFAULT CHARACTER SET {charset}{collate}"));
        }
    }

    if new.auto_increment != cur.auto_increment {
        if let Some(value) = new.auto_increment {
            clauses.push(format!("AUTO_INCREMENT={value}"));
        }
    }

    if !new.row_format.eq_ignore_ascii_case(&cur.row_format) {
        let format = new.row_format.trim().to_ascii_uppercase();
        if format.is_empty() || format == "DEFAULT" {
            clauses.push("ROW_FORMAT=DEFAULT".into());
        } else if ROW_FORMATS.contains(&format.as_str()) {
            clauses.push(format!("ROW_FORMAT={format}"));
        } else {
            return Err(PyroError::InvalidOperation(format!(
                "Invalid row format: {format}"
            )));
        }
    }

    let numeric = [
        ("AVG_ROW_LENGTH", cur.avg_row_length, new.avg_row_length),
        ("MAX_ROWS", cur.max_rows, new.max_rows),
        ("KEY_BLOCK_SIZE", cur.key_block_size, new.key_block_size),
    ];
    for (name, old, value) in numeric {
        if old.unwrap_or(0) != value.unwrap_or(0) {
            clauses.push(format!("{name}={}", value.unwrap_or(0)));
        }
    }

    if new.stats_auto_recalc.trim() != cur.stats_auto_recalc.trim() {
        clauses.push(format!(
            "STATS_AUTO_RECALC={}",
            stat_flag(&new.stats_auto_recalc)?
        ));
    }
    if new.stats_persistent.trim() != cur.stats_persistent.trim() {
        clauses.push(format!(
            "STATS_PERSISTENT={}",
            stat_flag(&new.stats_persistent)?
        ));
    }
    if new.stats_sample_pages != cur.stats_sample_pages {
        match new.stats_sample_pages {
            Some(pages) if pages > 0 => clauses.push(format!("STATS_SAMPLE_PAGES={pages}")),
            _ => clauses.push("STATS_SAMPLE_PAGES=DEFAULT".into()),
        }
    }

    if new.checksum != cur.checksum {
        clauses.push(format!("CHECKSUM={}", u8::from(new.checksum)));
    }

    if new.encrypted != cur.encrypted {
        clauses.push(if is_mariadb {
            format!("ENCRYPTED={}", if new.encrypted { "YES" } else { "NO" })
        } else {
            format!("ENCRYPTION='{}'", if new.encrypted { "Y" } else { "N" })
        });
    }

    if new.comment != cur.comment {
        clauses.push(format!("COMMENT={}", dialect.string_literal(&new.comment)));
    }

    if clauses.is_empty() {
        return Ok(None);
    }
    let table_ref = dialect.qualify_table(target_database(database), table)?;
    Ok(Some(format!(
        "ALTER TABLE {table_ref}\n  {};",
        clauses.join(",\n  ")
    )))
}

pub async fn apply_table_options(
    backend: &dyn DatabaseBackend,
    is_mariadb: bool,
    database: &str,
    table: &str,
    change: &TableOptionsChange,
) -> Result<Option<String>, PyroError> {
    ensure_mysql(backend)?;
    let dialect = backend.engine().dialect();
    let Some(sql) = build_alter_table_options(dialect, is_mariadb, database, table, change)? else {
        return Ok(None);
    };
    backend
        .execute_query(&sql, target_database(database))
        .await?;
    Ok(Some(sql))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::dialect::MYSQL_DIALECT;

    fn base() -> TableOptions {
        TableOptions {
            engine: "InnoDB".into(),
            charset: "utf8mb4".into(),
            collation: "utf8mb4_unicode_ci".into(),
            auto_increment: Some(49),
            row_format: "DYNAMIC".into(),
            ..Default::default()
        }
    }

    fn build(desired: TableOptions, convert: bool, maria: bool) -> Option<String> {
        build_alter_table_options(
            &MYSQL_DIALECT,
            maria,
            "shop",
            "orders",
            &TableOptionsChange {
                current: base(),
                desired,
                convert_charset: convert,
            },
        )
        .unwrap()
    }

    #[test]
    fn no_changes_yields_nothing() {
        assert_eq!(build(base(), false, false), None);
    }

    #[test]
    fn only_changed_options_are_emitted() {
        let mut desired = base();
        desired.engine = "Aria".into();
        desired.auto_increment = Some(100);
        desired.comment = "it's".into();
        let sql = build(desired, false, true).unwrap();
        assert_eq!(
            sql,
            "ALTER TABLE `shop`.`orders`\n  ENGINE=Aria,\n  AUTO_INCREMENT=100,\n  COMMENT='it\\'s';"
        );
    }

    #[test]
    fn charset_default_or_convert() {
        let mut desired = base();
        desired.collation = "utf8mb4_general_ci".into();
        assert!(build(desired.clone(), false, false)
            .unwrap()
            .contains("DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci"));
        assert!(build(desired, true, false)
            .unwrap()
            .contains("CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci"));
    }

    #[test]
    fn encryption_follows_flavor() {
        let mut desired = base();
        desired.encrypted = true;
        assert!(build(desired.clone(), false, true)
            .unwrap()
            .contains("ENCRYPTED=YES"));
        assert!(build(desired, false, false)
            .unwrap()
            .contains("ENCRYPTION='Y'"));
    }

    #[test]
    fn rejects_injection_in_words() {
        let mut desired = base();
        desired.engine = "InnoDB; DROP TABLE x".into();
        let res = build_alter_table_options(
            &MYSQL_DIALECT,
            false,
            "shop",
            "orders",
            &TableOptionsChange {
                current: base(),
                desired,
                convert_charset: false,
            },
        );
        assert!(res.is_err());
    }

    #[test]
    fn parses_create_options_and_ddl() {
        let mut o = TableOptions::default();
        let partitioned = apply_create_options(
            &mut o,
            "row_format=DYNAMIC stats_persistent=1 max_rows=10 `ENCRYPTED`=YES partitioned",
        );
        assert!(partitioned);
        assert_eq!(o.row_format, "DYNAMIC");
        assert_eq!(o.stats_persistent, "1");
        assert_eq!(o.max_rows, Some(10));
        assert!(o.encrypted);
        assert_eq!(
            auto_increment_from_ddl(
                "CREATE TABLE `t` (\n  `id` int\n) ENGINE=InnoDB AUTO_INCREMENT=49 DEFAULT CHARSET=utf8mb4"
            ),
            Some(49)
        );
    }
}
