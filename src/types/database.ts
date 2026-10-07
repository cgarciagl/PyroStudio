export type EnvironmentTag = "local" | "development" | "staging" | "production";

export interface HttpTunnelConfig {
  enabled: boolean;
  url: string;
  http_user?: string;
  http_password?: string;
  auth_token?: string;
  tunnel_credential_id?: string;
  token_credential_id?: string;
  encode_base64?: boolean;
  timeout_seconds?: number;
  max_response_bytes?: number;
}

export interface TlsConfig {
  enabled: boolean;
  ca_cert_path?: string;
  verify_certificate: boolean;
  allow_insecure_tls: boolean;
}

export type SshAuthentication = "agent" | "private_key";

export interface SshTunnelConfig {
  enabled: boolean;
  ssh_host: string;
  ssh_port: number;
  ssh_user: string;
  remote_host: string;
  remote_port: number;
  authentication: SshAuthentication;
  private_key_path?: string;
}

export interface SavedConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  credentialId?: string;
  tunnelCredentialId?: string;
  database?: string;
  environment?: EnvironmentTag;
  colorTag?: string;
  tunnel?: HttpTunnelConfig;
  tls?: TlsConfig;
  ssh_tunnel?: SshTunnelConfig;
  createdAt: number;
  lastConnectedAt?: number;
  // Deprecated legacy field - automatically migrated to encrypted vault on launch
  password?: string;
}

export interface ConnectionConfig {
  host: string;
  port: number;
  user: string;
  password?: string;
  credential_id?: string;
  database?: string;
  tunnel?: HttpTunnelConfig;
  tls?: TlsConfig;
  ssh_tunnel?: SshTunnelConfig;
  savedConnectionId?: string;
  savedConnectionName?: string;
}

export interface ConnectionInfo {
  host: string;
  port: number;
  username: string;
  user?: string;
  database?: string;
  tunnel_enabled: boolean;
  credential_id?: string;
  saved_connection_name?: string;
  savedConnectionName?: string;
}

export interface ServerInfo {
  version: string;
  current_user: string;
  current_database?: string;
  ping_ms: number;
}

export interface DatabaseSchema {
  name: string;
  tables_count: number;
}

export interface TableMetadata {
  name: string;
  table_type: string;
  engine?: string;
  rows_count?: number;
  data_length?: number;
  collation?: string;
  comment?: string;
}

export interface ColumnMetadata {
  name: string;
  ordinal_position: number;
  column_default?: string;
  is_nullable: boolean;
  data_type: string;
  column_type: string;
  column_key: string;
  extra: string;
  comment: string;
  collation?: string;
  character_set?: string;
}

export interface ConnectionStatus {
  is_connected: boolean;
  connection_info?: ConnectionInfo;
  config?: ConnectionInfo | ConnectionConfig;
  server_info?: ServerInfo;
}

export interface OpenTab {
  id: string;
  title: string;
  type:
    | "table"
    | "query"
    | "columns"
    | "routine"
    | "trigger"
    | "dashboard"
    | "health"
    | "slow_query"
    | "advisor"
    | "diff"
    | "operations"
    | "tables_overview"
    | "agent"
    | "reports";
  database: string;
  tableName?: string;
  initialView?: "custom" | "server_log";
  queryContent?: string;
  routineName?: string;
  routineType?: "PROCEDURE" | "FUNCTION";
  triggerName?: string;
  targetDatabase?: string;
}

export interface TableDataResult {
  columns: string[];
  column_types: string[];
  rows: any[][];
  total_rows?: number;
  execution_time_ms: number;
  limit: number;
  offset: number;
}

export interface PrimaryKey {
  columns: string[];
}

export interface PrimaryKeyCondition {
  column: string;
  value: any;
}

export interface CellUpdateRequest {
  database: string;
  table: string;
  primary_keys?: PrimaryKeyCondition[];
  column_name: string;
  new_value: any;
  // Legacy single PK compatibility
  primary_key_column?: string;
  primary_key_value?: any;
}

