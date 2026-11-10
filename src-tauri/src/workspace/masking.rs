//! Reusable data-masking profiles shared through the workspace, one file per
//! profile in `.pyro/masking/<id>.json`:
//!
//! ```json
//! { "formatVersion": 1,
//!   "profile": { "id": "msk-…", "name": "Clientes a desarrollo", "stableSeed": false,
//!                "rules": [ { "table": "clientes", "column": "email", "strategy": "email_synthetic" } ] } }
//! ```
//!
//! Profiles hold rules only. The masking seed never lives here: it is random per
//! export or, with `stableSeed`, kept encrypted in the Vault on each computer.
//! Writes are atomic and guarded by the content hash the client last read.

use super::error::{WorkspaceError, WsResult};
use super::models::FORMAT_VERSION;
use super::repository::{atomic_write, content_hash, validate_id};
use crate::db::masking::{MaskingRule, MaskingStrategy};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

pub const MASKING_DIR: &str = ".pyro/masking";
const MAX_PROFILES: usize = 500;
const MAX_RULES: usize = 5_000;
const MAX_LABEL: usize = 128;
const MAX_IDENT: usize = 256;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MaskingProfile {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Same masked output on every export (seed kept in the Vault).
    #[serde(default)]
    pub stable_seed: bool,
    #[serde(default)]
    pub rules: Vec<MaskingRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileFile {
    format_version: u32,
    profile: MaskingProfile,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MaskingProfileEntry {
    pub profile: MaskingProfile,
    /// Hash of the file as read; pass it back to save.
    pub content_hash: String,
}

fn dir(root: &Path) -> PathBuf {
    root.join(MASKING_DIR)
}

fn profile_path(root: &Path, id: &str) -> WsResult<PathBuf> {
    validate_id(id)?;
    Ok(dir(root).join(format!("{id}.json")))
}

fn valid_label(s: &str, max: usize) -> bool {
    let t = s.trim();
    !t.is_empty() && t.len() <= max && !t.chars().any(char::is_control)
}

/// Trims labels and rejects invalid names, oversized data and duplicate columns.
pub fn sanitize(p: &MaskingProfile) -> WsResult<MaskingProfile> {
    validate_id(&p.id)?;
    if !valid_label(&p.name, MAX_LABEL) {
        return Err(WorkspaceError::InvalidData(format!(
            "nombre no válido en el perfil de enmascaramiento {}",
            p.id
        )));
    }
    if p.rules.len() > MAX_RULES {
        return Err(WorkspaceError::InvalidData(
            "el perfil de enmascaramiento tiene demasiadas reglas".into(),
        ));
    }
    let mut seen = HashSet::new();
    let mut rules = Vec::with_capacity(p.rules.len());
    for r in &p.rules {
        if !valid_label(&r.table, MAX_IDENT) || !valid_label(&r.column, MAX_IDENT) {
            return Err(WorkspaceError::InvalidData(format!(
                "tabla o columna no válida en el perfil {}",
                p.id
            )));
        }
        let key = (
            r.table.trim().to_lowercase(),
            r.column.trim().to_lowercase(),
        );
        if !seen.insert(key) {
            return Err(WorkspaceError::InvalidData(format!(
                "regla duplicada para {}.{}",
                r.table.trim(),
                r.column.trim()
            )));
        }
        if r.strategy == MaskingStrategy::Keep {
            continue;
        }
        rules.push(MaskingRule {
            table: r.table.trim().to_string(),
            column: r.column.trim().to_string(),
            strategy: r.strategy,
            shift_days: r
                .shift_days
                .filter(|_| r.strategy == MaskingStrategy::DateShift),
            fixed_value: r
                .fixed_value
                .clone()
                .filter(|_| r.strategy == MaskingStrategy::Fixed),
        });
    }
    Ok(MaskingProfile {
        id: p.id.clone(),
        name: p.name.trim().to_string(),
        description: p
            .description
            .as_deref()
            .map(str::trim)
            .filter(|d| !d.is_empty())
            .map(str::to_string),
        stable_seed: p.stable_seed,
        rules,
    })
}

fn read_one(path: &Path) -> WsResult<MaskingProfileEntry> {
    let bytes = fs::read(path)?;
    let file: ProfileFile = serde_json::from_slice(&bytes)?;
    if file.format_version > FORMAT_VERSION {
        return Err(WorkspaceError::IncompatibleVersion {
            found: file.format_version,
            supported: FORMAT_VERSION,
        });
    }
    Ok(MaskingProfileEntry {
        profile: sanitize(&file.profile)?,
        content_hash: content_hash(&bytes),
    })
}

/// Every valid profile, sorted by name. Unreadable files are skipped so one bad
/// file does not hide the rest.
pub fn list_profiles(root: &Path) -> WsResult<Vec<MaskingProfileEntry>> {
    let d = dir(root);
    if !d.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&d)? {
        let path = entry?.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(p) = read_one(&path) {
            out.push(p);
        }
        if out.len() >= MAX_PROFILES {
            break;
        }
    }
    out.sort_by(|a, b| {
        a.profile
            .name
            .to_lowercase()
            .cmp(&b.profile.name.to_lowercase())
    });
    Ok(out)
}

/// Creates or replaces one profile. `expected_hash` must match the file on disk
/// (empty string = it must not exist yet), otherwise `Conflict` is returned.
pub fn save_profile(
    root: &Path,
    profile: &MaskingProfile,
    expected_hash: &str,
) -> WsResult<MaskingProfileEntry> {
    let clean = sanitize(profile)?;
    let path = profile_path(root, &clean.id)?;
    let current = if path.exists() {
        content_hash(&fs::read(&path)?)
    } else {
        String::new()
    };
    if current != expected_hash {
        return Err(WorkspaceError::Conflict(format!(
            "{MASKING_DIR}/{}.json",
            clean.id
        )));
    }
    let file = ProfileFile {
        format_version: FORMAT_VERSION,
        profile: clean,
    };
    let mut bytes = serde_json::to_vec_pretty(&file)?;
    bytes.push(b'\n');
    atomic_write(root, &path, &bytes)?;
    read_one(&path)
}

pub fn delete_profile(root: &Path, id: &str) -> WsResult<()> {
    let path = profile_path(root, id)?;
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "pyro-masking-{}-{}",
            std::process::id(),
            content_hash(format!("{:?}", std::time::Instant::now()).as_bytes())
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn profile(id: &str) -> MaskingProfile {
        MaskingProfile {
            id: id.into(),
            name: " Clientes ".into(),
            description: Some(" ".into()),
            stable_seed: false,
            rules: vec![
                MaskingRule {
                    table: "clientes".into(),
                    column: " email ".into(),
                    strategy: MaskingStrategy::EmailSynthetic,
                    shift_days: Some(10),
                    fixed_value: None,
                },
                MaskingRule {
                    table: "clientes".into(),
                    column: "id".into(),
                    strategy: MaskingStrategy::Keep,
                    shift_days: None,
                    fixed_value: None,
                },
            ],
        }
    }

    #[test]
    fn saves_lists_and_detects_conflicts() {
        let root = temp_root();
        assert!(list_profiles(&root).unwrap().is_empty());
        let saved = save_profile(&root, &profile("msk-1"), "").unwrap();
        assert_eq!(saved.profile.name, "Clientes");
        assert_eq!(saved.profile.description, None);
        assert_eq!(saved.profile.rules.len(), 1, "Keep rules are dropped");
        assert_eq!(saved.profile.rules[0].column, "email");
        assert_eq!(saved.profile.rules[0].shift_days, None);
        assert!(root.join(".pyro/masking/msk-1.json").exists());
        assert_eq!(list_profiles(&root).unwrap(), vec![saved.clone()]);

        assert!(matches!(
            save_profile(&root, &profile("msk-1"), ""),
            Err(WorkspaceError::Conflict(_))
        ));
        save_profile(&root, &profile("msk-1"), &saved.content_hash).unwrap();
        delete_profile(&root, "msk-1").unwrap();
        assert!(list_profiles(&root).unwrap().is_empty());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn rejects_invalid_profiles() {
        assert!(sanitize(&profile("../x")).is_err());
        let mut dup = profile("msk-2");
        dup.rules[1].column = "EMAIL".into();
        assert!(sanitize(&dup).is_err());
        let mut nameless = profile("msk-3");
        nameless.name = "  ".into();
        assert!(sanitize(&nameless).is_err());
    }

    #[test]
    fn profile_files_never_contain_a_seed() {
        let root = temp_root();
        let mut p = profile("msk-4");
        p.stable_seed = true;
        save_profile(&root, &p, "").unwrap();
        let text = fs::read_to_string(root.join(".pyro/masking/msk-4.json")).unwrap();
        assert!(text.contains("\"stableSeed\": true"));
        assert!(!text.to_lowercase().contains("seedvalue"));
        assert!(!text.contains("salt"));
        fs::remove_dir_all(&root).ok();
    }
}
