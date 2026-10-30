//! Local audit log of data writes.
//!
//! Every statement that modifies data or schema through the active session is
//! appended as one JSON line to `<workspace>/.pyro/audit/audit-YYYY-MM-DD.jsonl`
//! (or the app data folder when no workspace is active). Files older than
//! `RETENTION_DAYS` are removed when a new day's file is created. Credentials
//! never reach this log: only the SQL text, which is truncated.

use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use super::error::PyroError;

const RETENTION_DAYS: i64 = 90;
const MAX_SQL_CHARS: usize = 4000;
const FILE_PREFIX: &str = "audit-";
const FILE_SUFFIX: &str = ".jsonl";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuditEntry {
    /// RFC 3339 local timestamp.
    pub timestamp: String,
    pub connection: String,
    pub database: Option<String>,
    pub sql: String,
    pub affected_rows: Option<u64>,
    pub duration_ms: u64,
    pub success: bool,
    pub error: Option<String>,
}

impl AuditEntry {
    pub fn new(connection: &str, database: Option<&str>, sql: &str) -> Self {
        Self {
            timestamp: chrono::Local::now().to_rfc3339(),
            connection: connection.to_string(),
            database: database.map(str::to_string),
            sql: truncate(sql),
            affected_rows: None,
            duration_ms: 0,
            success: true,
            error: None,
        }
    }
}

pub(super) fn truncate(sql: &str) -> String {
    let trimmed = sql.trim();
    match trimmed.char_indices().nth(MAX_SQL_CHARS) {
        Some((cut, _)) => format!("{}…", &trimmed[..cut]),
        None => trimmed.to_string(),
    }
}

/// Folder that receives the audit files.
pub fn audit_dir() -> PathBuf {
    let workspace = crate::workspace::service::WorkspaceManager::new(
        crate::workspace::service::default_config_path(),
    );
    match workspace.root() {
        Ok(root) => root.join(".pyro").join("audit"),
        Err(_) => dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("PyroStudio")
            .join("audit"),
    }
}

/// Appends `entry` without blocking the async runtime. Failures are logged,
/// never surfaced: auditing must not break the statement that already ran.
pub fn record(entry: AuditEntry) {
    tokio::task::spawn_blocking(move || {
        if let Err(error) = append(&audit_dir(), &entry) {
            tracing::error!("No se pudo escribir el log de auditoría: {error}");
        }
    });
}

fn file_for(dir: &Path, date: &str) -> PathBuf {
    dir.join(format!("{FILE_PREFIX}{date}{FILE_SUFFIX}"))
}

fn append(dir: &Path, entry: &AuditEntry) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let path = file_for(dir, &today);
    if !path.exists() {
        purge_older_than(dir, chrono::Local::now().date_naive(), RETENTION_DAYS);
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    let line = serde_json::to_string(entry).map_err(std::io::Error::other)?;
    writeln!(file, "{line}")
}

fn file_date(path: &Path) -> Option<chrono::NaiveDate> {
    let name = path.file_name()?.to_str()?;
    let date = name.strip_prefix(FILE_PREFIX)?.strip_suffix(FILE_SUFFIX)?;
    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()
}

fn purge_older_than(dir: &Path, today: chrono::NaiveDate, days: i64) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for path in entries.flatten().map(|e| e.path()) {
        if file_date(&path).is_some_and(|date| (today - date).num_days() > days) {
            let _ = fs::remove_file(path);
        }
    }
}

/// Newest entries first, optionally filtered by a case-insensitive text.
pub fn read_recent(limit: usize, filter: Option<&str>) -> Result<Vec<AuditEntry>, PyroError> {
    read_from(&audit_dir(), limit, filter)
}

fn read_from(dir: &Path, limit: usize, filter: Option<&str>) -> Result<Vec<AuditEntry>, PyroError> {
    let mut files: Vec<PathBuf> = match fs::read_dir(dir) {
        Ok(entries) => entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| file_date(p).is_some())
            .collect(),
        Err(_) => return Ok(Vec::new()),
    };
    files.sort_by_key(|p| std::cmp::Reverse(file_date(p)));
    let needle = filter
        .map(|f| f.trim().to_lowercase())
        .filter(|f| !f.is_empty());

    let mut result = Vec::new();
    for path in files {
        let file = fs::File::open(&path)?;
        let mut day: Vec<AuditEntry> = BufReader::new(file)
            .lines()
            .map_while(Result::ok)
            .filter_map(|line| serde_json::from_str::<AuditEntry>(&line).ok())
            .filter(|entry| needle.as_deref().is_none_or(|n| matches_filter(entry, n)))
            .collect();
        day.reverse();
        result.extend(day);
        if result.len() >= limit {
            result.truncate(limit);
            break;
        }
    }
    Ok(result)
}

fn matches_filter(entry: &AuditEntry, needle: &str) -> bool {
    entry.sql.to_lowercase().contains(needle)
        || entry.connection.to_lowercase().contains(needle)
        || entry
            .database
            .as_deref()
            .is_some_and(|d| d.to_lowercase().contains(needle))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pyro-audit-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn entries_are_read_back_newest_first_and_filtered() {
        let dir = temp_dir("read");
        for sql in ["UPDATE a SET x = 1", "DELETE FROM b WHERE id = 2"] {
            append(&dir, &AuditEntry::new("prod", Some("ventas"), sql)).unwrap();
        }
        let all = read_from(&dir, 10, None).unwrap();
        assert_eq!(all.len(), 2);
        assert!(all[0].sql.starts_with("DELETE"));
        let filtered = read_from(&dir, 10, Some("update")).unwrap();
        assert_eq!(filtered.len(), 1);
        assert_eq!(read_from(&dir, 1, None).unwrap().len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn old_files_are_purged() {
        let dir = temp_dir("purge");
        fs::create_dir_all(&dir).unwrap();
        fs::write(file_for(&dir, "2020-01-01"), "").unwrap();
        fs::write(file_for(&dir, "2026-10-29"), "").unwrap();
        let today = chrono::NaiveDate::from_ymd_opt(2026, 10, 30).unwrap();
        purge_older_than(&dir, today, 90);
        assert!(!file_for(&dir, "2020-01-01").exists());
        assert!(file_for(&dir, "2026-10-29").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn long_sql_is_truncated() {
        let sql = "x".repeat(MAX_SQL_CHARS + 10);
        assert_eq!(truncate(&sql).chars().count(), MAX_SQL_CHARS + 1);
    }
}
