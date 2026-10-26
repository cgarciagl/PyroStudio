//! Saved queries as real `.sql` files with an optional SQL-comment metadata header.
//!
//! Header format (only these keys are recognised; everything else is SQL):
//!
//! ```sql
//! -- pyro-id: 3f0c…
//! -- pyro-title: Estadísticas de alumnos
//! -- pyro-category: Reportes
//! -- pyro-description: Resumen por periodo.
//! -- pyro-created: 2026-10-21T00:00:00.000Z
//! -- pyro-updated: 2026-10-21T00:00:00.000Z
//!
//! SELECT …
//! ```
//!
//! The header ends at the first line that is not a `-- pyro-<key>:` line; a single
//! blank separator line after it is consumed. The SQL body is kept byte-for-byte.
//! Newlines and backslashes inside values are escaped as `\n` and `\\`.

use super::error::{WorkspaceError, WsResult};
use super::models::*;
use super::repository::{
    atomic_write, content_hash, ensure_within, new_uuid, sanitize_segment, validate_id,
};
use chrono::{DateTime, TimeZone, Utc};
use std::fs;
use std::path::{Path, PathBuf};

const KEYS: [&str; 6] = [
    "id",
    "title",
    "category",
    "description",
    "created",
    "updated",
];
const MAX_DEPTH: usize = 6;
const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;
pub const DEFAULT_CATEGORY: &str = "General";

#[derive(Debug, Default, Clone, PartialEq)]
pub struct ParsedSql {
    pub id: Option<String>,
    pub title: Option<String>,
    pub category: Option<String>,
    pub description: Option<String>,
    pub created: Option<i64>,
    pub updated: Option<i64>,
    pub body: String,
    pub has_header: bool,
}

fn escape(v: &str) -> String {
    v.replace('\\', "\\\\")
        .replace('\r', "")
        .replace('\n', "\\n")
}