export interface DeleteRowRequest {
  database: string;
  table: string;
  primary_keys: PrimaryKeyCondition[];
}

export interface QueryExecutionResult {
  columns: string[];
  rows: any[][];
  affected_rows: number;
  execution_time_ms: number;
  message: string;
}

export interface ExcelPreviewData {
  file_path: string;
  sheets: string[];
  selected_sheet: string;
  headers: string[];
  preview_rows: any[][];
  total_rows: number;
}

export interface ColumnMapping {
  excel_column: string;
  db_column: string;
  ignored: boolean;
  is_key?: boolean;
}

export type ImportModeType =
  | { type: "Append" }
  | { type: "Update"; config?: { primary_key_db?: string; primary_key_excel?: string } }
  | { type: "AppendUpdate"; config?: { primary_key_db?: string; primary_key_excel?: string } }
  | { type: "AppendWithoutUpdate" }
  | { type: "Delete"; config?: { primary_key_db?: string; primary_key_excel?: string } }
  | { type: "Copy" }
  | { type: "Replace" };

export interface NewTableColumnDef {
  name: string;
  data_type: string;
  is_primary_key: boolean;
  is_nullable: boolean;
  auto_increment: boolean;
}

export interface NewTableConfig {
  table_name: string;
  engine?: string;
  collation?: string;
  columns: NewTableColumnDef[];
}

export interface ImportRequest {
  file_path: string;
  sheet_name?: string;
  database: string;
  table: string;
  mappings: ColumnMapping[];
  mode: ImportModeType;
  batch_size?: number;
  new_table_config?: NewTableConfig;
  error_strategy?: "strict" | "tolerant";
  dry_run?: boolean;
}

export interface ImportErrorDetail {
  row_index: number;
  error_message: string;
  column?: string;
  value?: string;
}

export interface ImportProgressEvent {
  current_row: number;
  total_rows: number;
  percentage: number;
  successful_rows: number;
  failed_rows: number;
  stage: string;
}

export interface ImportSummary {
  total_processed: number;
  successful_rows: number;
  failed_rows: number;
  skipped_rows?: number;
  error_count?: number;
  execution_time_ms: number;
  errors: ImportErrorDetail[];
}

export interface ExportRequest {
  database: string;
  table: string;
  file_path?: string;
  query?: string;
}

export interface ExportSummary {
  file_path: string;
  total_rows: number;
  execution_time_ms: number;
  file_size_bytes: number;
}

export interface ExportProgressEvent {
  rows_written: number;
  stage: string;
}

export interface ExplainRow {
  id: number | string;
  select_type: string;
  table: string;
  partitions?: string;
  type: string;
  possible_keys?: string;
  key?: string;
  key_len?: string;
  ref?: string;
  rows: number;
  filtered?: number;
  extra?: string;
}

export interface ColumnDefinition {
  id: string;
  name: string;
  dataType: string;
  length?: string;
  isPrimaryKey: boolean;
  isAutoIncrement: boolean;
  isNullable: boolean;
  isUnique: boolean;
  defaultValue?: string;
  comment?: string;
  charset?: string;
  collation?: string;
}

export interface CreateTableOptions {
  database: string;
  tableName: string;
  engine: string;
  collation: string;
  comment?: string;
  columns: ColumnDefinition[];
}

export interface RoutineMetadata {
  name: string;
  routine_type: "PROCEDURE" | "FUNCTION";
  data_type?: string;
  definer?: string;
  created?: string;
  last_altered?: string;
  security_type?: string;
  comment?: string;
}

export interface RoutineParam {
  mode: "IN" | "OUT" | "INOUT";
  name: string;
  data_type: string;
}

export interface RoutineDetail {
  name: string;
  routine_type: "PROCEDURE" | "FUNCTION";
  ddl: string;
  params: RoutineParam[];
  return_type?: string;
  comment?: string;
}

