//! Least-privilege gate for commands that read or write user files.
//!
//! File paths may only come from a native dialog shown by Rust in this session.
//! Each dialog result is recorded here, and commands that receive a path from the
//! webview (Excel import/export, SQL dump/restore) refuse anything not granted.
//! This keeps a compromised or buggy frontend from turning those commands into
//! arbitrary file read/write primitives.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

static GRANTS: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);

fn normalize(path: &Path) -> PathBuf {
    // The file may not exist yet (save dialogs): canonicalize the parent instead.
    if let Ok(c) = path.canonicalize() {
        return c;
    }
    match (path.parent(), path.file_name()) {
        (Some(parent), Some(name)) => parent
            .canonicalize()
            .map(|p| p.join(name))
            .unwrap_or_else(|_| path.to_path_buf()),
        _ => path.to_path_buf(),
    }
}

/// Records a path chosen by the user in a native dialog and returns it as a string.
pub fn grant(path: &Path) -> String {
    if let Ok(mut guard) = GRANTS.lock() {
        guard
            .get_or_insert_with(HashSet::new)
            .insert(normalize(path));
    }
    path.to_string_lossy().to_string()
}

/// Ok only if `path` was previously returned by a native dialog in this session.
pub fn require(path: &str) -> Result<(), String> {
    let wanted = normalize(Path::new(path));
    let allowed = GRANTS
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|set| set.contains(&wanted)))
        .unwrap_or(false);
    if allowed {
        Ok(())
    } else {
        Err(
            "Ruta de archivo no autorizada: seleccione el archivo con el diálogo de PyroStudio."
                .into(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_granted_paths_are_allowed() {
        let dir = std::env::temp_dir();
        let chosen = dir.join("pyro-grant-test-chosen.xlsx");
        assert!(require(&chosen.to_string_lossy()).is_err());
        grant(&chosen);
        assert!(require(&chosen.to_string_lossy()).is_ok());
        assert!(require(&dir.join("pyro-grant-test-other.xlsx").to_string_lossy()).is_err());
        let sneaky = dir
            .join("sub")
            .join("..")
            .join("pyro-grant-test-other.xlsx");
        assert!(require(&sneaky.to_string_lossy()).is_err());
    }
}
