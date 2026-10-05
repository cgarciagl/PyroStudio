use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpTunnelConfig {
    pub enabled: bool,
    pub url: String,
    pub http_user: Option<String>,
    #[serde(skip_serializing, default)]
    pub http_password: Option<String>,
    #[serde(skip_serializing, default)]
    pub auth_token: Option<String>,
    #[serde(alias = "tunnelCredentialId", alias = "tunnel_credential_id", default)]
    pub tunnel_credential_id: Option<String>,
    #[serde(alias = "tokenCredentialId", alias = "token_credential_id", default)]
    pub token_credential_id: Option<String>,
    #[serde(alias = "encodeBase64", alias = "encode_base64", default)]
    pub encode_base64: Option<bool>,
    #[serde(default)]
    pub timeout_seconds: Option<u64>,
    #[serde(default)]
    pub max_response_bytes: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsConfig {
    pub enabled: bool,
    #[serde(default)]
    pub ca_cert_path: Option<String>,
    #[serde(default = "default_true")]
    pub verify_certificate: bool,
    #[serde(default)]
    pub allow_insecure_tls: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SshAuthentication {
    Agent,
    PrivateKey,
}

impl Default for SshAuthentication {
    fn default() -> Self {
        Self::Agent
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshTunnelConfig {
    pub enabled: bool,
    pub ssh_host: String,
    #[serde(default = "default_ssh_port")]
    pub ssh_port: u16,
    pub ssh_user: String,
    pub remote_host: String,
    #[serde(default = "default_mysql_port")]
    pub remote_port: u16,
    #[serde(default)]
    pub authentication: SshAuthentication,
    #[serde(default)]
    pub private_key_path: Option<String>,
}

fn default_true() -> bool {
    true
}

fn default_ssh_port() -> u16 {
    22
}

fn default_mysql_port() -> u16 {
    3306
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    #[serde(skip_serializing, default)]
    pub password: Option<String>,
    #[serde(alias = "credentialId", alias = "credential_id", default)]
    pub credential_id: Option<String>,
    pub database: Option<String>,
    pub tunnel: Option<HttpTunnelConfig>,
    #[serde(default)]
    pub tls: Option<TlsConfig>,
    #[serde(default)]
    pub ssh_tunnel: Option<SshTunnelConfig>,
    #[serde(alias = "savedConnectionId", alias = "saved_connection_id", default)]
    pub saved_connection_id: Option<String>,
    #[serde(
        alias = "savedConnectionName",
        alias = "saved_connection_name",
        default
    )]
    pub saved_connection_name: Option<String>,
}

/// Sanitized connection information safe to send to React.
/// Never contains passwords, secrets, or raw authentication tokens.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionInfo {
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(default)]
    pub user: String,
    pub database: Option<String>,
    pub tunnel_enabled: bool,
    pub credential_id: Option<String>,
    pub saved_connection_name: Option<String>,
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
    pub connection_info: Option<ConnectionInfo>,
    /// Alias for backward compatibility with frontend, never exposes secrets
    pub config: Option<ConnectionInfo>,
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

/// Primary key model representing an ordered list of columns.
/// Fully supports both single-column and composite primary keys.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PrimaryKey {
    pub columns: Vec<String>,
}

/// Single column condition for identifying rows by primary key
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PrimaryKeyCondition {
    pub column: String,
    pub value: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CellUpdateRequest {
    pub database: String,
    pub table: String,
    /// List of PK column-value conditions supporting composite keys
    #[serde(default)]
    pub primary_keys: Vec<PrimaryKeyCondition>,
    pub column_name: String,
    pub new_value: serde_json::Value,
    /// Optional legacy single-column PK fields for backward-compatibility
    #[serde(default)]
    pub primary_key_column: Option<String>,
    #[serde(default)]
    pub primary_key_value: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteRowRequest {
    pub database: String,
    pub table: String,
    pub primary_keys: Vec<PrimaryKeyCondition>,
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
    pub key_name: String, // Index name ("PRIMARY", or user-defined)
    pub is_primary: bool,
    pub is_unique: bool,
    pub index_type: String, // "BTREE" | "HASH" | "FULLTEXT" | "SPATIAL"
    pub columns: Vec<IndexColumn>,
    pub comment: Option<String>,
}

/// Request payload to create or replace an index
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateIndexRequest {
    pub database: String,
    pub table: String,
    pub index_name: String,
    pub index_type: String, // "INDEX" | "UNIQUE" | "FULLTEXT" | "SPATIAL"
    pub columns: Vec<String>,
    pub comment: Option<String>,
}
