export type EnvironmentTag = "local" | "development" | "staging" | "production";

export interface HttpTunnelConfig {
  enabled: boolean;
  url: string;
  http_user?: string;
  http_password?: string;
  encode_base64?: boolean;
}

export interface SavedConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  password?: string;
  database?: string;
  environment?: EnvironmentTag;
  colorTag?: string;
  tunnel?: HttpTunnelConfig;
  createdAt: number;
  lastConnectedAt?: number;
}

export interface ConnectionConfig {
  host: string;
  port: number;
  user: string;
  password?: string;
  database?: string;
  tunnel?: HttpTunnelConfig;
  savedConnectionId?: string;
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
  config?: ConnectionConfig;
  server_info?: ServerInfo;
}

export interface OpenTab {
  id: string;
  title: string;
  type: "table" | "query" | "columns" | "routine" | "trigger";
  database: string;
  tableName?: string;
  queryContent?: string;
  routineName?: string;
  routineType?: "PROCEDURE" | "FUNCTION";
  triggerName?: string;
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

export interface CellUpdateRequest {
  database: string;
  table: string;
  primary_key_column: string;
  primary_key_value: any;
  column_name: string;
  new_value: any;
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
}

export interface ImportErrorDetail {
  row_index: number;
  error_message: string;
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
