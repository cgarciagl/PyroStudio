//! Environment variables shared through the workspace, stored in
//! `variables/variables.json`:
//!
//! ```json
//! { "formatVersion": 1,
//!   "environments": { "dev": { "schema": "tienda_dev" }, "prod": { "schema": "tienda" } } }
//! ```
//!
//! `${schema}` in a query is replaced by the value of the active environment
//! when it runs. The active environment is chosen per computer (not stored
//! here). Values are plain configuration: never passwords or tokens.
//! Writes are atomic and guarded by the content hash the client last read.

use super::error::{WorkspaceError, WsResult};
use super::models::FORMAT_VERSION;
use super::repository::{atomic_write, content_hash};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

pub const VARIABLES_DIR: &str = "variables";
const VARIABLES_FILE: &str = "variables.json";
const MAX_ENVIRONMENTS: usize = 50;
const MAX_VARIABLES: usize = 500;
const MAX_NAME: usize = 64;
const MAX_VALUE: usize = 4_096;

/// environment -> variable -> value
pub type Environments = BTreeMap<String, BTreeMap<String, String>>;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct VariablesFile {
    format_version: u32,
    #[serde(default)]
    environments: Environments,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VariablesSnapshot {
    pub environments: Environments,
    /// Hash of the file as read (empty when the file does not exist yet).
    pub content_hash: String,
}

fn variables_path(root: &Path) -> PathBuf {
    root.join(VARIABLES_DIR).join(VARIABLES_FILE)
}

fn invalid(message: String) -> WorkspaceError {
    WorkspaceError::InvalidData(message)
}

/// Environment names: free text. Variable names: identifiers usable in `${…}`.
pub fn sanitize(input: &Environments) -> WsResult<Environments> {
    if input.len() > MAX_ENVIRONMENTS {
        return Err(invalid("demasiados entornos".into()));
    }
    let mut out = Environments::new();
    for (env, vars) in input {
        let env = env.trim();
        if env.is_empty() || env.len() > MAX_NAME || env.chars().any(char::is_control) {
            return Err(invalid("nombre de entorno inválido".into()));
        }
        if vars.len() > MAX_VARIABLES {
            return Err(invalid(format!("demasiadas variables en «{env}»")));
        }
        let mut vars_out = BTreeMap::new();
        for (name, value) in vars {
            let name = name.trim();
            let valid = !name.is_empty()
                && name.len() <= MAX_NAME
                && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
                && !name.starts_with(|c: char| c.is_ascii_digit());
            if !valid {
                return Err(invalid(format!("nombre de variable inválido: «{name}»")));
            }
            if value.len() > MAX_VALUE {
                return Err(invalid(format!("valor demasiado largo en «{name}»")));
            }
            vars_out.insert(name.to_string(), value.clone());
        }
        out.insert(env.to_string(), vars_out);
    }
    Ok(out)
}

pub fn read_variables(root: &Path) -> WsResult<VariablesSnapshot> {
    let path = variables_path(root);
    if !path.exists() {
        return Ok(VariablesSnapshot {
            environments: Environments::new(),
            content_hash: String::new(),
        });
    }
    let bytes = fs::read(&path)?;
    let file: VariablesFile = serde_json::from_slice(&bytes)?;
    if file.format_version > FORMAT_VERSION {
        return Err(WorkspaceError::IncompatibleVersion {
            found: file.format_version,
            supported: FORMAT_VERSION,
        });
    }
    Ok(VariablesSnapshot {
        environments: sanitize(&file.environments)?,
        content_hash: content_hash(&bytes),
    })
}

/// Replaces every environment. `expected_hash` must match what is on disk
/// (empty string = file must not exist), otherwise `Conflict` is returned.
pub fn save_variables(
    root: &Path,
    environments: &Environments,
    expected_hash: &str,
) -> WsResult<VariablesSnapshot> {
    let path = variables_path(root);
    let current = if path.exists() {
        content_hash(&fs::read(&path)?)
    } else {
        String::new()
    };
    if current != expected_hash {
        return Err(WorkspaceError::Conflict(format!(
            "{VARIABLES_DIR}/{VARIABLES_FILE}"
        )));
    }
    let file = VariablesFile {
        format_version: FORMAT_VERSION,
        environments: sanitize(environments)?,
    };
    let mut bytes = serde_json::to_vec_pretty(&file)?;
    bytes.push(b'\n');
    atomic_write(root, &path, &bytes)?;
    read_variables(root)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn envs(pairs: &[(&str, &str, &str)]) -> Environments {
        let mut out = Environments::new();
        for (env, name, value) in pairs {
            out.entry(env.to_string())
                .or_default()
                .insert(name.to_string(), value.to_string());
        }
        out
    }

    #[test]
    fn validates_variable_names() {
        assert!(sanitize(&envs(&[("dev", "schema_1", "x")])).is_ok());
        for bad in ["", "1abc", "a-b", "a b", "${x}"] {
            assert!(sanitize(&envs(&[("dev", bad, "x")])).is_err(), "{bad}");
        }
        assert!(sanitize(&envs(&[(" ", "a", "x")])).is_err());
    }

    #[test]
    fn saves_with_conflict_guard() {
        let root = std::env::temp_dir().join(format!(
            "pyro_vars_{}_{}",
            std::process::id(),
            super::super::repository::new_uuid().unwrap()
        ));
        fs::create_dir_all(&root).unwrap();
        let first = save_variables(&root, &envs(&[("dev", "schema", "t_dev")]), "").unwrap();
        assert_eq!(first.environments["dev"]["schema"], "t_dev");
        assert!(matches!(
            save_variables(&root, &Environments::new(), ""),
            Err(WorkspaceError::Conflict(_))
        ));
        let second = save_variables(
            &root,
            &envs(&[("prod", "schema", "t")]),
            &first.content_hash,
        )
        .unwrap();
        assert_eq!(read_variables(&root).unwrap(), second);
        fs::remove_dir_all(&root).ok();
    }
}
