use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpTunnelConfig {
    pub enabled: bool,
    pub url: String,
    pub http_user: Option<String>,
    pub http_password: Option<String>,
    pub encode_base64: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: Option<String>,
    pub database: Option<String>,
    pub tunnel: Option<HttpTunnelConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfo {
    pub version: String,
    pub current_user: String,
    pub current_database: Option<String>,
    pub ping_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseSchema {
    pub name: String,
    pub tables_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableMetadata {
    pub name: String,
    pub table_type: String,
    pub engine: Option<String>,
    pub rows_count: Option<i64>,
    pub data_length: Option<i64>,
    pub collation: Option<String>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnMetadata {
    pub name: String,
    pub ordinal_position: i32,
    pub column_default: Option<String>,
    pub is_nullable: bool,
    pub data_type: String,
    pub column_type: String,
    pub column_key: String,
    pub extra: String,
    pub comment: String,
    pub collation: Option<String>,
    pub character_set: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionStatus {
    pub is_connected: bool,
    pub config: Option<ConnectionConfig>,
    pub server_info: Option<ServerInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableDataResult {
    pub columns: Vec<String>,
    pub column_types: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub total_rows: Option<i64>,
    pub execution_time_ms: u64,
    pub limit: u32,
    pub offset: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CellUpdateRequest {
    pub database: String,
    pub table: String,
    pub primary_key_column: String,
    pub primary_key_value: serde_json::Value,
    pub column_name: String,
    pub new_value: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryExecutionResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub affected_rows: u64,
    pub execution_time_ms: u64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutineMetadata {
    pub name: String,
    pub routine_type: String, // "PROCEDURE" | "FUNCTION"
    pub data_type: Option<String>,
    pub definer: Option<String>,
    pub created: Option<String>,
    pub last_altered: Option<String>,
    pub security_type: Option<String>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutineParam {
    pub mode: String, // "IN", "OUT", "INOUT"
    pub name: String,
    pub data_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutineDetail {
    pub name: String,
    pub routine_type: String,
    pub ddl: String,
    pub params: Vec<RoutineParam>,
    pub return_type: Option<String>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerMetadata {
    pub name: String,
    pub table_name: String,
    pub timing: String, // "BEFORE" | "AFTER"
    pub event: String,  // "INSERT" | "UPDATE" | "DELETE"
    pub definer: Option<String>,
    pub created: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerDetail {
    pub name: String,
    pub table_name: String,
    pub timing: String,
    pub event: String,
    pub ddl: String,
}

/// A single column participating in an index
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexColumn {
    pub seq_in_index: u32,
    pub column_name: String,
    pub sub_part: Option<i64>,
    pub collation: Option<String>,
}

/// Metadata for a table index (from SHOW INDEX)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexMetadata {
    pub key_name: String,       // Index name ("PRIMARY", or user-defined)
    pub is_primary: bool,
    pub is_unique: bool,
    pub index_type: String,     // "BTREE" | "HASH" | "FULLTEXT" | "SPATIAL"
    pub columns: Vec<IndexColumn>,
    pub comment: Option<String>,
}

/// Request payload to create or replace an index
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateIndexRequest {
    pub database: String,
    pub table: String,
    pub index_name: String,
    pub index_type: String,  // "INDEX" | "UNIQUE" | "FULLTEXT" | "SPATIAL"
    pub columns: Vec<String>,
    pub comment: Option<String>,
}