export interface TriggerMetadata {
  name: string;
  table_name: string;
  timing: "BEFORE" | "AFTER";
  event: "INSERT" | "UPDATE" | "DELETE";
  definer?: string;
  created?: string;
}

export interface TriggerDetail {
  name: string;
  table_name: string;
  timing: string;
  event: string;
  ddl: string;
}

// ─── Index types ─────────────────────────────────────────────────────────────

export interface IndexColumn {
  seq_in_index: number;
  column_name: string;
  sub_part?: number;
  collation?: string;
}

export interface IndexMetadata {
  key_name: string;
  is_primary: boolean;
  is_unique: boolean;
  index_type: string; // "BTREE" | "HASH" | "FULLTEXT" | "SPATIAL"
  columns: IndexColumn[];
  comment?: string;
}

export interface CreateIndexRequest {
  database: string;
  table: string;
  index_name: string;
  index_type: string; // "INDEX" | "UNIQUE" | "FULLTEXT" | "SPATIAL"
  columns: string[];
  comment?: string;
}

// ─── Safe Mode & History / Favorites types ───────────────────────────────────

export type DangerLevel = "Safe" | "Medium" | "Critical";

export interface SqlSafetyAnalysis {
  is_destructive: boolean;
  danger_level: DangerLevel;
  operation: string;
  message: string;
  requires_explicit_confirmation: boolean;
}

export interface QueryHistoryItem {
  id: string;
  timestamp: number;
  connectionName: string;
  database: string;
  sql: string;
  durationMs: number;
  success: boolean;
  errorMessage?: string;
  affectedRows?: number;
}

export interface SqlFavorite {
  id: string;
  title: string;
  sql: string;
  category: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
}

// ─── Phase 1: Dashboard & Health Types ───────────────────────────────────────

export interface TableSizeSummary {
  name: string;
  rows_count: number;
  data_bytes: number;
  index_bytes: number;
  total_bytes: number;
}

export interface ServerPerformanceSummary {
  version: string;
  uptime_seconds: number;
  current_connections: number;
  max_connections: number;
  threads_running: number;
  threads_connected: number;
  innodb_buffer_pool_bytes: number;
  innodb_buffer_pool_hit_rate: number;
  queries_total: number;
  slow_queries: number;
  open_tables: number;
  qps: number;
}

export interface DatabaseDashboardInfo {
  database_name: string;
  tables_count: number;
  views_count: number;
  routines_count: number;
  triggers_count: number;
  total_data_bytes: number;
  total_index_bytes: number;
  estimated_total_rows: number;
  top_tables_by_size: TableSizeSummary[];
  server_summary?: ServerPerformanceSummary;
}

export type HealthSeverity = "Information" | "Warning" | "Critical";

export interface HealthIssue {
  id: string;
  category: string;
  severity: HealthSeverity;
  title: string;
  description: string;
  metric_name?: string;
  metric_value?: string;
  threshold?: string;
  suggestion?: string;
}

export interface HealthReportSummary {
  critical_count: number;
  warning_count: number;
  info_count: number;
}

export interface HealthReport {
  database_name: string;
  server_version: string;
  uptime_seconds: number;
  overall_score: number;
  issues: HealthIssue[];
  summary: HealthReportSummary;
}

// ─── Phase 2: Explain & Slow Query Types ─────────────────────────────────────

export interface ExplainCostInfo {
  query_cost?: string;
  eval_cost?: string;
  prefix_cost?: string;
  data_read_per_join?: string;
}

export interface ExplainNode {
  id: number;
  select_type: string;
  table_name: string;
  access_type: string;
  possible_keys: string[];
  key?: string;
  key_len?: string;
  ref_columns: string[];
  estimated_rows: number;
  filtered_percent?: number;
  actual_rows?: number;
  actual_time_ms?: number;
  cost_info?: ExplainCostInfo;
  flags: string[];
  attached_condition?: string;
  children: ExplainNode[];
}