fn unescape(v: &str) -> String {
    let mut out = String::new();
    let mut chars = v.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') => out.push('\n'),
                Some('\\') => out.push('\\'),
                Some(o) => {
                    out.push('\\');
                    out.push(o);
                }
                None => out.push('\\'),
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn to_iso(ms: i64) -> String {
    Utc.timestamp_millis_opt(ms)
        .single()
        .unwrap_or_else(Utc::now)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn from_iso(s: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(s.trim())
        .ok()
        .map(|d| d.timestamp_millis())
        .or_else(|| s.trim().parse::<i64>().ok())
}

/// Splits one header line into (key, value) if it is a recognised `-- pyro-<key>:` line.
fn header_line(line: &str) -> Option<(&'static str, String)> {
    let l = line.trim_end_matches('\r');
    let rest = l.strip_prefix("-- pyro-")?;
    let (key, value) = rest.split_once(':')?;
    let key = KEYS.iter().find(|k| **k == key.trim())?;
    Some((key, unescape(value.strip_prefix(' ').unwrap_or(value))))
}

pub fn parse_sql_file(text: &str) -> ParsedSql {
    let mut parsed = ParsedSql::default();
    let mut offset = 0;
    for line in text.split_inclusive('\n') {
        match header_line(line.trim_end_matches('\n')) {
            Some((key, value)) => {
                parsed.has_header = true;
                match key {
                    "id" => parsed.id = Some(value.trim().to_string()),
                    "title" => parsed.title = Some(value),
                    "category" => parsed.category = Some(value),
                    "description" => parsed.description = Some(value),
                    "created" => parsed.created = from_iso(&value),
                    "updated" => parsed.updated = from_iso(&value),
                    _ => {}
                }
                offset += line.len();
            }
            None => break,
        }
    }
    let mut body = &text[offset..];
    if parsed.has_header {
        if let Some(b) = body.strip_prefix("\r\n") {
            body = b;
        } else if let Some(b) = body.strip_prefix('\n') {
            body = b;
        }
    }
    parsed.body = body.to_string();
    parsed
}

pub fn render_sql_file(q: &WorkspaceQuery) -> String {
    let mut out = String::new();
    out.push_str(&format!("-- pyro-id: {}\n", escape(&q.id)));
    out.push_str(&format!("-- pyro-title: {}\n", escape(&q.title)));
    out.push_str(&format!("-- pyro-category: {}\n", escape(&q.category)));
    if let Some(d) = q.description.as_deref().filter(|d| !d.trim().is_empty()) {
        out.push_str(&format!("-- pyro-description: {}\n", escape(d)));
    }
    out.push_str(&format!("-- pyro-created: {}\n", to_iso(q.created_at)));
    out.push_str(&format!("-- pyro-updated: {}\n", to_iso(q.updated_at)));
    out.push('\n');
    out.push_str(&q.sql);
    out
}

fn rel_string(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/")
}

fn mtime_ms(path: &Path) -> i64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Builds the UI model from a file on disk.
pub fn read_query_file(root: &Path, path: &Path) -> WsResult<WorkspaceQuery> {
    ensure_within(root, path)?;
    let meta = fs::symlink_metadata(path)?;
    if !meta.is_file() {
        return Err(WorkspaceError::NotFound(rel_string(root, path)));
    }
    if meta.len() > MAX_FILE_BYTES {
        return Err(WorkspaceError::InvalidData(
            "archivo SQL demasiado grande".into(),
        ));
    }
    let bytes = fs::read(path)?;
    let text = String::from_utf8(bytes.clone())
        .map_err(|_| WorkspaceError::InvalidData("el archivo no es UTF-8".into()))?;
    let parsed = parse_sql_file(&text);
    let rel = rel_string(root, path);

    let id = match parsed.id.as_deref() {
        Some(id) if validate_id(id).is_ok() => id.to_string(),
        _ => format!("file-{}", &content_hash(rel.as_bytes())[..16]),
    };
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let dir_category = path
        .parent()
        .filter(|p| {
            p.file_name()
                .map(|n| n != QUERIES_DIR && n != SNIPPETS_DIR)
                .unwrap_or(false)
                && p.strip_prefix(root)
                    .map(|r| r.components().count() > 1)
                    .unwrap_or(false)
        })
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().to_string());
    let fallback_category = if rel.starts_with(&format!("{SNIPPETS_DIR}/")) {
        "Snippets".to_string()
    } else {
        DEFAULT_CATEGORY.to_string()
    };
    let mtime = mtime_ms(path);

    Ok(WorkspaceQuery {
        id,
        title: parsed
            .title
            .filter(|t| !t.trim().is_empty())
            .unwrap_or(stem),
        category: parsed
            .category
            .filter(|c| !c.trim().is_empty())
            .or(dir_category)
            .unwrap_or(fallback_category),
        sql: parsed.body,
        description: parsed.description.filter(|d| !d.is_empty()),
        created_at: parsed.created.unwrap_or(mtime),
        updated_at: parsed.updated.unwrap_or(mtime),
        rel_path: rel,
        content_hash: content_hash(&bytes),
        has_header: parsed.has_header,
    })
}

fn collect_sql_files(
    root: &Path,
    dir: &Path,
    depth: usize,
    out: &mut Vec<PathBuf>,
) -> WsResult<()> {
    if depth > MAX_DEPTH || !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue; // temp files, hidden sync metadata
        }
        // symlink_metadata: never follow links out of the workspace.
        let meta = fs::symlink_metadata(&path)?;
        if meta.is_dir() {
            collect_sql_files(root, &path, depth + 1, out)?;
        } else if meta.is_file()
            && path
                .extension()
                .map(|e| e.eq_ignore_ascii_case("sql"))
                .unwrap_or(false)
        {
            out.push(path);
        }
    }
    Ok(())
}

pub fn list_queries(root: &Path) -> WsResult<QueryListing> {
    let mut files = Vec::new();
    for d in [QUERIES_DIR, SNIPPETS_DIR] {
        collect_sql_files(root, &root.join(d), 0, &mut files)?;
    }
    let mut listing = QueryListing::default();
    let mut seen = std::collections::HashSet::new();
    for f in files {
        match read_query_file(root, &f) {
            Ok(q) => {
                if seen.insert(q.id.clone()) {
                    listing.queries.push(q);
                } else {
                    // e.g. a sync-provider conflict copy carrying the same pyro-id.
                    listing.errors.push(format!(
                        "{}: id duplicado '{}' (posible copia de conflicto; no se ha modificado)",
                        q.rel_path, q.id
                    ));
                }
            }
            Err(e) => listing
                .errors
                .push(format!("{}: {e}", rel_string(root, &f))),
        }
    }
    listing
        .queries
        .sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(listing)
}

