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

// ─── Phase 1: Dashboard & Health Models ──────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableSizeSummary {
    pub name: String,
    pub rows_count: i64,
    pub data_bytes: i64,
    pub index_bytes: i64,
    pub total_bytes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerPerformanceSummary {
    pub version: String,
    pub uptime_seconds: u64,
    pub current_connections: u64,
    pub max_connections: u64,
    pub threads_running: u64,
    pub threads_connected: u64,
    pub innodb_buffer_pool_bytes: u64,
    pub innodb_buffer_pool_hit_rate: f64,
    pub queries_total: u64,
    pub slow_queries: u64,
    pub open_tables: u64,
    pub qps: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseDashboardInfo {
    pub database_name: String,
    pub tables_count: usize,
    pub views_count: usize,
    pub routines_count: usize,
    pub triggers_count: usize,
    pub total_data_bytes: i64,
    pub total_index_bytes: i64,
    pub estimated_total_rows: i64,
    pub top_tables_by_size: Vec<TableSizeSummary>,
    pub server_summary: Option<ServerPerformanceSummary>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HealthSeverity {
    Information,
    Warning,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthIssue {
    pub id: String,
    pub category: String, // "Connections" | "MemoryBuffer" | "LocksContention" | "TablesStorage" | "SlowQueriesErrors" | "General"
    pub severity: HealthSeverity,
    pub title: String,
    pub description: String,
    pub metric_name: Option<String>,
    pub metric_value: Option<String>,
    pub threshold: Option<String>,
    pub suggestion: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthReportSummary {
    pub critical_count: usize,
    pub warning_count: usize,
    pub info_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthReport {
    pub database_name: String,
    pub server_version: String,
    pub uptime_seconds: u64,
    pub overall_score: u32,
    pub issues: Vec<HealthIssue>,
    pub summary: HealthReportSummary,
}

// ─── Phase 2: Explain & Slow Query Models ────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExplainCostInfo {
    pub query_cost: Option<String>,
    pub eval_cost: Option<String>,
    pub prefix_cost: Option<String>,
    pub data_read_per_join: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExplainNode {
    pub id: usize,
    pub select_type: String,
    pub table_name: String,
    pub access_type: String,
    pub possible_keys: Vec<String>,
    pub key: Option<String>,
    pub key_len: Option<String>,
    pub ref_columns: Vec<String>,
    pub estimated_rows: f64,
    pub filtered_percent: Option<f64>,
    pub actual_rows: Option<f64>,
    pub actual_time_ms: Option<f64>,
    pub cost_info: Option<ExplainCostInfo>,
    pub flags: Vec<String>,
    pub attached_condition: Option<String>,
    pub children: Vec<ExplainNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlowQueryAnalysis {
    pub sql: String,
    pub execution_plan: Vec<ExplainRow>,
    pub json_plan: Option<serde_json::Value>,
    pub visual_nodes: Vec<ExplainNode>,
    pub bottlenecks: Vec<String>,
    pub indexes_involved: Vec<String>,
    pub estimated_total_rows: f64,
    pub actual_rows: Option<f64>,
    pub actual_time_ms: Option<f64>,
    pub join_strategy: Option<String>,
    pub potential_optimizations: Vec<String>,
    pub is_analyze_supported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExplainRow {
    pub id: serde_json::Value,
    pub select_type: String,
    pub table: String,
    pub partitions: Option<String>,
    pub r#type: String,
    pub possible_keys: Option<String>,
    pub key: Option<String>,
    pub key_len: Option<String>,
    pub r#ref: Option<String>,
    pub rows: i64,
    pub filtered: Option<f64>,
    pub extra: Option<String>,
}

// ─── Phase 3: Index Advisor Models ───────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexRecommendation {
    pub table_name: String,
    pub recommendation: String,
    pub reason: String,
    pub estimated_benefit: String,
    pub potential_cost: String,
    pub sql_proposal: String,
    pub index_name: String,
    pub columns: Vec<String>,
    pub is_redundant: bool,
    pub redundant_with: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexAdvisorReport {
    pub database_name: String,
    pub recommendations: Vec<IndexRecommendation>,
    pub redundant_indexes_count: usize,
    pub missing_indexes_count: usize,
    pub analyzed_tables_count: usize,
}

// ─── Phase 4 & 5: Schema Diff & Migration Models ─────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DiffType {
    Added,
    Removed,
    Modified,
    Identical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnDiff {
    pub name: String,
    pub diff_type: DiffType,
    pub source_column: Option<ColumnMetadata>,
    pub target_column: Option<ColumnMetadata>,
    pub change_details: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexDiff {
    pub name: String,
    pub diff_type: DiffType,
    pub source_index: Option<IndexMetadata>,
    pub target_index: Option<IndexMetadata>,
    pub change_details: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForeignKeyMetadata {
    pub name: String,
    pub column_name: String,
    pub referenced_table: String,
    pub referenced_column: String,
    pub update_rule: String,
    pub delete_rule: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForeignKeyDiff {
    pub name: String,
    pub diff_type: DiffType,
    pub source_fk: Option<ForeignKeyMetadata>,
    pub target_fk: Option<ForeignKeyMetadata>,
    pub change_details: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableDiff {
    pub table_name: String,
    pub diff_type: DiffType,
    pub columns: Vec<ColumnDiff>,
    pub indexes: Vec<IndexDiff>,
    pub foreign_keys: Vec<ForeignKeyDiff>,
    pub source_engine: Option<String>,
    pub target_engine: Option<String>,
    pub source_collation: Option<String>,
    pub target_collation: Option<String>,
    pub change_details: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutineDiff {
    pub name: String,
    pub routine_type: String,
    pub diff_type: DiffType,
    pub source_ddl: Option<String>,
    pub target_ddl: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerDiff {
    pub name: String,
    pub table_name: String,
    pub diff_type: DiffType,
    pub source_ddl: Option<String>,
    pub target_ddl: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ViewDiff {
    pub name: String,
    pub diff_type: DiffType,
    pub source_definition: Option<String>,
    pub target_definition: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaDiffResult {
    pub source_schema: String,
    pub target_schema: String,
    pub tables: Vec<TableDiff>,
    pub routines: Vec<RoutineDiff>,
    pub triggers: Vec<TriggerDiff>,
    pub views: Vec<ViewDiff>,
    pub total_differences: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationStatement {
    pub sql: String,
    pub description: String,
    pub is_destructive: bool,
    pub danger_level: super::safe_mode::DangerLevel,
    pub target_object: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationPlan {
    pub source_schema: String,
    pub target_schema: String,
    pub statements: Vec<MigrationStatement>,
    pub full_sql: String,
    pub warnings: Vec<String>,
    pub total_statements: usize,
}

// ─── Phase 7: Table Inspector, Operations, Diagnostics & Assistant ───────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableExtendedStats {
    pub table_name: String,
    pub database_name: String,
    pub engine: String,
    pub row_format: Option<String>,
    pub table_rows: i64,
    pub avg_row_length: i64,
    pub data_length: i64,
    pub index_length: i64,
    pub data_free: i64,
    pub auto_increment: Option<i64>,
    pub create_time: Option<String>,
    pub update_time: Option<String>,
    pub check_time: Option<String>,
    pub collation: Option<String>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableInspectorDetails {
    pub structure: Vec<ColumnMetadata>,
    pub indexes: Vec<IndexMetadata>,
    pub foreign_keys: Vec<ForeignKeyMetadata>,
    pub triggers: Vec<TriggerMetadata>,
    pub statistics: TableExtendedStats,
    pub ddl: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableOperationResult {
    pub database: String,
    pub table: String,
    pub operation: String,
    pub msg_type: String,
    pub msg_text: String,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlDiagnosticResult {
    pub original_error: String,
    pub error_code: Option<u32>,
    pub sqlstate: Option<String>,
    pub message: String,
    pub error_position: Option<usize>,
    pub category: String,
    pub suggested_action: String,
    pub explanation: String,
    pub documentation_link: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlAssistantDiagnosis {
    pub sql: String,
    pub is_valid_syntax: bool,
    pub issues: Vec<String>,
    pub suggested_indexes: Vec<String>,
    pub suggested_query_rewrite: Option<String>,
    pub explanation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiDatabaseContext {
    pub database_name: String,
    pub server_version: String,
    pub selected_tables_ddl: Vec<String>,
    pub query: Option<String>,
    pub explain_plan: Option<Vec<ExplainRow>>,
    pub error_message: Option<String>,
    pub include_indexes: bool,
    pub table_statistics: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlowLogEntry {
    pub start_time: String,
    pub user_host: String,
    pub query_time_seconds: f64,
    pub lock_time_seconds: f64,
    pub rows_sent: i64,
    pub rows_examined: i64,
    pub database: Option<String>,
    pub sql_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceDigestEntry {
    pub schema_name: Option<String>,
    pub digest_text: String,
    pub exec_count: u64,
    pub sum_timer_wait_sec: f64,
    pub avg_timer_wait_sec: f64,
    pub max_timer_wait_sec: f64,
    pub sum_rows_examined: u64,
    pub sum_rows_sent: u64,
    pub sum_no_index_used: u64,
    pub first_seen: Option<String>,
    pub last_seen: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunningProcessEntry {
    pub id: u64,
    pub user: String,
    pub host: String,
    pub db: Option<String>,
    pub command: String,
    pub time_seconds: u64,
    pub state: Option<String>,
    pub info: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerSlowQueriesReport {
    pub is_slow_log_enabled: bool,
    pub log_output: String,
    pub long_query_time: f64,
    pub slow_log_file: Option<String>,
    pub log_queries_not_using_indexes: bool,
    pub slow_log_entries: Vec<SlowLogEntry>,
    pub performance_digest_entries: Vec<PerformanceDigestEntry>,
    pub running_queries: Vec<RunningProcessEntry>,
    pub total_server_slow_queries_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableDetailedStats {
    pub name: String,
    pub table_type: String,
    pub engine: Option<String>,
    pub rows_count: i64,
    pub data_bytes: i64,
    pub index_bytes: i64,
    pub total_bytes: i64,
    pub data_free_bytes: i64,
    pub auto_increment: Option<i64>,
    pub collation: Option<String>,
    pub create_time: Option<String>,
    pub update_time: Option<String>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseTablesOverview {
    pub database_name: String,
    pub tables_count: usize,
    pub views_count: usize,
    pub total_rows: i64,
    pub total_data_bytes: i64,
    pub total_index_bytes: i64,
    pub total_bytes: i64,
    pub total_free_bytes: i64,
    pub tables: Vec<TableDetailedStats>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlDumpRequest {
    pub database: String,
    pub tables: Option<Vec<String>>,
    pub export_mode: String, // "structure_and_data" | "structure_only" | "data_only"
    pub include_drop_table: bool,
    pub include_routines: bool,
    pub include_triggers: bool,
    pub include_views: bool,
    pub include_create_database: Option<bool>,
    pub insert_batch_size: Option<usize>,
    pub output_file_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlDumpSummary {
    pub database: String,
    pub tables_exported: Vec<String>,
    pub total_tables: usize,
    pub total_views: usize,
    pub total_routines: usize,
    pub total_triggers: usize,
    pub total_rows_exported: u64,
    pub file_path: Option<String>,
    pub file_size_bytes: u64,
    pub duration_ms: u64,
    pub sql_preview: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlRestoreRequest {
    pub file_path: String,
    pub target_database: String,
    pub create_database_if_not_exists: bool,
    pub stop_on_error: bool,
    pub disable_foreign_keys: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlRestoreProgressEvent {
    pub stage: String,
    pub bytes_read: u64,
    pub total_bytes: u64,
    pub statements_executed: u64,
    pub current_statement_preview: String,
    pub percent_complete: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlRestoreSummary {
    pub target_database: String,
    pub total_statements: usize,
    pub successful_statements: usize,
    pub failed_statements: usize,
    pub errors: Vec<String>,
    pub duration_ms: u64,
    pub bytes_processed: u64,
}
