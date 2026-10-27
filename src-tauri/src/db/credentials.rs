//! Encrypted credential vault (AES-256-GCM).
//!
//! Secrets live in `secrets.vault`. The 256-bit master key that encrypts it is
//! kept in the OS keychain (Windows Credential Manager, macOS Keychain, Secret
//! Service on Linux), never next to the vault. Legacy installs with a
//! `master.key` file are migrated transparently: the key is copied to the
//! keychain, verified against the vault, and only then the file is wiped.
//!
//! If no keychain is available (e.g. Linux without Secret Service) the key falls
//! back to `master.key` with 0600 permissions, and `vault_status` reports it so
//! the UI can warn the user instead of degrading silently.

use super::error::PyroError;
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;
const KEY_FILE: &str = "master.key";
const VAULT_FILE: &str = "secrets.vault";
const KEYRING_SERVICE: &str = "PyroStudio";
const KEYRING_ACCOUNT: &str = "vault-master-key";

type MasterKey = [u8; KEY_LEN];

/// Where the master key is stored. Reported to the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case", tag = "storage")]
pub enum KeyStorage {
    /// Master key in the OS keychain (expected state).
    Keychain,
    /// No keychain available: master key in `master.key` next to the vault.
    FileFallback { reason: String },
}

/// Abstraction over the OS keychain so it can be replaced in tests.
pub trait KeyStore: Send + Sync {
    /// Returns the stored key, `Ok(None)` if there is none, or `Err` if the
    /// keychain itself is unavailable.
    fn get(&self) -> Result<Option<MasterKey>, String>;
    fn set(&self, key: &MasterKey) -> Result<(), String>;
}

/// Keychain backed by the `keyring` crate.
pub struct OsKeyStore;

impl OsKeyStore {
    fn entry() -> Result<keyring::Entry, String> {
        keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|e| e.to_string())
    }
}

