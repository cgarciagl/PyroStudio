//! Workspace use cases and per-computer configuration.

use super::error::{WorkspaceError, WsResult};
use super::models::*;
use super::repository::{self, atomic_write, new_uuid};
use super::{migration, query_files};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const LOCAL_CONFIG_VERSION: u32 = 1;

pub struct WorkspaceManager {
    config_path: PathBuf,
    config: Mutex<LocalWorkspaceConfig>,
}

/// Default location of the per-computer config (outside any shared folder).
pub fn default_config_path() -> PathBuf {
    let mut dir = dirs::config_dir()
        .or_else(dirs::data_local_dir)
        .unwrap_or_else(|| PathBuf::from(".pyro_config"));
    dir.push("PyroStudio");
    dir.push("workspace.local.json");
    dir
}

fn status_from_error(cfg: &LocalWorkspaceConfig, err: &WorkspaceError) -> WorkspaceStatus {
    let availability = match err {
        WorkspaceError::IncompatibleVersion { .. } => WorkspaceAvailability::Incompatible,
        WorkspaceError::InvalidManifest(_) | WorkspaceError::NotAWorkspace => {
            WorkspaceAvailability::Invalid
        }
        _ => WorkspaceAvailability::Unavailable,
    };
    WorkspaceStatus {
        availability,
        workspace_id: cfg.last_workspace_id.clone(),
        name: cfg.last_workspace_name.clone(),
        path: cfg.active_path.clone(),
        format_version: None,
        error: Some(err.to_string()),
    }
}

impl WorkspaceManager {
    pub fn new(config_path: PathBuf) -> Self {
        let config = fs::read(&config_path)
            .ok()
            .and_then(|b| serde_json::from_slice::<LocalWorkspaceConfig>(&b).ok())
            .unwrap_or_default();
        Self {
            config_path,
            config: Mutex::new(config),
        }
    }

    fn cfg(&self) -> LocalWorkspaceConfig {
        self.config.lock().map(|c| c.clone()).unwrap_or_default()
    }

    fn persist(&self, mut cfg: LocalWorkspaceConfig) -> WsResult<()> {
        cfg.version = LOCAL_CONFIG_VERSION;
        let dir = self
            .config_path
            .parent()
            .ok_or_else(|| WorkspaceError::Io("ruta de configuración inválida".into()))?;
        fs::create_dir_all(dir)?;
        let bytes = serde_json::to_vec_pretty(&cfg)?;
        atomic_write(dir, &self.config_path, &bytes)?;
        if let Ok(mut guard) = self.config.lock() {
            *guard = cfg;
        }
        Ok(())
    }

    /// Re-evaluates availability every call: the folder may have been unmounted.
    pub fn status(&self) -> WorkspaceStatus {
        let cfg = self.cfg();
        let Some(path) = cfg.active_path.clone() else {
            return WorkspaceStatus {
                availability: WorkspaceAvailability::Local,
                workspace_id: None,
                name: None,
                path: None,
                format_version: None,
                error: None,
            };
        };
        match repository::read_manifest(Path::new(&path)) {
            Ok(m) => WorkspaceStatus {
                availability: WorkspaceAvailability::Available,
                workspace_id: Some(m.workspace_id),
                name: Some(m.name),
                path: Some(path),
                format_version: Some(m.format_version),
                error: None,
            },
            Err(e) => status_from_error(&cfg, &e),
        }
    }

    /// Root of the active workspace, only if it is present, valid and compatible.
    pub fn root(&self) -> WsResult<PathBuf> {
        let cfg = self.cfg();
        let path = PathBuf::from(cfg.active_path.ok_or(WorkspaceError::NoActiveWorkspace)?);
        let manifest = repository::read_manifest(&path)?;
        if let Some(expected) = cfg.last_workspace_id {
            if expected != manifest.workspace_id {
                // The folder now holds a different workspace: do not mix resources.
                return Err(WorkspaceError::InvalidManifest(
                    "la carpeta contiene un workspace distinto al configurado".into(),
                ));
            }
        }
        Ok(path)
    }

