use super::error::PyroError;
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

static VAULT_LOCK: Mutex<()> = Mutex::new(());

const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;

/// Resolves the secure directory where PyroStudio stores encrypted secrets.
/// Works uniformly across Windows, Linux, and macOS without relying on
/// OS-specific daemons (such as GNOME Keyring / Secret Service / Windows Credential Manager).
fn get_vault_dir() -> PathBuf {
    let mut dir = if let Some(path) = dirs::data_local_dir() {
        path
    } else if let Some(path) = dirs::config_dir() {
        path
    } else {
        PathBuf::from(".pyro_vault")
    };

    dir.push("PyroStudio");
    dir.push("vault");
    dir
}

/// Sets restrictive POSIX permissions (0700 for directories, 0600 for files) on Unix.
fn set_restricted_permissions(_path: &Path, _is_dir: bool) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = if _is_dir { 0o700 } else { 0o600 };
        let _ = fs::set_permissions(_path, fs::Permissions::from_mode(mode));
    }
}

/// Fills a buffer with cryptographically secure random bytes from the OS entropy pool.
fn generate_random_bytes<const N: usize>() -> Result<[u8; N], PyroError> {
    let mut buf = [0u8; N];
    getrandom::fill(&mut buf)
        .map_err(|e| PyroError::Vault(format!("Error generando entropía aleatoria segura: {e}")))?;
    Ok(buf)
}

/// Retrieves or initializes the 256-bit AES master key stored in the user's private vault directory.
fn get_or_create_master_key() -> Result<[u8; KEY_LEN], PyroError> {
    let vault_dir = get_vault_dir();
    if !vault_dir.exists() {
        fs::create_dir_all(&vault_dir).map_err(|e| {
            PyroError::Vault(format!(
                "No se pudo crear el directorio del almacén seguro: {e}"
            ))
        })?;
        set_restricted_permissions(&vault_dir, true);
    }

    let key_path = vault_dir.join("master.key");
    if key_path.exists() {
        let key_bytes = fs::read(&key_path).map_err(|e| {
            PyroError::Vault(format!("Error al leer la clave maestra del almacén: {e}"))
        })?;
        if key_bytes.len() == KEY_LEN {
            let mut arr = [0u8; KEY_LEN];
            arr.copy_from_slice(&key_bytes);
            return Ok(arr);
        }
    }

    // Generate a new 256-bit cryptographically secure random key
    let new_key = generate_random_bytes::<KEY_LEN>()?;

    fs::write(&key_path, &new_key).map_err(|e| {
        PyroError::Vault(format!(
            "Error al guardar la clave maestra del almacén: {e}"
        ))
    })?;
    set_restricted_permissions(&key_path, false);

    Ok(new_key)
}

/// Reads and decrypts all credentials from the encrypted vault file.
fn load_vault_map(master_key: &[u8; KEY_LEN]) -> Result<HashMap<String, String>, PyroError> {
    let vault_path = get_vault_dir().join("secrets.vault");
    if !vault_path.exists() {
        return Ok(HashMap::new());
    }

    let encrypted_data = fs::read(&vault_path)
        .map_err(|e| PyroError::Vault(format!("Error leyendo el archivo del almacén: {e}")))?;

    if encrypted_data.len() < NONCE_LEN {
        return Ok(HashMap::new());
    }

    let (nonce_slice, ciphertext) = encrypted_data.split_at(NONCE_LEN);
    let nonce_arr: [u8; NONCE_LEN] = nonce_slice
        .try_into()
        .map_err(|_| PyroError::Vault("Longitud de nonce inválida en almacén".into()))?;

    let key = Key::<Aes256Gcm>::from(*master_key);
    let cipher = Aes256Gcm::new(&key);
    let nonce = Nonce::from(nonce_arr);

    let decrypted_bytes = cipher.decrypt(&nonce, ciphertext).map_err(|e| {
        PyroError::Vault(format!("Error descifrando el almacén de credenciales: {e}"))
    })?;

    let map: HashMap<String, String> = serde_json::from_slice(&decrypted_bytes).map_err(|e| {
        PyroError::Vault(format!(
            "Error analizando las credenciales del almacén: {e}"
        ))
    })?;

    Ok(map)
}

/// Encrypts and atomically writes the credentials map to the vault file.
fn save_vault_map(
    master_key: &[u8; KEY_LEN],
    map: &HashMap<String, String>,
) -> Result<(), PyroError> {
    let vault_dir = get_vault_dir();
    if !vault_dir.exists() {
        fs::create_dir_all(&vault_dir).map_err(|e| {
            PyroError::Vault(format!("Error creando el directorio del almacén: {e}"))
        })?;
        set_restricted_permissions(&vault_dir, true);
    }

    let json_bytes = serde_json::to_vec(map).map_err(|e| {
        PyroError::Vault(format!("Error serializando credenciales del almacén: {e}"))
    })?;

    let key = Key::<Aes256Gcm>::from(*master_key);
    let cipher = Aes256Gcm::new(&key);
    let nonce_bytes = generate_random_bytes::<NONCE_LEN>()?;
    let nonce = Nonce::from(nonce_bytes);

    let ciphertext = cipher
        .encrypt(&nonce, json_bytes.as_ref())
        .map_err(|e| PyroError::Vault(format!("Error cifrando el almacén con AES-256-GCM: {e}")))?;

    let mut payload = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    payload.extend_from_slice(&nonce_bytes);
    payload.extend_from_slice(&ciphertext);

    let final_path = vault_dir.join("secrets.vault");
    let tmp_path = vault_dir.join(format!("secrets.vault.{}.tmp", std::process::id()));

    fs::write(&tmp_path, &payload).map_err(|e| {
        PyroError::Vault(format!(
            "Error escribiendo archivo temporal del almacén: {e}"
        ))
    })?;
    set_restricted_permissions(&tmp_path, false);

    // Atomic replace
    if let Err(e) = fs::rename(&tmp_path, &final_path) {
        // Fallback for filesystems where rename cannot overwrite directly
        let _ = fs::remove_file(&final_path);
        fs::rename(&tmp_path, &final_path).map_err(|e2| {
            let _ = fs::remove_file(&tmp_path);
            PyroError::Vault(format!("Error actualizando el almacén seguro: {e} / {e2}"))
        })?;
    }
    set_restricted_permissions(&final_path, false);

    Ok(())
}

