//! Low-level, path-safe file operations on a workspace folder.
//!
//! Every resource path is built from validated identifiers joined to the workspace
//! root; nothing here accepts an arbitrary path coming from the frontend.

use super::error::{WorkspaceError, WsResult};
use super::models::*;
use serde_json::{Map, Value};
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

// ─── Identifiers ─────────────────────────────────────────────────────────────

/// Accepts stable ids such as `conn-1700000000-abc12`, `fav-preset-users` or a UUID.
/// Rejects separators, `..`, absolute paths, drive letters and control characters.
pub fn validate_id(id: &str) -> WsResult<()> {
    let ok = !id.is_empty()
        && id.len() <= 128
        && id != "."
        && id != ".."
        && !id.starts_with('.')
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.');
    if ok && !id.contains("..") {
        Ok(())
    } else {
        Err(WorkspaceError::InvalidId(
            id.chars().take(40).collect::<String>(),
        ))
    }
}

/// Random RFC 4122 v4 UUID from OS entropy.
pub fn new_uuid() -> WsResult<String> {
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).map_err(|_| WorkspaceError::Io("entropía no disponible".into()))?;
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    Ok(format!(
        "{}-{}-{}-{}-{}",
        &h[0..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..32]
    ))
}

/// FNV-1a 64-bit content fingerprint used only for change detection (not security).
pub fn content_hash(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in bytes {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}-{}", bytes.len())
}

/// Turns a free-form title/category into one portable path segment.
/// Keeps letters (incl. accents), digits, space, `-`, `_`; collapses the rest to `-`.
/// Avoids Windows reserved names and trailing dots/spaces.
pub fn sanitize_segment(input: &str, fallback: &str) -> String {
    let mut out = String::new();
    for c in input.trim().chars() {
        if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' {
            out.push(c);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let mut out: String = out
        .trim_matches(|c: char| c == '-' || c == ' ' || c == '.')
        .chars()
        .take(80)
        .collect();
    out = out.trim_end_matches([' ', '.']).to_string();
    const RESERVED: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if out.is_empty() || RESERVED.contains(&out.to_ascii_uppercase().as_str()) {
        return fallback.to_string();
    }
    out
}

// ─── Path containment ────────────────────────────────────────────────────────

/// Ensures `candidate` (which may not exist yet) resolves inside `root`.
/// Checks lexical components and, for the deepest existing ancestor, the canonical
/// path, so a symlinked directory cannot redirect writes outside the workspace.
pub fn ensure_within(root: &Path, candidate: &Path) -> WsResult<()> {
    let rel = candidate
        .strip_prefix(root)
        .map_err(|_| WorkspaceError::PathEscape)?;
    if rel.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(WorkspaceError::PathEscape);
    }
    let canon_root = root
        .canonicalize()
        .map_err(|_| WorkspaceError::Unavailable)?;
    let mut probe = candidate.to_path_buf();
    while !probe.exists() {
        if !probe.pop() {
            return Err(WorkspaceError::PathEscape);
        }
    }
    let canon = probe.canonicalize().map_err(WorkspaceError::from)?;
    if canon.starts_with(&canon_root) {
        Ok(())
    } else {
        Err(WorkspaceError::PathEscape)
    }
}

// ─── Atomic writes ───────────────────────────────────────────────────────────