    pub fn create(&self, folder: &Path, name: &str) -> WsResult<WorkspaceStatus> {
        if !folder.is_dir() {
            return Err(WorkspaceError::Unavailable);
        }
        if repository::manifest_path(folder).exists() {
            return Err(WorkspaceError::AlreadyExists);
        }
        let name = match name.trim() {
            "" => folder
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "Workspace".into()),
            n => n.chars().take(120).collect(),
        };
        for d in [CONNECTIONS_DIR, QUERIES_DIR, SNIPPETS_DIR] {
            fs::create_dir_all(folder.join(d))?;
        }
        let manifest = WorkspaceManifest {
            format_version: FORMAT_VERSION,
            workspace_id: new_uuid()?,
            name,
            created_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
            extra: Default::default(),
        };
        repository::write_manifest(folder, &manifest)?;
        // Validate what we wrote before activating it.
        repository::read_manifest(folder)?;
        self.activate(folder, &manifest)
    }

    pub fn open(&self, folder: &Path) -> WsResult<WorkspaceStatus> {
        let manifest = repository::read_manifest(folder)?;
        self.activate(folder, &manifest)
    }

    /// Re-points the configured workspace to a moved/remounted folder.
    /// Refuses a folder that holds a different workspace id.
    pub fn relocate(&self, folder: &Path) -> WsResult<WorkspaceStatus> {
        let manifest = repository::read_manifest(folder)?;
        if let Some(expected) = self.cfg().last_workspace_id {
            if expected != manifest.workspace_id {
                return Err(WorkspaceError::InvalidData(format!(
                    "la carpeta contiene otro workspace ('{}'). Use «Abrir workspace» para cambiar de workspace.",
                    manifest.name
                )));
            }
        }
        self.activate(folder, &manifest)
    }

    fn activate(&self, folder: &Path, manifest: &WorkspaceManifest) -> WsResult<WorkspaceStatus> {
        let canonical = folder
            .canonicalize()
            .unwrap_or_else(|_| folder.to_path_buf());
        let mut display = canonical.to_string_lossy().to_string();
        if let Some(stripped) = display.strip_prefix(r"\\?\") {
            display = stripped.to_string();
        }
        self.persist(LocalWorkspaceConfig {
            version: LOCAL_CONFIG_VERSION,
            active_path: Some(display),
            last_workspace_id: Some(manifest.workspace_id.clone()),
            last_workspace_name: Some(manifest.name.clone()),
        })?;
        Ok(self.status())
    }

    /// Switches back to the built-in local storage. Leaves the folder untouched.
    pub fn use_local(&self) -> WsResult<WorkspaceStatus> {
        self.persist(LocalWorkspaceConfig::default())?;
        Ok(self.status())
    }

    pub fn list_connections(&self) -> WsResult<ConnectionListing> {
        repository::list_connections(&self.root()?)
    }

    pub fn save_connection(&self, conn: &serde_json::Value) -> WsResult<serde_json::Value> {
        repository::save_connection(&self.root()?, conn)
    }

    pub fn delete_connection(&self, id: &str) -> WsResult<()> {
        repository::delete_connection(&self.root()?, id)
    }

    pub fn list_queries(&self) -> WsResult<QueryListing> {
        query_files::list_queries(&self.root()?)
    }

    pub fn read_query(&self, id: &str) -> WsResult<WorkspaceQuery> {
        query_files::find_query(&self.root()?, id)
    }

    pub fn save_query(&self, input: &SaveQueryInput) -> WsResult<WorkspaceQuery> {
        query_files::save_query(&self.root()?, input)
    }

    pub fn delete_query(&self, id: &str, expected_hash: Option<&str>) -> WsResult<()> {
        query_files::delete_query(&self.root()?, id, expected_hash)
    }

    pub fn read_groups(&self, connection_id: &str) -> WsResult<super::groups::GroupsSnapshot> {
        super::groups::read_groups(&self.root()?, connection_id)
    }

    pub fn save_groups(
        &self,
        connection_id: &str,
        databases: &super::groups::DatabaseGroups,
        expected_hash: &str,
    ) -> WsResult<super::groups::GroupsSnapshot> {
        super::groups::save_groups(&self.root()?, connection_id, databases, expected_hash)
    }

    pub fn read_snippets(&self) -> WsResult<super::snippets::SnippetsSnapshot> {
        super::snippets::read_snippets(&self.root()?)
    }

    pub fn save_snippets(
        &self,
        snippets: &[super::snippets::SqlSnippet],
        expected_hash: &str,
    ) -> WsResult<super::snippets::SnippetsSnapshot> {
        super::snippets::save_snippets(&self.root()?, snippets, expected_hash)
    }

    pub fn import_legacy(&self, data: &LegacyImport) -> WsResult<MigrationReport> {
        migration::import_legacy(&self.root()?, data)
    }
}