/// Securely stores a secret in the cross-platform encrypted vault (AES-256-GCM).
/// Works identically on Windows, Linux, and macOS without platform-specific daemons.
pub fn save_credential(credential_id: &str, secret: &str) -> Result<(), PyroError> {
    let id_trimmed = credential_id.trim();
    if id_trimmed.is_empty() {
        return Err(PyroError::InvalidOperation(
            "El ID de credencial no puede estar vacío.".into(),
        ));
    }

    let _lock = VAULT_LOCK.lock().map_err(|_| {
        PyroError::Vault("Error de bloqueo de concurrencia en almacén seguro".into())
    })?;

    let master_key = get_or_create_master_key()?;
    let mut map = load_vault_map(&master_key)?;
    map.insert(id_trimmed.to_string(), secret.to_string());
    save_vault_map(&master_key, &map)?;

    Ok(())
}

/// Retrieves a secret from the cross-platform encrypted vault.
/// Used strictly in Rust when establishing a connection; NEVER returned over IPC to React.
pub fn get_credential(credential_id: &str) -> Result<String, PyroError> {
    let id_trimmed = credential_id.trim();
    if id_trimmed.is_empty() {
        return Err(PyroError::InvalidOperation(
            "El ID de credencial no puede estar vacío.".into(),
        ));
    }

    let _lock = VAULT_LOCK.lock().map_err(|_| {
        PyroError::Vault("Error de bloqueo de concurrencia en almacén seguro".into())
    })?;

    let master_key = get_or_create_master_key()?;
    let map = load_vault_map(&master_key)?;

    map.get(id_trimmed).cloned().ok_or_else(|| {
        PyroError::Vault(format!(
            "No se encontró la credencial segura '{id_trimmed}' en el almacén cifrado."
        ))
    })
}

/// Deletes a secret from the cross-platform encrypted vault.
pub fn delete_credential(credential_id: &str) -> Result<(), PyroError> {
    let id_trimmed = credential_id.trim();
    if id_trimmed.is_empty() {
        return Ok(());
    }

    let _lock = VAULT_LOCK.lock().map_err(|_| {
        PyroError::Vault("Error de bloqueo de concurrencia en almacén seguro".into())
    })?;

    let master_key = get_or_create_master_key()?;
    let mut map = load_vault_map(&master_key)?;
    if map.remove(id_trimmed).is_some() {
        save_vault_map(&master_key, &map)?;
    }

    Ok(())
}

/// Checks whether a credential exists in the encrypted vault without exposing its secret.
pub fn has_credential(credential_id: &str) -> bool {
    let id_trimmed = credential_id.trim();
    if id_trimmed.is_empty() {
        return false;
    }

    let _lock = match VAULT_LOCK.lock() {
        Ok(guard) => guard,
        Err(_) => return false,
    };

    if let Ok(master_key) = get_or_create_master_key() {
        if let Ok(map) = load_vault_map(&master_key) {
            return map.contains_key(id_trimmed);
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_credential_id() {
        assert!(save_credential("", "secret").is_err());
        assert!(get_credential("").is_err());
        assert!(!has_credential(""));
        assert!(delete_credential("").is_ok());
    }

    #[test]
    fn test_vault_roundtrip() {
        let test_id = "test-pyrostudio-vault-roundtrip-unit";
        let test_secret = "SecurePassword@123_#$!áéíóú";

        // Save
        let save_res = save_credential(test_id, test_secret);
        assert!(save_res.is_ok(), "Failed to save: {:?}", save_res);

        // Check exists
        assert!(has_credential(test_id));

        // Get
        let retrieved = get_credential(test_id);
        assert!(retrieved.is_ok(), "Failed to get: {:?}", retrieved);
        assert_eq!(retrieved.unwrap(), test_secret);

        // Delete
        let del_res = delete_credential(test_id);
        assert!(del_res.is_ok(), "Failed to delete: {:?}", del_res);

        // Check no longer exists
        assert!(!has_credential(test_id));
        assert!(get_credential(test_id).is_err());
    }

    #[test]
    fn test_multiple_credentials_isolation() {
        let id1 = "test-cred-1";
        let id2 = "test-cred-2";
        let s1 = "pwd-1";
        let s2 = "pwd-2";

        save_credential(id1, s1).unwrap();
        save_credential(id2, s2).unwrap();

        assert_eq!(get_credential(id1).unwrap(), s1);
        assert_eq!(get_credential(id2).unwrap(), s2);

        delete_credential(id1).unwrap();
        assert!(!has_credential(id1));
        assert_eq!(get_credential(id2).unwrap(), s2);

        delete_credential(id2).unwrap();
        assert!(!has_credential(id2));
    }
}