pub fn find_query(root: &Path, id: &str) -> WsResult<WorkspaceQuery> {
    validate_id(id)?;
    list_queries(root)?
        .queries
        .into_iter()
        .find(|q| q.id == id)
        .ok_or_else(|| WorkspaceError::NotFound(id.to_string()))
}

fn abs_from_rel(root: &Path, rel: &str) -> PathBuf {
    rel.split('/')
        .fold(root.to_path_buf(), |p, seg| p.join(seg))
}

/// Picks `queries/<category>/<title>.sql`, appending ` (n)` instead of overwriting
/// a file that belongs to another query.
fn target_path(
    root: &Path,
    category: &str,
    title: &str,
    own_rel: Option<&str>,
) -> WsResult<PathBuf> {
    let dir = root
        .join(QUERIES_DIR)
        .join(sanitize_segment(category, DEFAULT_CATEGORY));
    let base = sanitize_segment(title, "consulta");
    for n in 1..1000 {
        let name = if n == 1 {
            format!("{base}.sql")
        } else {
            format!("{base} ({n}).sql")
        };
        let candidate = dir.join(name);
        let rel = rel_string(root, &candidate);
        let taken = candidate.exists()
            && own_rel
                .map(|o| !o.eq_ignore_ascii_case(&rel))
                .unwrap_or(true);
        if !taken {
            ensure_within(root, &candidate)?;
            return Ok(candidate);
        }
    }
    Err(WorkspaceError::Duplicate(base))
}

/// Creates or updates a query. Handles rename/move (title or category change)
/// without overwriting other files, and refuses to clobber external edits.
pub fn save_query(root: &Path, input: &SaveQueryInput) -> WsResult<WorkspaceQuery> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err(WorkspaceError::InvalidData(
            "el título es obligatorio".into(),
        ));
    }
    let category = match input.category.trim() {
        "" => DEFAULT_CATEGORY,
        c => c,
    };
    let now = Utc::now().timestamp_millis();

    let existing = match input.id.as_deref() {
        Some(id) => match find_query(root, id) {
            Ok(q) => Some(q),
            Err(WorkspaceError::NotFound(_)) => None,
            Err(e) => return Err(e),
        },
        None => None,
    };

    if let Some(ex) = &existing {
        let current = content_hash(&fs::read(abs_from_rel(root, &ex.rel_path))?);
        if !input.force {
            match input.expected_hash.as_deref() {
                Some(h) if h == current => {}
                _ => return Err(WorkspaceError::Conflict(ex.rel_path.clone())),
            }
        }
    }

    let id = match input.id.as_deref() {
        Some(id) => {
            validate_id(id)?;
            id.to_string()
        }
        None => new_uuid()?,
    };

    // Keep the existing location when only the SQL/description changed.
    let target = match &existing {
        Some(ex) if ex.title == title && ex.category == category => {
            abs_from_rel(root, &ex.rel_path)
        }
        Some(ex) => target_path(root, category, title, Some(&ex.rel_path))?,
        None => target_path(root, category, title, None)?,
    };

    let query = WorkspaceQuery {
        id,
        title: title.to_string(),
        category: category.to_string(),
        sql: input.sql.clone(),
        description: input.description.clone().filter(|d| !d.trim().is_empty()),
        created_at: existing
            .as_ref()
            .map(|e| e.created_at)
            .or(input.created_at)
            .unwrap_or(now),
        updated_at: input
            .updated_at
            .filter(|_| existing.is_none())
            .unwrap_or(now),
        rel_path: rel_string(root, &target),
        content_hash: String::new(),
        has_header: true,
    };
    atomic_write(root, &target, render_sql_file(&query).as_bytes())?;

    if let Some(ex) = &existing {
        let old = abs_from_rel(root, &ex.rel_path);
        if old != target {
            ensure_within(root, &old)?;
            fs::remove_file(&old)?;
        }
    }
    read_query_file(root, &target)
}

pub fn delete_query(root: &Path, id: &str, expected_hash: Option<&str>) -> WsResult<()> {
    let q = find_query(root, id)?;
    let path = abs_from_rel(root, &q.rel_path);
    ensure_within(root, &path)?;
    if let Some(h) = expected_hash {
        if h != q.content_hash {
            return Err(WorkspaceError::Conflict(q.rel_path));
        }
    }
    fs::remove_file(path)?;
    Ok(())
}