export interface SlowQueryAnalysis {
  sql: string;
  execution_plan: ExplainRow[];
  json_plan?: any;
  visual_nodes: ExplainNode[];
  bottlenecks: string[];
  indexes_involved: string[];
  estimated_total_rows: number;
  actual_rows?: number;
  actual_time_ms?: number;
  join_strategy?: string;
  potential_optimizations: string[];
  is_analyze_supported: boolean;
}

// ─── Phase 3: Index Advisor Types ────────────────────────────────────────────

export interface IndexRecommendation {
  table_name: string;
  recommendation: string;
  reason: string;
  estimated_benefit: string;
  potential_cost: string;
  sql_proposal: string;
  index_name: string;
  columns: string[];
  is_redundant: boolean;
  redundant_with?: string;
}

export interface IndexAdvisorReport {
  database_name: string;
  recommendations: IndexRecommendation[];
  redundant_indexes_count: number;
  missing_indexes_count: number;
  analyzed_tables_count: number;
}

// ─── Phase 4 & 5: Schema Diff & Migration Types ──────────────────────────────

export type DiffType = "Added" | "Removed" | "Modified" | "Identical";

export interface ColumnDiff {
  name: string;
  diff_type: DiffType;
  source_column?: ColumnMetadata;
  target_column?: ColumnMetadata;
  change_details: string[];
}

export interface IndexDiff {
  name: string;
  diff_type: DiffType;
  source_index?: IndexMetadata;
  target_index?: IndexMetadata;
  change_details: string[];
}

export interface ForeignKeyMetadata {
  name: string;
  column_name: string;
  referenced_table: string;
  referenced_column: string;
  update_rule: string;
  delete_rule: string;
}

export interface ForeignKeyDiff {
  name: string;
  diff_type: DiffType;
  source_fk?: ForeignKeyMetadata;
  target_fk?: ForeignKeyMetadata;
  change_details: string[];
}

export interface TableDiff {
  table_name: string;
  diff_type: DiffType;
  columns: ColumnDiff[];
  indexes: IndexDiff[];
  foreign_keys: ForeignKeyDiff[];
  source_engine?: string;
  target_engine?: string;
  source_collation?: string;
  target_collation?: string;
  change_details: string[];
}

export interface RoutineDiff {
  name: string;
  routine_type: string;
  diff_type: DiffType;
  source_ddl?: string;
  target_ddl?: string;
}

export interface TriggerDiff {
  name: string;
  table_name: string;
  diff_type: DiffType;
  source_ddl?: string;
  target_ddl?: string;
}

export interface ViewDiff {
  name: string;
  diff_type: DiffType;
  source_definition?: string;
  target_definition?: string;
}

export interface SchemaDiffResult {
  source_schema: string;
  target_schema: string;
  tables: TableDiff[];
  routines: RoutineDiff[];
  triggers: TriggerDiff[];
  views: ViewDiff[];
  total_differences: number;
}

export interface MigrationStatement {
  sql: string;
  description: string;
  is_destructive: boolean;
  danger_level: DangerLevel;
  target_object: string;
}

export interface MigrationPlan {
  source_schema: string;
  target_schema: string;
  statements: MigrationStatement[];
  full_sql: string;
  warnings: string[];
  total_statements: number;
}

// ─── Phase 7: Table Inspector, Operations, Diagnostics & Assistant ───────────

export interface TableExtendedStats {
  table_name: string;
  database_name: string;
  engine: string;
  row_format?: string;
  table_rows: number;
  avg_row_length: number;
  data_length: number;
  index_length: number;
  data_free: number;
  auto_increment?: number;
  create_time?: string;
  update_time?: string;
  check_time?: string;
  collation?: string;
  comment?: string;
}

export interface TableInspectorDetails {
  structure: ColumnMetadata[];
  indexes: IndexMetadata[];
  foreign_keys: ForeignKeyMetadata[];
  triggers: TriggerMetadata[];
  statistics: TableExtendedStats;
  ddl: string;
}

