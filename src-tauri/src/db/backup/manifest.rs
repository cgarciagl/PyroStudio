use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BackupType {
    Full,
    Incremental,
    Differential,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CompressionFormat {
    Zstd,
    Gzip,
    None,
}

impl CompressionFormat {
    pub fn extension(&self) -> &'static str {
        match self {
            Self::Zstd => "sql.zst",
            Self::Gzip => "sql.gz",
            Self::None => "sql",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BackupStatus {
    InProgress,
    Completed,
    Failed,
    Aborted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkManifest {
    pub chunk_index: usize,
    pub file_name: String,
    pub first_key: Option<Vec<serde_json::Value>>,
    pub last_key: Option<Vec<serde_json::Value>>,
    pub rows: u64,
    pub uncompressed_bytes: u64,
    pub compressed_bytes: u64,
    pub sha256: String,
    pub completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableBackupManifest {
    pub name: String,
    pub table_type: String,
    pub engine: Option<String>,
    pub is_transactional: bool,
    pub schema_file: String,
    pub schema_sha256: String,
    pub total_rows: u64,
    pub total_uncompressed_bytes: u64,
    pub total_compressed_bytes: u64,
    pub chunks: Vec<ChunkManifest>,
    pub completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupManifest {
    pub version: u32,
    pub backup_id: String,
    pub backup_type: BackupType,
    pub compression: CompressionFormat,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub server_version: String,
    pub database: String,
    pub binlog_coordinates: Option<String>,
    pub gtid: Option<String>,
    pub tables: Vec<TableBackupManifest>,
    pub views_file: Option<String>,
    pub routines_file: Option<String>,
    pub triggers_file: Option<String>,
    pub total_tables: usize,
    pub total_views: usize,
    pub total_rows: u64,
    pub total_uncompressed_bytes: u64,
    pub total_compressed_bytes: u64,
    pub duration_ms: u64,
    pub status: BackupStatus,
    pub error: Option<String>,
    pub non_transactional_tables: Vec<String>,
    pub warnings: Vec<String>,
}

impl BackupManifest {
    pub fn new(
        backup_id: String,
        backup_type: BackupType,
        compression: CompressionFormat,
        server_version: String,
        database: String,
    ) -> Self {
        Self {
            version: 1,
            backup_id,
            backup_type,
            compression,
            created_at: chrono::Utc::now().to_rfc3339(),
            completed_at: None,
            server_version,
            database,
            binlog_coordinates: None,
            gtid: None,
            tables: Vec::new(),
            views_file: None,
            routines_file: None,
            triggers_file: None,
            total_tables: 0,
            total_views: 0,
            total_rows: 0,
            total_uncompressed_bytes: 0,
            total_compressed_bytes: 0,
            duration_ms: 0,
            status: BackupStatus::InProgress,
            error: None,
            non_transactional_tables: Vec::new(),
            warnings: Vec::new(),
        }
    }
}
