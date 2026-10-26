use serde::{Deserialize, Serialize};

/// Highest shared format version this build can read and write.
/// Bump only together with a migration in `migration.rs` (see docs/WORKSPACES.md).
pub const FORMAT_VERSION: u32 = 1;

pub const MANIFEST_FILE: &str = "workspace.json";
pub const CONNECTIONS_DIR: &str = "connections";
pub const QUERIES_DIR: &str = "queries";
pub const SNIPPETS_DIR: &str = "snippets";

/// `workspace.json`. Contains only portable, non-secret metadata.
/// Unknown fields written by newer compatible versions are preserved in `extra`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceManifest {
    pub format_version: u32,
    pub workspace_id: String,
    pub name: String,
    pub created_at: String,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// Per-computer configuration, stored in the OS config dir (never in the workspace).
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalWorkspaceConfig {
    pub version: u32,
    /// Absolute path of the active folder workspace on THIS computer. `None` = local default storage.
    pub active_path: Option<String>,
    pub last_workspace_id: Option<String>,
    pub last_workspace_name: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceAvailability {
    /// No folder workspace configured: the app uses the legacy local storage.
    Local,
    Available,
    Unavailable,
    Incompatible,
    Invalid,
}

/// Status returned to the UI.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStatus {
    pub availability: WorkspaceAvailability,
    pub workspace_id: Option<String>,
    pub name: Option<String>,
    /// Shown so the user can recognize/relocate the folder. Comes from local config only.
    pub path: Option<String>,
    pub format_version: Option<u32>,
    pub error: Option<String>,
}

/// A saved SQL query as exposed to the UI. Mirrors the frontend `SqlFavorite`
/// plus file-tracking fields used for conflict detection.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceQuery {
    pub id: String,
    pub title: String,
    pub category: String,
    pub sql: String,
    pub description: Option<String>,
    /// Logical id of the shared connection this query belongs to (optional).
    pub connection_id: Option<String>,
    /// Database (schema) inside that connection (optional).
    pub database: Option<String>,
    /// Folder inside the database's query list (optional, one level).
    pub folder: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    /// Path relative to the workspace root, always with `/` separators.
    pub rel_path: String,
    /// Hash of the file bytes when it was read. Sent back on save to detect external edits.
    pub content_hash: String,
    /// True when the file had no `pyro-*` metadata header.
    pub has_header: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveQueryInput {
    pub id: Option<String>,
    pub title: String,
    pub category: String,
    pub sql: String,
    pub description: Option<String>,
    #[serde(default)]
    pub connection_id: Option<String>,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub folder: Option<String>,
    pub created_at: Option<i64>,
    pub updated_at: Option<i64>,
    /// Hash the client last saw. `None` for new queries. Mismatch => `Conflict`.
    pub expected_hash: Option<String>,
    /// Overwrite even if the file changed externally (explicit user choice).
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionListing {
    pub connections: Vec<serde_json::Value>,
    /// Files that could not be parsed; reported, never deleted.
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct QueryListing {
    pub queries: Vec<WorkspaceQuery>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyImport {
    pub connections: Vec<serde_json::Value>,
    pub queries: Vec<SaveQueryInput>,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MigrationReport {
    pub connections_written: usize,
    pub connections_skipped: usize,
    pub queries_written: usize,
    pub queries_skipped: usize,
    /// Items whose id already exists in the workspace with different content (not overwritten).
    pub conflicts: Vec<String>,
    pub invalid: Vec<String>,
    /// True only if every source item is present and verified after re-reading from disk.
    pub verified: bool,
}
