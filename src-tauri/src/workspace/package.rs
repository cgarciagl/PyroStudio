//! Portable workspace package (`.pyrows`): a gzip-compressed JSON document with
//! the shareable files of a workspace (manifest, connections, queries, groups,
//! snippets). Secrets never reach it: connections go through
//! `repository::sanitize_connection` both when packing and when unpacking, and
//! the audit log (`.pyro/`) and machine-local files are left out.

use super::error::{WorkspaceError, WsResult};
use super::models::MANIFEST_FILE;
use super::repository;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

const PACKAGE_FORMAT: &str = "pyrows";
const PACKAGE_VERSION: u32 = 1;
/// Top-level entries copied into the package; anything else is ignored.
const SHARED_DIRS: [&str; 5] = ["connections", "queries", "groups", "snippets", "variables"];
/// Generous per-file and total limits against corrupt or hostile packages.
const MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;
const MAX_PACKAGE_BYTES: u64 = 200 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
struct Package {
    format: String,
    version: u32,
    /// Relative path (always `/`-separated) → UTF-8 file contents.
    files: BTreeMap<String, String>,
}

/// Packs the workspace at `root` into `target`; returns the number of files.
pub fn export_package(root: &Path, target: &Path) -> WsResult<usize> {
    repository::read_manifest(root)?;
    let mut files = BTreeMap::new();
    let manifest = fs::read_to_string(repository::manifest_path(root))?;
    files.insert(MANIFEST_FILE.to_string(), manifest);
    for dir in SHARED_DIRS {
        collect(root, &root.join(dir), &mut files)?;
    }
    for (path, text) in files.iter_mut() {
        if path.starts_with("connections/") {
            *text = sanitized_connection(text)?;
        }
    }
    let package = Package {
        format: PACKAGE_FORMAT.into(),
        version: PACKAGE_VERSION,
        files,
    };
    let count = package.files.len();
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    serde_json::to_writer(&mut encoder, &package)?;
    let bytes = encoder.finish()?;
    let partial = target.with_extension("pyrows.partial");
    fs::write(&partial, bytes)?;
    fs::rename(&partial, target).inspect_err(|_| {
        let _ = fs::remove_file(&partial);
    })?;
    Ok(count)
}

/// Unpacks `package` into `folder`, which must not already hold a workspace.
/// The copy gets a new workspace id so it never clashes with the original.
pub fn import_package(package: &Path, folder: &Path) -> WsResult<usize> {
    if repository::manifest_path(folder).exists() {
        return Err(WorkspaceError::AlreadyExists);
    }
    let file = fs::File::open(package)?;
    let mut json = Vec::new();
    flate2::read::GzDecoder::new(file)
        .take(MAX_PACKAGE_BYTES + 1)
        .read_to_end(&mut json)
        .map_err(|_| invalid("el archivo no es un paquete .pyrows"))?;
    if json.len() as u64 > MAX_PACKAGE_BYTES {
        return Err(invalid("el paquete es demasiado grande"));
    }
    let package: Package = serde_json::from_slice(&json)
        .map_err(|_| invalid("el contenido del paquete no es válido"))?;
    if package.format != PACKAGE_FORMAT {
        return Err(invalid("el archivo no es un paquete .pyrows"));
    }
    if package.version > PACKAGE_VERSION {
        return Err(invalid(
            "el paquete se creó con una versión más nueva de PyroStudio",
        ));
    }

    let manifest_text = package
        .files
        .get(MANIFEST_FILE)
        .ok_or_else(|| invalid("falta workspace.json"))?;
    let mut manifest: Value =
        serde_json::from_str(manifest_text).map_err(|_| invalid("workspace.json no válido"))?;
    let obj = manifest
        .as_object_mut()
        .ok_or_else(|| invalid("workspace.json no válido"))?;
    obj.insert("workspaceId".into(), Value::String(repository::new_uuid()?));

    // Validate everything before writing anything.
    let mut writes: Vec<(PathBuf, String)> = Vec::new();
    for (rel, text) in &package.files {
        if rel == MANIFEST_FILE {
            continue;
        }
        if text.len() as u64 > MAX_FILE_BYTES {
            return Err(invalid(&format!("archivo demasiado grande: {rel}")));
        }
        let path = safe_relative(rel)?;
        let text = if rel.starts_with("connections/") {
            sanitized_connection(text)?
        } else {
            text.clone()
        };
        writes.push((path, text));
    }

    fs::create_dir_all(folder)?;
    for (rel, text) in &writes {
        repository::atomic_write(folder, &folder.join(rel), text.as_bytes())?;
    }
    // The manifest goes last: a folder without it is not a workspace, so an
    // interrupted import never leaves a half-filled workspace behind.
    let bytes = serde_json::to_vec_pretty(&manifest)?;
    repository::atomic_write(folder, &repository::manifest_path(folder), &bytes)?;
    repository::read_manifest(folder)?;
    Ok(writes.len() + 1)
}

