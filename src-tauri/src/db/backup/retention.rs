use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use super::manifest::BackupManifest;
use crate::db::error::PyroError;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RetentionPolicy {
    pub max_backups: Option<usize>,
    pub max_days: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RetentionResult {
    pub scanned_backups: usize,
    pub deleted_backups: usize,
    pub retained_backups: usize,
    pub protected_base_backups: usize,
    pub freed_bytes: u64,
    pub deleted_directories: Vec<String>,
}

struct DiscoveredBackup {
    backup_id: String,
    path: PathBuf,
    created_at: DateTime<Utc>,
    base_backup_id: Option<String>,
    size_bytes: u64,
}

/// Enforces the retention policy on a given backup root directory.
///
/// Scans all immediate subdirectories for `manifest.json`.
/// Backups referenced as base by a differential backup are strictly protected.
pub fn enforce_retention(
    target_dir: &Path,
    policy: &RetentionPolicy,
) -> Result<RetentionResult, PyroError> {
    if !target_dir.exists() || !target_dir.is_dir() {
        return Ok(RetentionResult {
            scanned_backups: 0,
            deleted_backups: 0,
            retained_backups: 0,
            protected_base_backups: 0,
            freed_bytes: 0,
            deleted_directories: Vec::new(),
        });
    }

    let mut discovered: Vec<DiscoveredBackup> = Vec::new();

    let entries = fs::read_dir(target_dir)
        .map_err(|e| PyroError::Io(format!("Error leyendo directorio de respaldos: {e}")))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let manifest_path = path.join("manifest.json");
        if !manifest_path.exists() {
            continue;
        }

        if let Ok(manifest_content) = fs::read_to_string(&manifest_path) {
            if let Ok(manifest) = serde_json::from_str::<BackupManifest>(&manifest_content) {
                let created_at = DateTime::parse_from_rfc3339(&manifest.created_at)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| {
                        entry
                            .metadata()
                            .and_then(|m| m.modified())
                            .map(DateTime::<Utc>::from)
                            .unwrap_or_else(|_| Utc::now())
                    });

                let size = compute_directory_size(&path);

                discovered.push(DiscoveredBackup {
                    backup_id: manifest.backup_id,
                    path,
                    created_at,
                    base_backup_id: manifest.base_backup_id,
                    size_bytes: size,
                });
            }
        }
    }

    let total_scanned = discovered.len();
    if total_scanned == 0 {
        return Ok(RetentionResult {
            scanned_backups: 0,
            deleted_backups: 0,
            retained_backups: 0,
            protected_base_backups: 0,
            freed_bytes: 0,
            deleted_directories: Vec::new(),
        });
    }

    // Identify active base backup IDs that are referenced by any differential backup
    let referenced_bases: HashSet<String> = discovered
        .iter()
        .filter_map(|b| b.base_backup_id.clone())
        .collect();

    // Sort newest first
    discovered.sort_by_key(|a| std::cmp::Reverse(a.created_at));

    let now = Utc::now();
    let mut deleted_dirs = Vec::new();
    let mut freed_bytes: u64 = 0;
    let mut protected_count = 0;
    let mut retained_count = 0;

    for (index, backup) in discovered.into_iter().enumerate() {
        let age_days = (now - backup.created_at).num_days();

        let exceeds_count = policy.max_backups.is_some_and(|m| index >= m);
        let exceeds_age = policy
            .max_days
            .is_some_and(|days| age_days > i64::from(days));

        let candidate_for_deletion = exceeds_count || exceeds_age;

        if candidate_for_deletion {
            // Check if protected as a base backup for a differential backup
            if referenced_bases.contains(&backup.backup_id) {
                protected_count += 1;
                retained_count += 1;
                tracing::info!(
                    "Respaldo base {} protegido de retención porque tiene respaldos diferenciales dependientes.",
                    backup.backup_id
                );
                continue;
            }

            // Safe to delete
            if let Ok(()) = fs::remove_dir_all(&backup.path) {
                freed_bytes += backup.size_bytes;
                deleted_dirs.push(backup.path.to_string_lossy().to_string());
            } else {
                retained_count += 1;
            }
        } else {
            retained_count += 1;
        }
    }

    Ok(RetentionResult {
        scanned_backups: total_scanned,
        deleted_backups: deleted_dirs.len(),
        retained_backups: retained_count,
        protected_base_backups: protected_count,
        freed_bytes,
        deleted_directories: deleted_dirs,
    })
}

fn compute_directory_size(path: &Path) -> u64 {
    let mut total = 0;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                total += entry.metadata().map(|m| m.len()).unwrap_or(0);
            } else if p.is_dir() {
                total += compute_directory_size(&p);
            }
        }
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::backup::manifest::{BackupType, CompressionFormat};

    #[test]
    fn test_retention_preserves_referenced_base_backups() {
        let temp_dir = tempfile::tempdir().unwrap();
        let root = temp_dir.path();

        // 1. Create base backup dir (old)
        let base_dir = root.join("backup-20260101-000000");
        fs::create_dir_all(&base_dir).unwrap();
        let mut base_manifest = BackupManifest::new(
            "base-123".to_string(),
            BackupType::Full,
            CompressionFormat::Zstd,
            "10.11.0".to_string(),
            "mydb".to_string(),
        );
        base_manifest.created_at = "2026-01-01T00:00:00Z".to_string();
        fs::write(
            base_dir.join("manifest.json"),
            serde_json::to_string(&base_manifest).unwrap(),
        )
        .unwrap();

        // 2. Create differential backup dir (newer) referencing base-123
        let diff_dir = root.join("backup-20260102-000000");
        fs::create_dir_all(&diff_dir).unwrap();
        let mut diff_manifest = BackupManifest::new(
            "diff-456".to_string(),
            BackupType::Differential,
            CompressionFormat::Zstd,
            "10.11.0".to_string(),
            "mydb".to_string(),
        );
        diff_manifest.created_at = "2026-01-02T00:00:00Z".to_string();
        diff_manifest.base_backup_id = Some("base-123".to_string());
        diff_manifest.base_backup_dir = Some(base_dir.to_string_lossy().to_string());
        fs::write(
            diff_dir.join("manifest.json"),
            serde_json::to_string(&diff_manifest).unwrap(),
        )
        .unwrap();

        // Policy: max 1 backup. Normally base_dir would be deleted because diff_dir is newer.
        // But base_dir is referenced by diff_dir, so it MUST be protected!
        let policy = RetentionPolicy {
            max_backups: Some(1),
            max_days: None,
        };

        let result = enforce_retention(root, &policy).unwrap();
        assert_eq!(result.scanned_backups, 2);
        assert_eq!(result.protected_base_backups, 1);
        assert_eq!(result.deleted_backups, 0);
        assert!(base_dir.exists(), "Base dir must remain untouched");
        assert!(diff_dir.exists(), "Diff dir must remain untouched");
    }
}