/// Writes via a temp file in the same directory, fsyncs, then renames over the target.
/// On any failure the previous file is left untouched and the temp file is removed.
pub fn atomic_write(root: &Path, target: &Path, bytes: &[u8]) -> WsResult<()> {
    ensure_within(root, target)?;
    let dir = target.parent().ok_or(WorkspaceError::PathEscape)?;
    fs::create_dir_all(dir)?;
    ensure_within(root, dir)?;

    let file_name = target
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or(WorkspaceError::PathEscape)?;
    let suffix = new_uuid()?;
    let tmp = dir.join(format!(".{file_name}.{}.pyrotmp", &suffix[..8]));

    let result = (|| -> WsResult<()> {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        // Validate what actually landed on disk before replacing the original.
        if fs::read(&tmp)? != bytes {
            return Err(WorkspaceError::Io(
                "verificación de escritura fallida".into(),
            ));
        }
        fs::rename(&tmp, target)?;
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

// ─── Manifest ────────────────────────────────────────────────────────────────

pub fn manifest_path(root: &Path) -> PathBuf {
    root.join(MANIFEST_FILE)
}

/// Reads and validates `workspace.json`. Never rewrites it.
pub fn read_manifest(root: &Path) -> WsResult<WorkspaceManifest> {
    if !root.is_dir() {
        return Err(WorkspaceError::Unavailable);
    }
    let path = manifest_path(root);
    if !path.exists() {
        return Err(WorkspaceError::NotAWorkspace);
    }
    let bytes = fs::read(&path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            WorkspaceError::from(e)
        } else {
            WorkspaceError::Unavailable
        }
    })?;
    let raw: Value = serde_json::from_slice(&bytes).map_err(|e| {
        WorkspaceError::InvalidManifest(format!("JSON no válido (línea {})", e.line()))
    })?;
    let version = raw
        .get("formatVersion")
        .and_then(Value::as_u64)
        .ok_or_else(|| WorkspaceError::InvalidManifest("falta formatVersion".into()))?
        as u32;
    if version == 0 {
        return Err(WorkspaceError::InvalidManifest(
            "formatVersion inválido".into(),
        ));
    }
    if version > FORMAT_VERSION {
        return Err(WorkspaceError::IncompatibleVersion {
            found: version,
            supported: FORMAT_VERSION,
        });
    }
    let manifest: WorkspaceManifest =
        serde_json::from_value(raw).map_err(|e| WorkspaceError::InvalidManifest(e.to_string()))?;
    if manifest.workspace_id.trim().is_empty() {
        return Err(WorkspaceError::InvalidManifest("falta workspaceId".into()));
    }
    validate_id(&manifest.workspace_id)
        .map_err(|_| WorkspaceError::InvalidManifest("workspaceId inválido".into()))?;
    Ok(manifest)
}

pub fn write_manifest(root: &Path, manifest: &WorkspaceManifest) -> WsResult<()> {
    let bytes = serde_json::to_vec_pretty(manifest)?;
    atomic_write(root, &manifest_path(root), &bytes)
}

// ─── Connections ─────────────────────────────────────────────────────────────

/// Field names that are machine-local and must never be shared.
const LOCAL_ONLY_FIELDS: [&str; 1] = ["lastConnectedAt"];

/// Returns true for keys that may hold a secret value. Credential *references*
/// (`credentialId`, `tunnel_credential_id`, …) and file *paths* are allowed.
pub fn is_secret_key(key: &str) -> bool {
    let k: String = key
        .chars()
        .filter(|c| *c != '_' && *c != '-')
        .collect::<String>()
        .to_ascii_lowercase();
    if k.ends_with("credentialid") || k.ends_with("path") {
        return false;
    }
    [
        "password",
        "passwd",
        "passphrase",
        "token",
        "secret",
        "apikey",
        "privatekey",
    ]
    .iter()
    .any(|s| k.contains(s))
}

fn strip_secrets(value: &mut Value) {
    match value {
        Value::Object(map) => {
            map.retain(|k, _| !is_secret_key(k));
            for (k, v) in map.iter_mut() {
                if k.to_ascii_lowercase().ends_with("credentialid")
                    || k.to_ascii_lowercase().ends_with("credential_id")
                {
                    // Only keep logical, opaque references.
                    if let Some(s) = v.as_str() {
                        if validate_id(s).is_err() {
                            *v = Value::Null;
                        }
                    }
                } else {
                    strip_secrets(v);
                }
            }
            map.retain(|_, v| !v.is_null());
        }
        Value::Array(items) => items.iter_mut().for_each(strip_secrets),
        _ => {}
    }
}

/// Explicit safe serialization of a connection definition for the shared folder.
/// Keeps every non-secret field (TLS, SSH, HTTP tunnel options, unknown future fields)
/// and removes passwords, tokens, keys and machine-local state.
pub fn sanitize_connection(input: &Value) -> WsResult<Map<String, Value>> {
    let mut value = input.clone();
    let obj = value
        .as_object_mut()
        .ok_or_else(|| WorkspaceError::InvalidData("la conexión debe ser un objeto".into()))?;
    for f in LOCAL_ONLY_FIELDS {
        obj.remove(f);
    }
    strip_secrets(&mut value);
    let obj = value.as_object().cloned().unwrap_or_default();

    let id = obj
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| WorkspaceError::InvalidData("falta id de conexión".into()))?;
    validate_id(id)?;
    for field in ["name", "host", "user"] {
        if !obj.get(field).map(Value::is_string).unwrap_or(false) {
            return Err(WorkspaceError::InvalidData(format!(
                "falta el campo '{field}'"
            )));
        }
    }
    if !obj.get("port").map(Value::is_u64).unwrap_or(false) {
        return Err(WorkspaceError::InvalidData("puerto inválido".into()));
    }
    Ok(obj)
}