fn invalid(message: &str) -> WorkspaceError {
    WorkspaceError::InvalidData(message.to_string())
}

fn sanitized_connection(text: &str) -> WsResult<String> {
    let value: Value =
        serde_json::from_str(text).map_err(|_| invalid("conexión con JSON no válido"))?;
    let clean = repository::sanitize_connection(&value)?;
    Ok(serde_json::to_string_pretty(&Value::Object(clean))?)
}

/// Accepts only `dir/…/file` paths inside the shared folders, without `..`,
/// absolute parts or hidden names.
fn safe_relative(rel: &str) -> WsResult<PathBuf> {
    let path = Path::new(rel);
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => {
                let part = part.to_str().ok_or(WorkspaceError::PathEscape)?;
                if part.starts_with('.') {
                    return Err(WorkspaceError::PathEscape);
                }
                parts.push(part);
            }
            _ => return Err(WorkspaceError::PathEscape),
        }
    }
    if parts.len() < 2 || !SHARED_DIRS.contains(&parts[0]) {
        return Err(WorkspaceError::PathEscape);
    }
    Ok(parts.iter().collect())
}

/// Adds every visible UTF-8 file under `dir` to `files`, keyed by its path relative to `root`.
fn collect(root: &Path, dir: &Path, files: &mut BTreeMap<String, String>) -> WsResult<()> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Ok(()); // Optional folders (groups, snippets) may not exist.
    };
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue; // Temp files and hidden folders.
        }
        let path = entry.path();
        let kind = entry.file_type()?;
        if kind.is_dir() {
            collect(root, &path, files)?;
        } else if kind.is_file() && entry.metadata()?.len() <= MAX_FILE_BYTES {
            let Ok(text) = fs::read_to_string(&path) else {
                continue;
            };
            let rel = path
                .strip_prefix(root)
                .map_err(|_| WorkspaceError::PathEscape)?
                .components()
                .map(|c| c.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            files.insert(rel, text);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "pyro_pkg_{tag}_{}_{}",
            std::process::id(),
            repository::new_uuid().unwrap()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn round_trip_strips_secrets_and_local_files() {
        let src = temp_dir("src");
        fs::write(
            src.join("workspace.json"),
            r#"{"formatVersion":1,"workspaceId":"ws-1","name":"Equipo","createdAt":"2026-01-01"}"#,
        )
        .unwrap();
        fs::create_dir_all(src.join("connections")).unwrap();
        fs::write(
            src.join("connections/c1.json"),
            r#"{"id":"c1","name":"Prod","host":"db","port":3306,"user":"app","password":"x","lastConnectedAt":"hoy"}"#,
        )
        .unwrap();
        fs::create_dir_all(src.join("queries/ventas")).unwrap();
        fs::write(src.join("queries/ventas/total.sql"), "SELECT 1;").unwrap();
        fs::create_dir_all(src.join(".pyro/audit")).unwrap();
        fs::write(src.join(".pyro/audit/log.jsonl"), "secreto").unwrap();
        fs::write(src.join("workspace.local.json"), "{}").unwrap();

        let pkg = src.join("equipo.pyrows");
        assert_eq!(export_package(&src, &pkg).unwrap(), 3);

        let dst = temp_dir("dst");
        assert_eq!(import_package(&pkg, &dst).unwrap(), 3);
        let conn = fs::read_to_string(dst.join("connections/c1.json")).unwrap();
        assert!(!conn.contains("password") && !conn.contains("lastConnectedAt"));
        assert_eq!(
            fs::read_to_string(dst.join("queries/ventas/total.sql")).unwrap(),
            "SELECT 1;"
        );
        assert!(!dst.join(".pyro").exists());
        let manifest = repository::read_manifest(&dst).unwrap();
        assert_ne!(manifest.workspace_id, "ws-1");
        assert_eq!(manifest.name, "Equipo");

        // A folder that already holds a workspace is refused.
        assert!(matches!(
            import_package(&pkg, &dst),
            Err(WorkspaceError::AlreadyExists)
        ));
        fs::remove_dir_all(&src).ok();
        fs::remove_dir_all(&dst).ok();
    }

    #[test]
    fn rejects_paths_outside_shared_folders() {
        assert!(safe_relative("queries/a/b.sql").is_ok());
        for bad in [
            "../x.sql",
            "queries/../../x",
            "/etc/passwd",
            ".pyro/audit/x",
            "otros/x.json",
            "queries/.oculto.sql",
            "queries",
        ] {
            assert!(safe_relative(bad).is_err(), "{bad}");
        }
    }
}
