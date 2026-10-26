//! Folders ("groups") for database objects — tables, views, functions, procedures —
//! stored per connection in `groups/<connection-id>.json`:
//!
//! ```json
//! { "formatVersion": 1,
//!   "databases": { "escuela": { "tables": { "reportes": ["alumnos", "notas"] } } } }
//! ```
//!
//! Object names are only references: a group never creates or drops anything in the
//! database. Writes are atomic and guarded by the content hash the client last read.

use super::error::{WorkspaceError, WsResult};
use super::models::FORMAT_VERSION;
use super::repository::{atomic_write, content_hash, validate_id};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

pub const GROUPS_DIR: &str = "groups";
const KINDS: [&str; 4] = ["tables", "views", "functions", "procedures"];
const MAX_NAME: usize = 128;
const MAX_ITEMS: usize = 20_000;

/// folder -> object names
pub type Folders = BTreeMap<String, Vec<String>>;
/// database -> kind -> folders
pub type DatabaseGroups = BTreeMap<String, BTreeMap<String, Folders>>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct GroupsFile {
    pub format_version: u32,
    #[serde(default)]
    pub databases: DatabaseGroups,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GroupsSnapshot {
    pub databases: DatabaseGroups,
    /// Hash of the file as read (empty when the file does not exist yet).
    pub content_hash: String,
}

fn groups_path(root: &Path, connection_id: &str) -> WsResult<PathBuf> {
    validate_id(connection_id)?;
    Ok(root.join(GROUPS_DIR).join(format!("{connection_id}.json")))
}

fn valid_name(s: &str) -> bool {
    let t = s.trim();
    !t.is_empty() && t.len() <= MAX_NAME && !t.chars().any(char::is_control)
}

/// Normalizes and validates client data: known kinds only, trimmed unique names,
/// an object in at most one folder per kind.
pub fn sanitize(input: &DatabaseGroups) -> WsResult<DatabaseGroups> {
    let mut out = DatabaseGroups::new();
    let mut total = 0usize;
    for (db, kinds) in input {
        if !valid_name(db) {
            return Err(WorkspaceError::InvalidData(
                "nombre de base de datos inválido".into(),
            ));
        }
        let mut kinds_out = BTreeMap::new();
        for (kind, folders) in kinds {
            if !KINDS.contains(&kind.as_str()) {
                return Err(WorkspaceError::InvalidData(format!(
                    "tipo de objeto desconocido: {kind}"
                )));
            }
            let mut seen = std::collections::HashSet::new();
            let mut folders_out = Folders::new();
            for (folder, items) in folders {
                if !valid_name(folder) {
                    return Err(WorkspaceError::InvalidData(
                        "nombre de carpeta inválido".into(),
                    ));
                }
                let mut list = Vec::new();
                for item in items {
                    let name = item.trim();
                    if !valid_name(name) {
                        return Err(WorkspaceError::InvalidData(
                            "nombre de objeto inválido".into(),
                        ));
                    }
                    if seen.insert(name.to_string()) {
                        list.push(name.to_string());
                    }
                }
                total += list.len();
                list.sort();
                folders_out.insert(folder.trim().to_string(), list);
            }
            if !folders_out.is_empty() {
                kinds_out.insert(kind.clone(), folders_out);
            }
        }
        if !kinds_out.is_empty() {
            out.insert(db.trim().to_string(), kinds_out);
        }
    }
    if total > MAX_ITEMS {
        return Err(WorkspaceError::InvalidData(
            "demasiados objetos agrupados".into(),
        ));
    }
    Ok(out)
}

pub fn read_groups(root: &Path, connection_id: &str) -> WsResult<GroupsSnapshot> {
    let path = groups_path(root, connection_id)?;
    if !path.exists() {
        return Ok(GroupsSnapshot {
            databases: DatabaseGroups::new(),
            content_hash: String::new(),
        });
    }
    let bytes = fs::read(&path)?;
    let file: GroupsFile = serde_json::from_slice(&bytes)?;
    if file.format_version > FORMAT_VERSION {
        return Err(WorkspaceError::IncompatibleVersion {
            found: file.format_version,
            supported: FORMAT_VERSION,
        });
    }
    Ok(GroupsSnapshot {
        databases: sanitize(&file.databases)?,
        content_hash: content_hash(&bytes),
    })
}

/// Replaces the groups of a connection. `expected_hash` must match what is on disk
/// (empty string = file must not exist), otherwise `Conflict` is returned untouched.
pub fn save_groups(
    root: &Path,
    connection_id: &str,
    databases: &DatabaseGroups,
    expected_hash: &str,
) -> WsResult<GroupsSnapshot> {
    let path = groups_path(root, connection_id)?;
    let current = if path.exists() {
        content_hash(&fs::read(&path)?)
    } else {
        String::new()
    };
    if current != expected_hash {
        return Err(WorkspaceError::Conflict(format!(
            "{GROUPS_DIR}/{connection_id}.json"
        )));
    }
    let file = GroupsFile {
        format_version: FORMAT_VERSION,
        databases: sanitize(databases)?,
    };
    let mut bytes = serde_json::to_vec_pretty(&file)?;
    bytes.push(b'\n');
    atomic_write(root, &path, &bytes)?;
    read_groups(root, connection_id)
}
