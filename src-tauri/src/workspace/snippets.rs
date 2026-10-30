//! SQL snippets shared through the workspace, stored in `snippets/snippets.json`:
//!
//! ```json
//! { "formatVersion": 1,
//!   "snippets": [ { "id": "snp-…", "prefix": "selw", "name": "SELECT con WHERE",
//!                   "description": "…", "body": "SELECT *\nFROM ${tabla}\nWHERE ${condicion};" } ] }
//! ```
//!
//! `${campo}` marks editor tab stops and `:variable` a value asked at execution.
//! Writes are atomic and guarded by the content hash the client last read.

use super::error::{WorkspaceError, WsResult};
use super::models::FORMAT_VERSION;
use super::repository::{atomic_write, content_hash, validate_id};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

pub const SNIPPETS_DIR: &str = "snippets";
const SNIPPETS_FILE: &str = "snippets.json";
const MAX_SNIPPETS: usize = 2_000;
const MAX_BODY: usize = 100_000;
const MAX_LABEL: usize = 128;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SqlSnippet {
    pub id: String,
    /// Word typed in the editor to offer the snippet.
    pub prefix: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SnippetsFile {
    format_version: u32,
    #[serde(default)]
    snippets: Vec<SqlSnippet>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnippetsSnapshot {
    pub snippets: Vec<SqlSnippet>,
    /// Hash of the file as read (empty when the file does not exist yet).
    pub content_hash: String,
}

fn snippets_path(root: &Path) -> PathBuf {
    root.join(SNIPPETS_DIR).join(SNIPPETS_FILE)
}

fn valid_label(s: &str) -> bool {
    let t = s.trim();
    !t.is_empty() && t.len() <= MAX_LABEL && !t.chars().any(char::is_control)
}

/// Trims labels and rejects invalid ids, empty bodies, oversized data and duplicates.
pub fn sanitize(input: &[SqlSnippet]) -> WsResult<Vec<SqlSnippet>> {
    if input.len() > MAX_SNIPPETS {
        return Err(WorkspaceError::InvalidData("demasiados snippets".into()));
    }
    let mut ids = HashSet::new();
    input
        .iter()
        .map(|s| {
            validate_id(&s.id)?;
            if !ids.insert(s.id.clone()) {
                return Err(WorkspaceError::InvalidData(format!(
                    "snippet duplicado: {}",
                    s.id
                )));
            }
            let prefix_ok =
                valid_label(&s.prefix) && !s.prefix.trim().contains(char::is_whitespace);
            if !prefix_ok || !valid_label(&s.name) {
                return Err(WorkspaceError::InvalidData(format!(
                    "prefijo o nombre no válido en el snippet {}",
                    s.id
                )));
            }
            if s.body.trim().is_empty() || s.body.len() > MAX_BODY {
                return Err(WorkspaceError::InvalidData(format!(
                    "cuerpo vacío o demasiado grande en el snippet {}",
                    s.id
                )));
            }
            Ok(SqlSnippet {
                id: s.id.clone(),
                prefix: s.prefix.trim().to_string(),
                name: s.name.trim().to_string(),
                description: s
                    .description
                    .as_deref()
                    .map(str::trim)
                    .filter(|d| !d.is_empty())
                    .map(str::to_string),
                body: s.body.clone(),
            })
        })
        .collect()
}

pub fn read_snippets(root: &Path) -> WsResult<SnippetsSnapshot> {
    let path = snippets_path(root);
    if !path.exists() {
        return Ok(SnippetsSnapshot {
            snippets: Vec::new(),
            content_hash: String::new(),
        });
    }
    let bytes = fs::read(&path)?;
    let file: SnippetsFile = serde_json::from_slice(&bytes)?;
    if file.format_version > FORMAT_VERSION {
        return Err(WorkspaceError::IncompatibleVersion {
            found: file.format_version,
            supported: FORMAT_VERSION,
        });
    }
    Ok(SnippetsSnapshot {
        snippets: sanitize(&file.snippets)?,
        content_hash: content_hash(&bytes),
    })
}

/// Replaces every snippet. `expected_hash` must match what is on disk (empty
/// string = file must not exist), otherwise `Conflict` is returned untouched.
pub fn save_snippets(
    root: &Path,
    snippets: &[SqlSnippet],
    expected_hash: &str,
) -> WsResult<SnippetsSnapshot> {
    let path = snippets_path(root);
    let current = if path.exists() {
        content_hash(&fs::read(&path)?)
    } else {
        String::new()
    };
    if current != expected_hash {
        return Err(WorkspaceError::Conflict(format!(
            "{SNIPPETS_DIR}/{SNIPPETS_FILE}"
        )));
    }
    let file = SnippetsFile {
        format_version: FORMAT_VERSION,
        snippets: sanitize(snippets)?,
    };
    let mut bytes = serde_json::to_vec_pretty(&file)?;
    bytes.push(b'\n');
    atomic_write(root, &path, &bytes)?;
    read_snippets(root)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snippet(id: &str, prefix: &str) -> SqlSnippet {
        SqlSnippet {
            id: id.into(),
            prefix: prefix.into(),
            name: format!("Snippet {id}"),
            description: Some("  ".into()),
            body: "SELECT * FROM ${tabla};".into(),
        }
    }

    fn temp_root() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "pyro-snippets-{}-{}",
            std::process::id(),
            content_hash(format!("{:?}", std::time::Instant::now()).as_bytes())
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn saves_reads_and_detects_conflicts() {
        let root = temp_root();
        assert_eq!(read_snippets(&root).unwrap().snippets, vec![]);

        let saved = save_snippets(&root, &[snippet("snp-1", " sel ")], "").unwrap();
        assert_eq!(saved.snippets[0].prefix, "sel");
        assert_eq!(saved.snippets[0].description, None);
        assert_eq!(read_snippets(&root).unwrap(), saved);

        // A stale hash (someone else saved in between) is rejected.
        assert!(matches!(
            save_snippets(&root, &[], ""),
            Err(WorkspaceError::Conflict(_))
        ));
        let emptied = save_snippets(&root, &[], &saved.content_hash).unwrap();
        assert!(emptied.snippets.is_empty());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn rejects_invalid_snippets() {
        assert!(sanitize(&[snippet("../x", "a")]).is_err());
        assert!(sanitize(&[snippet("snp-1", "dos palabras")]).is_err());
        assert!(sanitize(&[snippet("snp-1", "a"), snippet("snp-1", "b")]).is_err());
        let mut empty = snippet("snp-2", "a");
        empty.body = "  ".into();
        assert!(sanitize(&[empty]).is_err());
    }
}