pub fn connection_path(root: &Path, id: &str) -> WsResult<PathBuf> {
    validate_id(id)?;
    Ok(root.join(CONNECTIONS_DIR).join(format!("{id}.json")))
}

pub fn connection_file_bytes(conn: &Map<String, Value>) -> WsResult<Vec<u8>> {
    let mut doc = Map::new();
    doc.insert("formatVersion".into(), Value::from(FORMAT_VERSION));
    doc.insert("connection".into(), Value::Object(conn.clone()));
    let mut bytes = serde_json::to_vec_pretty(&Value::Object(doc))?;
    bytes.push(b'\n');
    Ok(bytes)
}

pub fn parse_connection_file(bytes: &[u8]) -> WsResult<Value> {
    let doc: Value = serde_json::from_slice(bytes)?;
    let version = doc
        .get("formatVersion")
        .and_then(Value::as_u64)
        .ok_or_else(|| WorkspaceError::InvalidData("falta formatVersion".into()))?
        as u32;
    if version > FORMAT_VERSION {
        return Err(WorkspaceError::IncompatibleVersion {
            found: version,
            supported: FORMAT_VERSION,
        });
    }
    let conn = doc
        .get("connection")
        .ok_or_else(|| WorkspaceError::InvalidData("falta 'connection'".into()))?;
    // Re-sanitize on read: a hand-edited file must not smuggle secrets into the UI.
    Ok(Value::Object(sanitize_connection(conn)?))
}

pub fn list_connections(root: &Path) -> WsResult<ConnectionListing> {
    let dir = root.join(CONNECTIONS_DIR);
    let mut listing = ConnectionListing::default();
    if !dir.exists() {
        return Ok(listing);
    }
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let meta = fs::symlink_metadata(entry.path())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if !meta.is_file() || !name.ends_with(".json") || name.starts_with('.') {
            continue;
        }
        match fs::read(entry.path())
            .map_err(WorkspaceError::from)
            .and_then(|b| parse_connection_file(&b))
        {
            Ok(v) => {
                let stem = name.trim_end_matches(".json");
                if v.get("id").and_then(Value::as_str) == Some(stem) {
                    listing.connections.push(v);
                } else {
                    listing.errors.push(format!(
                        "{name}: el id no coincide con el nombre del archivo"
                    ));
                }
            }
            Err(e) => listing.errors.push(format!("{name}: {e}")),
        }
    }
    listing.connections.sort_by(|a, b| {
        let n = |v: &Value| {
            v.get("name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_lowercase()
        };
        n(a).cmp(&n(b))
    });
    Ok(listing)
}

pub fn save_connection(root: &Path, input: &Value) -> WsResult<Value> {
    let clean = sanitize_connection(input)?;
    let id = clean["id"].as_str().unwrap_or_default().to_string();
    let path = connection_path(root, &id)?;
    let bytes = connection_file_bytes(&clean)?;
    atomic_write(root, &path, &bytes)?;
    // Read back to confirm what is on disk before reporting success.
    parse_connection_file(&fs::read(&path)?)
}

pub fn delete_connection(root: &Path, id: &str) -> WsResult<()> {
    let path = connection_path(root, id)?;
    ensure_within(root, &path)?;
    if !path.exists() {
        return Err(WorkspaceError::NotFound(id.to_string()));
    }
    fs::remove_file(path)?;
    Ok(())
}