export interface TableOperationResult {
  database: string;
  table: string;
  operation: string;
  msg_type: string;
  msg_text: string;
  duration_ms: number;
}

export interface SqlDiagnosticResult {
  original_error: string;
  error_code?: number;
  sqlstate?: string;
  message: string;
  error_position?: number;
  category: string;
  suggested_action: string;
  explanation: string;
  documentation_link?: string;
}

export interface SqlAssistantDiagnosis {
  sql: string;
  is_valid_syntax: boolean;
  issues: string[];
  suggested_indexes: string[];
  suggested_query_rewrite?: string;
  explanation: string;
}

export interface AiDatabaseContext {
  database_name: string;
  server_version: string;
  selected_tables_ddl: string[];
  query?: string;
  explain_plan?: ExplainRow[];
  error_message?: string;
  include_indexes: boolean;
  table_statistics?: string;
}

export interface SlowLogEntry {
  start_time: string;
  user_host: string;
  query_time_seconds: number;
  lock_time_seconds: number;
  rows_sent: number;
  rows_examined: number;
  database?: string;
  sql_text: string;
}

export interface PerformanceDigestEntry {
  schema_name?: string;
  digest_text: string;
  exec_count: number;
  sum_timer_wait_sec: number;
  avg_timer_wait_sec: number;
  max_timer_wait_sec: number;
  sum_rows_examined: number;
  sum_rows_sent: number;
  sum_no_index_used: number;
  first_seen?: string;
  last_seen?: string;
}

export interface RunningProcessEntry {
  id: number;
  user: string;
  host: string;
  db?: string;
  command: string;
  time_seconds: number;
  state?: string;
  info: string;
}

export interface ServerSlowQueriesReport {
  is_slow_log_enabled: boolean;
  log_output: string;
  long_query_time: number;
  slow_log_file?: string;
  log_queries_not_using_indexes: boolean;
  slow_log_entries: SlowLogEntry[];
  performance_digest_entries: PerformanceDigestEntry[];
  running_queries: RunningProcessEntry[];
  total_server_slow_queries_count: number;
}

export interface TableDetailedStats {
  name: string;
  table_type: string;
  engine?: string;
  rows_count: number;
  data_bytes: number;
  index_bytes: number;
  total_bytes: number;
  data_free_bytes: number;
  auto_increment?: number;
  collation?: string;
  create_time?: string;
  update_time?: string;
  comment?: string;
}

export interface DatabaseTablesOverview {
  database_name: string;
  tables_count: number;
  views_count: number;
  total_rows: number;
  total_data_bytes: number;
  total_index_bytes: number;
  total_bytes: number;
  total_free_bytes: number;
  tables: TableDetailedStats[];
}

export interface SqlDumpRequest {
  database: string;
  tables?: string[];
  export_mode: "structure_and_data" | "structure_only" | "data_only";
  include_drop_table: boolean;
  include_routines: boolean;
  include_triggers: boolean;
  include_views: boolean;
  include_create_database?: boolean;
  insert_batch_size?: number;
  output_file_path?: string;
}

export interface SqlDumpSummary {
  database: string;
  tables_exported: string[];
  total_tables: number;
  total_views: number;
  total_routines: number;
  total_triggers: number;
  total_rows_exported: number;
  file_path?: string;
  file_size_bytes: number;
  duration_ms: number;
  sql_preview?: string;
}

export interface SqlRestoreRequest {
  file_path: string;
  target_database: string;
  create_database_if_not_exists: boolean;
  stop_on_error: boolean;
  disable_foreign_keys: boolean;
}

export interface SqlRestoreProgressEvent {
  stage: string;
  bytes_read: number;
  total_bytes: number;
  statements_executed: number;
  current_statement_preview: string;
  percent_complete: number;
}

export interface SqlRestoreSummary {
  target_database: string;
  total_statements: number;
  successful_statements: number;
  failed_statements: number;
  errors: string[];
  duration_ms: number;
  bytes_processed: number;
}

// ─── Phase 4: AI Intelligence & Automation Types ────────────────────────────