impl KeyStore for OsKeyStore {
    fn get(&self) -> Result<Option<MasterKey>, String> {
        match Self::entry()?.get_secret() {
            Ok(bytes) => MasterKey::try_from(bytes.as_slice())
                .map(Some)
                .map_err(|_| "la clave del llavero tiene una longitud inválida".to_string()),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    fn set(&self, key: &MasterKey) -> Result<(), String> {
        Self::entry()?.set_secret(key).map_err(|e| e.to_string())
    }
}

/// An encrypted vault rooted at `dir` whose master key is held by `key_store`.
pub struct Vault {
    dir: PathBuf,
    key_store: Box<dyn KeyStore>,
    /// Serializes access and caches the resolved key for this process.
    state: Mutex<Option<(MasterKey, KeyStorage)>>,
}

impl Vault {
    pub fn new(dir: PathBuf, key_store: Box<dyn KeyStore>) -> Self {
        Self {
            dir,
            key_store,
            state: Mutex::new(None),
        }
    }

    fn key_path(&self) -> PathBuf {
        self.dir.join(KEY_FILE)
    }

    fn vault_path(&self) -> PathBuf {
        self.dir.join(VAULT_FILE)
    }

    /// Runs `f` with the master key, resolving (and migrating) it on first use.
    fn with_key<T>(
        &self,
        f: impl FnOnce(&Path, &MasterKey) -> Result<T, PyroError>,
    ) -> Result<T, PyroError> {
        let mut state = self.state.lock().map_err(|_| {
            PyroError::Vault("Error de bloqueo de concurrencia en almacén seguro".into())
        })?;
        if state.is_none() {
            *state = Some(self.resolve_master_key()?);
        }
        let (key, _) = state
            .as_ref()
            .ok_or_else(|| PyroError::Vault("Clave maestra no disponible".into()))?;
        f(&self.vault_path(), key)
    }

    /// Reports where the master key is stored.
    pub fn status(&self) -> Result<KeyStorage, PyroError> {
        self.with_key(|_, _| Ok(()))?;
        let state = self.state.lock().map_err(|_| {
            PyroError::Vault("Error de bloqueo de concurrencia en almacén seguro".into())
        })?;
        state
            .as_ref()
            .map(|(_, storage)| storage.clone())
            .ok_or_else(|| PyroError::Vault("Clave maestra no disponible".into()))
    }

    /// Finds the master key, migrating a legacy `master.key` into the keychain.
    ///
    /// Never generates a new key while `secrets.vault` exists: that would make
    /// the stored credentials permanently undecryptable.
    fn resolve_master_key(&self) -> Result<(MasterKey, KeyStorage), PyroError> {
        let vault_path = self.vault_path();
        let key_path = self.key_path();
        let vault_exists = vault_path.exists();
        let file_key = read_key_file(&key_path, vault_exists)?;
        let decrypts = |key: &MasterKey| !vault_exists || load_vault_map(&vault_path, key).is_ok();

        let stored = match self.key_store.get() {
            Ok(stored) => stored,
            Err(reason) => {
                // No keychain: keep (or create) the key file and report it.
                let storage = KeyStorage::FileFallback {
                    reason: format!("llavero del sistema no disponible: {reason}"),
                };
                if let Some(key) = file_key {
                    return Ok((key, storage));
                }
                if vault_exists {
                    return Err(missing_key_error());
                }
                let key = generate_random_bytes::<KEY_LEN>()?;
                write_key_file(&self.dir, &key)?;
                return Ok((key, storage));
            }
        };

        if let Some(key) = stored.filter(|key| decrypts(key)) {
            if file_key.is_some() {
                // Leftover from an interrupted migration
                wipe_file(&key_path)?;
            }
            return Ok((key, KeyStorage::Keychain));
        }

        if let Some(key) = file_key {
            if !decrypts(&key) {
                return Err(PyroError::Vault(
                    "La clave de 'master.key' no descifra el almacén de credenciales. No se ha \
                     migrado al llavero del sistema ni se ha modificado ningún archivo."
                        .into(),
                ));
            }
            return Ok(self.store_in_keychain(key, Some(&key_path)));
        }

        if stored.is_some() {
            return Err(PyroError::Vault(
                "La clave maestra del llavero del sistema no descifra el almacén de credenciales. \
                 No se ha modificado ningún archivo."
                    .into(),
            ));
        }
        if vault_exists {
            return Err(missing_key_error());
        }

        let key = generate_random_bytes::<KEY_LEN>()?;
        let (key, storage) = self.store_in_keychain(key, None);
        if storage != KeyStorage::Keychain {
            write_key_file(&self.dir, &key)?;
        }
        Ok((key, storage))
    }

    /// Saves `key` in the keychain and verifies it can be read back. Only then
    /// wipes `legacy_file`; otherwise the key stays (or must be kept) on disk.
    fn store_in_keychain(
        &self,
        key: MasterKey,
        legacy_file: Option<&Path>,
    ) -> (MasterKey, KeyStorage) {
        let verified = self
            .key_store
            .set(&key)
            .and_then(|_| self.key_store.get())
            .and_then(|read_back| {
                (read_back == Some(key))
                    .then_some(())
                    .ok_or_else(|| "la clave leída del llavero no coincide".to_string())
            });
        match verified {
            Ok(()) => {
                if let Some(path) = legacy_file {
                    if let Err(e) = wipe_file(path) {
                        return (
                            key,
                            KeyStorage::FileFallback {
                                reason: format!(
                                    "no se pudo borrar 'master.key' tras migrarla: {e}"
                                ),
                            },
                        );
                    }
                }
                (key, KeyStorage::Keychain)
            }
            Err(reason) => (
                key,
                KeyStorage::FileFallback {
                    reason: format!(
                        "no se pudo guardar la clave en el llavero del sistema: {reason}"
                    ),
                },
            ),
        }
    }

    pub fn save(&self, credential_id: &str, secret: &str) -> Result<(), PyroError> {
        let id = non_empty_id(credential_id)?;
        self.with_key(|path, key| {
            let mut map = load_vault_map(path, key)?;
            map.insert(id.to_string(), secret.to_string());
            save_vault_map(path, key, &map)
        })
    }

    pub fn get(&self, credential_id: &str) -> Result<String, PyroError> {
        let id = non_empty_id(credential_id)?;
        self.with_key(|path, key| {
            load_vault_map(path, key)?.remove(id).ok_or_else(|| {
                PyroError::Vault(format!(
                    "No se encontró la credencial segura '{id}' en el almacén cifrado."
                ))
            })
        })
    }

    pub fn delete(&self, credential_id: &str) -> Result<(), PyroError> {
        let id = credential_id.trim();
        if id.is_empty() {
            return Ok(());
        }
        self.with_key(|path, key| {
            let mut map = load_vault_map(path, key)?;
            if map.remove(id).is_some() {
                save_vault_map(path, key, &map)?;
            }
            Ok(())
        })
    }

    pub fn contains(&self, credential_id: &str) -> bool {
        let id = credential_id.trim();
        !id.is_empty()
            && self
                .with_key(|path, key| Ok(load_vault_map(path, key)?.contains_key(id)))
                .unwrap_or(false)
    }
}

fn non_empty_id(credential_id: &str) -> Result<&str, PyroError> {
    let id = credential_id.trim();
    if id.is_empty() {
        return Err(PyroError::InvalidOperation(
            "El ID de credencial no puede estar vacío.".into(),
        ));
    }
    Ok(id)
}

fn missing_key_error() -> PyroError {
    PyroError::Vault(
        "Existe un almacén de credenciales pero no se encuentra su clave maestra (ni en el llavero \
         del sistema ni en 'master.key'). No se ha generado una clave nueva para no perder las \
         credenciales cifradas. Restaure la clave, o mueva 'secrets.vault' fuera de la carpeta del \
         almacén para empezar con uno vacío y volver a introducir las contraseñas."
            .into(),
    )
}

/// Reads a legacy `master.key`. A file with an invalid length is an error while a
/// vault exists (anti-regeneration); otherwise it is moved aside for manual recovery.
fn read_key_file(key_path: &Path, vault_exists: bool) -> Result<Option<MasterKey>, PyroError> {
    if !key_path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(key_path).map_err(|e| {
        PyroError::Vault(format!("Error al leer la clave maestra del almacén: {e}"))
    })?;
    if let Ok(key) = MasterKey::try_from(bytes.as_slice()) {
        return Ok(Some(key));
    }
    if vault_exists {
        return Err(PyroError::Vault(
            "La clave maestra del almacén está dañada (longitud inválida). No se ha regenerado \
             para no perder las credenciales cifradas. Restaure 'master.key' desde una copia \
             de seguridad, o mueva 'master.key' y 'secrets.vault' fuera de la carpeta del \
             almacén para empezar con uno vacío y volver a introducir las contraseñas."
                .into(),
        ));
    }
    let backup = key_path.with_file_name(format!(
        "{KEY_FILE}.invalid-{}",
        chrono::Utc::now().timestamp()
    ));
    let _ = fs::rename(key_path, backup);
    Ok(None)
}

fn write_key_file(dir: &Path, key: &MasterKey) -> Result<(), PyroError> {
    ensure_dir(dir)?;
    let key_path = dir.join(KEY_FILE);
    fs::write(&key_path, key).map_err(|e| {
        PyroError::Vault(format!(
            "Error al guardar la clave maestra del almacén: {e}"
        ))
    })?;
    set_restricted_permissions(&key_path, false);
    Ok(())
}

/// Overwrites a file with random bytes, flushes it to disk and deletes it.
/// Best effort: on SSDs or copy-on-write filesystems old blocks may survive.
fn wipe_file(path: &Path) -> Result<(), PyroError> {
    let len = fs::metadata(path)
        .map(|m| m.len() as usize)
        .unwrap_or(KEY_LEN);
    let mut noise = vec![0u8; len.max(KEY_LEN)];
    getrandom::fill(&mut noise)
        .map_err(|e| PyroError::Vault(format!("Error generando entropía aleatoria segura: {e}")))?;
    let overwrite = fs::OpenOptions::new()
        .write(true)
        .open(path)
        .and_then(|mut file| {
            file.write_all(&noise)?;
            file.sync_all()
        });
    overwrite.map_err(|e| PyroError::Vault(format!("Error sobrescribiendo '{KEY_FILE}': {e}")))?;
    fs::remove_file(path).map_err(|e| PyroError::Vault(format!("Error borrando '{KEY_FILE}': {e}")))
}

/// Resolves the secure directory where PyroStudio stores encrypted secrets.
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

fn system_vault() -> &'static Vault {
    static VAULT: OnceLock<Vault> = OnceLock::new();
    VAULT.get_or_init(|| Vault::new(get_vault_dir(), Box::new(OsKeyStore)))
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

fn ensure_dir(dir: &Path) -> Result<(), PyroError> {
    if !dir.exists() {
        fs::create_dir_all(dir).map_err(|e| {
            PyroError::Vault(format!(
                "No se pudo crear el directorio del almacén seguro: {e}"
            ))
        })?;
        set_restricted_permissions(dir, true);
    }
    Ok(())
}

/// Fills a buffer with cryptographically secure random bytes from the OS entropy pool.
fn generate_random_bytes<const N: usize>() -> Result<[u8; N], PyroError> {
    let mut buf = [0u8; N];
    getrandom::fill(&mut buf)
        .map_err(|e| PyroError::Vault(format!("Error generando entropía aleatoria segura: {e}")))?;
    Ok(buf)
}

/// Reads and decrypts all credentials from the encrypted vault file.
fn load_vault_map(
    vault_path: &Path,
    master_key: &MasterKey,
) -> Result<HashMap<String, String>, PyroError> {
    if !vault_path.exists() {
        return Ok(HashMap::new());
    }

    let encrypted_data = fs::read(vault_path)
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

    serde_json::from_slice(&decrypted_bytes).map_err(|e| {
        PyroError::Vault(format!(
            "Error analizando las credenciales del almacén: {e}"
        ))
    })
}

/// Encrypts and atomically writes the credentials map to the vault file.
fn save_vault_map(
    vault_path: &Path,
    master_key: &MasterKey,
    map: &HashMap<String, String>,
) -> Result<(), PyroError> {
    let vault_dir = vault_path
        .parent()
        .ok_or_else(|| PyroError::Vault("Ruta del almacén inválida".into()))?;
    ensure_dir(vault_dir)?;

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

    let tmp_path = vault_dir.join(format!("{VAULT_FILE}.{}.tmp", std::process::id()));

    fs::write(&tmp_path, &payload).map_err(|e| {
        PyroError::Vault(format!(
            "Error escribiendo archivo temporal del almacén: {e}"
        ))
    })?;
    set_restricted_permissions(&tmp_path, false);

    // Atomic replace
    if let Err(e) = fs::rename(&tmp_path, vault_path) {
        // Fallback for filesystems where rename cannot overwrite directly
        let _ = fs::remove_file(vault_path);
        fs::rename(&tmp_path, vault_path).map_err(|e2| {
            let _ = fs::remove_file(&tmp_path);
            PyroError::Vault(format!("Error actualizando el almacén seguro: {e} / {e2}"))
        })?;
    }
    set_restricted_permissions(vault_path, false);

    Ok(())
}

/// Securely stores a secret in the encrypted vault.
pub fn save_credential(credential_id: &str, secret: &str) -> Result<(), PyroError> {
    system_vault().save(credential_id, secret)
}

/// Retrieves a secret from the encrypted vault.
/// Used strictly in Rust when establishing a connection; NEVER returned over IPC to React.
pub fn get_credential(credential_id: &str) -> Result<String, PyroError> {
    system_vault().get(credential_id)
}

/// Deletes a secret from the encrypted vault.
pub fn delete_credential(credential_id: &str) -> Result<(), PyroError> {
    system_vault().delete(credential_id)
}

/// Checks whether a credential exists in the encrypted vault without exposing its secret.
pub fn has_credential(credential_id: &str) -> bool {
    system_vault().contains(credential_id)
}

/// Reports where the vault master key is stored (keychain or file fallback).
pub fn vault_status() -> Result<KeyStorage, PyroError> {
    system_vault().status()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;

    /// In-memory keychain. `None` inside the mutex = keychain unavailable.
    #[derive(Clone)]
    struct MemoryKeyStore(Arc<Mutex<Option<Option<MasterKey>>>>);

    impl MemoryKeyStore {
        fn available() -> Self {
            Self(Arc::new(Mutex::new(Some(None))))
        }
        fn unavailable() -> Self {
            Self(Arc::new(Mutex::new(None)))
        }
        fn stored(&self) -> Option<MasterKey> {
            self.0.lock().unwrap().flatten()
        }
        fn put(&self, key: MasterKey) {
            *self.0.lock().unwrap() = Some(Some(key));
        }
    }

    impl KeyStore for MemoryKeyStore {
        fn get(&self) -> Result<Option<MasterKey>, String> {
            self.0
                .lock()
                .unwrap()
                .ok_or_else(|| "sin llavero".to_string())
        }
        fn set(&self, key: &MasterKey) -> Result<(), String> {
            let mut slot = self.0.lock().unwrap();
            match slot.as_mut() {
                Some(inner) => {
                    *inner = Some(*key);
                    Ok(())
                }
                None => Err("sin llavero".into()),
            }
        }
    }

    fn temp_dir() -> PathBuf {
        static N: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "pyro-vault-test-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Builds a vault as the previous version did: key in `master.key`.
    fn legacy_vault(dir: &Path, secrets: &[(&str, &str)]) -> MasterKey {
        let key = generate_random_bytes::<KEY_LEN>().unwrap();
        fs::write(dir.join(KEY_FILE), key).unwrap();
        let map = secrets
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        save_vault_map(&dir.join(VAULT_FILE), &key, &map).unwrap();
        key
    }

    #[test]
    fn test_empty_credential_id() {
        let vault = Vault::new(temp_dir(), Box::new(MemoryKeyStore::available()));
        assert!(vault.save("", "secret").is_err());
        assert!(vault.get("").is_err());
        assert!(!vault.contains(""));
        assert!(vault.delete("").is_ok());
    }

    #[test]
    fn new_vault_keeps_key_in_keychain_not_on_disk() {
        let dir = temp_dir();
        let store = MemoryKeyStore::available();
        let vault = Vault::new(dir.clone(), Box::new(store.clone()));
        vault.save("db", "SecurePassword@123_#$!áéíóú").unwrap();
        assert_eq!(vault.get("db").unwrap(), "SecurePassword@123_#$!áéíóú");
        assert!(store.stored().is_some());
        assert!(!dir.join(KEY_FILE).exists(), "master.key no debe existir");
        assert_eq!(vault.status().unwrap(), KeyStorage::Keychain);
    }

    #[test]
    fn roundtrip_and_isolation() {
        let vault = Vault::new(temp_dir(), Box::new(MemoryKeyStore::available()));
        vault.save("a", "pwd-1").unwrap();
        vault.save("b", "pwd-2").unwrap();
        assert!(vault.contains("a"));
        vault.delete("a").unwrap();
        assert!(!vault.contains("a"));
        assert!(vault.get("a").is_err());
        assert_eq!(vault.get("b").unwrap(), "pwd-2");
    }

    #[test]
    fn legacy_master_key_is_migrated_and_wiped() {
        let dir = temp_dir();
        let key = legacy_vault(&dir, &[("db", "s3cret")]);
        let store = MemoryKeyStore::available();
        let vault = Vault::new(dir.clone(), Box::new(store.clone()));

        assert_eq!(vault.get("db").unwrap(), "s3cret");
        assert_eq!(store.stored(), Some(key));
        assert!(
            !dir.join(KEY_FILE).exists(),
            "master.key debe borrarse tras migrar"
        );
        // Un proceso nuevo sigue pudiendo leer el vault solo con el llavero
        let reopened = Vault::new(dir, Box::new(store));
        assert_eq!(reopened.get("db").unwrap(), "s3cret");
    }

    #[test]
    fn migration_aborts_if_file_key_does_not_decrypt_vault() {
        let dir = temp_dir();
        legacy_vault(&dir, &[("db", "s3cret")]);
        fs::write(dir.join(KEY_FILE), [7u8; KEY_LEN]).unwrap(); // clave equivocada
        let vault_before = fs::read(dir.join(VAULT_FILE)).unwrap();
        let store = MemoryKeyStore::available();
        let vault = Vault::new(dir.clone(), Box::new(store.clone()));

        assert!(vault.get("db").is_err());
        assert!(
            store.stored().is_none(),
            "no debe guardar una clave no verificada"
        );
        assert!(dir.join(KEY_FILE).exists(), "no debe borrar master.key");
        assert_eq!(fs::read(dir.join(VAULT_FILE)).unwrap(), vault_before);
    }

    #[test]
    fn interrupted_migration_is_completed() {
        let dir = temp_dir();
        let key = legacy_vault(&dir, &[("db", "s3cret")]);
        let store = MemoryKeyStore::available();
        store.put(key); // la clave ya llegó al llavero pero el archivo no se borró
        let vault = Vault::new(dir.clone(), Box::new(store));
        assert_eq!(vault.get("db").unwrap(), "s3cret");
        assert!(!dir.join(KEY_FILE).exists());
    }

    #[test]
    fn stale_keychain_key_is_replaced_by_working_file_key() {
        let dir = temp_dir();
        let key = legacy_vault(&dir, &[("db", "s3cret")]);
        let store = MemoryKeyStore::available();
        store.put([9u8; KEY_LEN]);
        let vault = Vault::new(dir.clone(), Box::new(store.clone()));
        assert_eq!(vault.get("db").unwrap(), "s3cret");
        assert_eq!(store.stored(), Some(key));
        assert!(!dir.join(KEY_FILE).exists());
    }

    #[test]
    fn unavailable_keychain_falls_back_to_file_and_reports_it() {
        let dir = temp_dir();
        let vault = Vault::new(dir.clone(), Box::new(MemoryKeyStore::unavailable()));
        vault.save("db", "s3cret").unwrap();
        assert_eq!(vault.get("db").unwrap(), "s3cret");
        assert!(dir.join(KEY_FILE).exists());
        assert!(matches!(
            vault.status().unwrap(),
            KeyStorage::FileFallback { .. }
        ));
    }

    #[test]
    fn unavailable_keychain_keeps_using_legacy_file() {
        let dir = temp_dir();
        legacy_vault(&dir, &[("db", "s3cret")]);
        let vault = Vault::new(dir.clone(), Box::new(MemoryKeyStore::unavailable()));
        assert_eq!(vault.get("db").unwrap(), "s3cret");
        assert!(
            dir.join(KEY_FILE).exists(),
            "sin llavero no se borra la única copia"
        );
    }

    #[test]
    fn corrupted_key_file_never_regenerates_over_existing_vault() {
        let dir = temp_dir();
        legacy_vault(&dir, &[("db", "s3cret")]);
        fs::write(dir.join(KEY_FILE), b"short").unwrap();
        let vault_before = fs::read(dir.join(VAULT_FILE)).unwrap();
        let store = MemoryKeyStore::available();
        let vault = Vault::new(dir.clone(), Box::new(store.clone()));
        assert!(vault.save("otro", "x").is_err());
        assert!(store.stored().is_none());
        assert_eq!(fs::read(dir.join(VAULT_FILE)).unwrap(), vault_before);
    }

    #[test]
    fn missing_key_never_regenerates_over_existing_vault() {
        let dir = temp_dir();
        legacy_vault(&dir, &[("db", "s3cret")]);
        fs::remove_file(dir.join(KEY_FILE)).unwrap();
        let vault_before = fs::read(dir.join(VAULT_FILE)).unwrap();
        let store = MemoryKeyStore::available();
        let vault = Vault::new(dir.clone(), Box::new(store.clone()));
        assert!(vault.save("otro", "x").is_err());
        assert!(store.stored().is_none());
        assert_eq!(fs::read(dir.join(VAULT_FILE)).unwrap(), vault_before);
    }
}