export type AiProviderType =
  | "gemini"
  | "openai"
  | "openrouter"
  | "anthropic"
  | "ollama"
  | "mock"
  | "none";

export interface ProviderSpecificConfig {
  model: string;
  custom_endpoint?: string;
  temperature?: number;
  max_tokens?: number;
}

export interface AiConfig {
  enabled: boolean;
  provider: AiProviderType;
  model: string;
  credential_id?: string;
  temperature?: number;
  max_tokens?: number;
  custom_endpoint?: string;
  privacy_mode: boolean;
  providers?: Partial<Record<AiProviderType, ProviderSpecificConfig>>;
}

export interface AiCompletionResponse {
  content: string;
  tool_calls: Array<{ id: string; name: string; arguments: any }>;
  finish_reason: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  latency_ms: number;
  provider: string;
  model: string;
}

export interface SqlExplanationResult {
  sql: string;
  summary: string;
  tables_involved: string[];
  joins_explanation?: string;
  filters_explanation?: string;
  index_usage_explanation?: string;
  potential_issues: string[];
  full_markdown: string;
}

export interface SqlGenerationResult {
  prompt: string;
  generated_sql: string;
  explanation: string;
  tables_used: string[];
}

export interface SqlOptimizationResult {
  original_sql: string;
  suggested_sql: string;
  why: string;
  expected_improvement: string;
  risks: string;
  suggested_indexes: string[];
  full_markdown: string;
}

export interface SqlErrorFixResult {
  original_sql: string;
  error_message: string;
  what_happened: string;
  likely_cause: string;
  how_to_fix: string;
  corrected_sql?: string;
  full_markdown: string;
}

export interface SqlTestCasesResult {
  sql: string;
  test_cases_markdown: string;
  test_queries: string[];
}

export interface SqlDocumentationResult {
  target_name: string;
  markdown_doc: string;
  html_doc: string;
  sql_comments: string;
}

export interface AgentActivityStep {
  step_number: number;
  title: string;
  tool_name?: string;
  status: "running" | "completed" | "error";
  details?: string;
}

export interface ProposedAction {
  title: string;
  sql: string;
  description: string;
  risk_level: "low" | "medium" | "high" | "critical";
  requires_confirmation: boolean;
}

export interface AgentAuditEntry {
  id: string;
  timestamp: string;
  question: string;
  tools_invoked: string[];
  total_steps: number;
  duration_ms: number;
  total_tokens?: number;
  proposed_actions: ProposedAction[];
  summary: string;
}

export interface AgentRunResult {
  question: string;
  final_answer: string;
  activity_steps: AgentActivityStep[];
  proposed_actions: ProposedAction[];
  audit_entry: AgentAuditEntry;
  duration_ms: number;
}

export interface SmartSearchResultItem {
  item_type: "table" | "column" | "index" | "routine" | "trigger";
  database: string;
  table_name?: string;
  name: string;
  data_type?: string;
  comment?: string;
  relevance_score: number;
  snippet: string;
}

export interface SmartSearchResult {
  query: string;
  results: SmartSearchResultItem[];
  ai_suggestion?: string;
}

export interface DatabaseHealthSummaryResult {
  database: string;
  overall_score: number;
  status: string;
  observed_facts: string[];
  ai_interpretation: string;
  priority_actions: string[];
}

export interface MigrationReviewResult {
  summary: string;
  risk_level: "low" | "medium" | "high" | "critical";
  potential_impacts: string[];
  suggested_migration_strategy: string[];
  full_markdown: string;
}

export interface GeneratedReport {
  title: string;
  database: string;
  report_type: "health" | "performance" | "schema" | "security" | "optimization";
  timestamp: string;
  markdown: string;
  html: string;
  json_data: any;
}

export interface DatabaseNote {
  id: string;
  connection_id?: string;
  database: string;
  target_type: "database" | "table" | "column" | "query";
  target_name: string;
  note_text: string;
  updated_at: string;
}



