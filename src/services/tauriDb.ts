import { invoke } from "@tauri-apps/api/core";
import type {
  CellUpdateRequest,
  ColumnMetadata,
  ConnectionConfig,
  ConnectionStatus,
  CreateIndexRequest,
  DatabaseSchema,
  DeleteRowRequest,
  ExcelPreviewData,
  ExportRequest,
  ExportSummary,
  ImportRequest,
  ImportSummary,
  IndexMetadata,
  PrimaryKey,
  QueryExecutionResult,
  RoutineDetail,
  RoutineMetadata,
  ServerInfo,
  TableDataResult,
  TableMetadata,
  TriggerDetail,
  TriggerMetadata,
} from "../types/database";

export const isTauriEnvironment = (): boolean => {
  if (typeof window === "undefined") return false;
  return Boolean(
    (window as any).__TAURI_INTERNALS__ ||
    (window as any).__TAURI__ ||
    (window as any).isTauri
  );
};

const safeInvoke = async <T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> => {
  if (!isTauriEnvironment()) {
    throw new Error(
      "PyroStudio requiere el runtime nativo de Tauri para comunicarse con el backend y bases de datos. " +
      "Estás abriendo la interfaz en un navegador web convencional. " +
      "Para desarrollo nativo ejecuta 'npm run tauri dev' en la terminal o ejecuta 'PyroStudio.exe'."
    );
  }
  return await invoke<T>(cmd, args);
};

export const dbService = {
  // ─── Connection & Session ──────────────────────────────────────────────────

  async testConnection(config: ConnectionConfig): Promise<ServerInfo> {
    return await safeInvoke<ServerInfo>("test_connection", { config });
  },

  async connect(config: ConnectionConfig): Promise<ServerInfo> {
    return await safeInvoke<ServerInfo>("connect_db", { config });
  },

  async disconnect(): Promise<void> {
    await safeInvoke<void>("disconnect_db");
  },

  async getConnectionStatus(): Promise<ConnectionStatus> {
    return await safeInvoke<ConnectionStatus>("get_connection_status");
  },

  // ─── Databases & Tables ────────────────────────────────────────────────────

  async listDatabases(): Promise<DatabaseSchema[]> {
    return await safeInvoke<DatabaseSchema[]>("list_databases");
  },

  async listTables(database: string): Promise<TableMetadata[]> {
    return await safeInvoke<TableMetadata[]>("list_tables", { database });
  },

  async getTableColumns(
    database: string,
    table: string,
  ): Promise<ColumnMetadata[]> {
    return await safeInvoke<ColumnMetadata[]>("get_table_columns", { database, table });
  },

  async getTablePrimaryKey(
    database: string,
    table: string,
  ): Promise<PrimaryKey> {
    return await safeInvoke<PrimaryKey>("get_table_primary_key", { database, table });
  },

  async dropTable(database: string, table: string): Promise<void> {
    await safeInvoke<void>("drop_table", { database, table });
  },

  async truncateTable(database: string, table: string): Promise<void> {
    await safeInvoke<void>("truncate_table", { database, table });
  },

  async queryTableData(
    database: string,
    table: string,
    limit: number = 100,
    offset: number = 0,
    orderBy?: string,
    orderDir?: "ASC" | "DESC",
  ): Promise<TableDataResult> {
    return await safeInvoke<TableDataResult>("query_table_data", {
      database,
      table,
      limit,
      offset,
      orderBy,
      orderDir,
    });
  },

  async updateCell(req: CellUpdateRequest): Promise<void> {
    await safeInvoke<void>("update_cell", { req });
  },

  async deleteRow(req: DeleteRowRequest): Promise<void> {
    await safeInvoke<void>("delete_row", { req });
  },

  // ─── Query execution ───────────────────────────────────────────────────────

  async executeQuery(
    sql: string,
    database?: string,
  ): Promise<QueryExecutionResult> {
    return await safeInvoke<QueryExecutionResult>("execute_query", {
      sql,
      database,
    });
  },

  // ─── Routines & Triggers ───────────────────────────────────────────────────

  async listRoutines(
    database: string,
    routineType?: string,
  ): Promise<RoutineMetadata[]> {
    return await safeInvoke<RoutineMetadata[]>("list_routines", {
      database,
      routineType,
    });
  },

  async getRoutineDefinition(
    database: string,
    routineName: string,
    routineType: string,
  ): Promise<RoutineDetail> {
    return await safeInvoke<RoutineDetail>("get_routine_definition", {
      database,
      routineName,
      routineType,
    });
  },

  async listTriggers(database: string): Promise<TriggerMetadata[]> {
    return await safeInvoke<TriggerMetadata[]>("list_triggers", { database });
  },

  async getTriggerDefinition(
    database: string,
    triggerName: string,
  ): Promise<TriggerDetail> {
    return await safeInvoke<TriggerDetail>("get_trigger_definition", {
      database,
      triggerName,
    });
  },

  async dropRoutine(
    database: string,
    routineName: string,
    routineType: string,
  ): Promise<void> {
    await safeInvoke<void>("drop_routine", { database, routineName, routineType });
  },

  async dropTrigger(database: string, triggerName: string): Promise<void> {
    await safeInvoke<void>("drop_trigger", { database, triggerName });
  },

  async saveRoutine(
    database: string,
    oldName: string | null,
    routineType: string,
    ddl: string,
  ): Promise<void> {
    await safeInvoke<void>("save_routine", {
      database,
      oldName,
      routineType,
      ddl,
    });
  },

  async saveTrigger(
    database: string,
    oldName: string | null,
    ddl: string,
  ): Promise<void> {
    await safeInvoke<void>("save_trigger", { database, oldName, ddl });
  },

  async executeRoutine(
    database: string,
    routineName: string,
    routineType: string,
    params: Record<string, any>,
  ): Promise<QueryExecutionResult> {
    return await safeInvoke<QueryExecutionResult>("execute_routine", {
      database,
      routineName,
      routineType,
      params,
    });
  },

  // ─── Secure Credential Vault (P0.1, P0.2) ──────────────────────────────────

  async saveCredential(id: string, secret: string): Promise<void> {
    await safeInvoke<void>("save_credential", { id, secret });
  },

  async getCredential(id: string): Promise<boolean> {
    return await safeInvoke<boolean>("get_credential", { id });
  },

  async hasCredential(id: string): Promise<boolean> {
    return await safeInvoke<boolean>("has_credential", { id });
  },

  async deleteCredential(id: string): Promise<void> {
    await safeInvoke<void>("delete_credential", { id });
  },

  // ─── Excel engine ─────────────────────────────────────────────────────────

  async pickExcelFile(dialogTitle?: string): Promise<string | null> {
    return await safeInvoke<string | null>("pick_excel_file", { dialogTitle });
  },

  async saveExcelDialog(defaultFilename?: string): Promise<string | null> {
    return await safeInvoke<string | null>("save_excel_dialog", { defaultFilename });
  },

  async previewExcelFile(
    filePath: string,
    sheetName?: string,
    maxPreviewRows?: number,
  ): Promise<ExcelPreviewData> {
    return await safeInvoke<ExcelPreviewData>("preview_excel_file", {
      filePath,
      sheetName,
      maxPreviewRows,
    });
  },

  async importExcelFile(req: ImportRequest): Promise<ImportSummary> {
    return await safeInvoke<ImportSummary>("import_excel_file", { req });
  },

  async exportExcelFile(req: ExportRequest): Promise<ExportSummary> {
    return await safeInvoke<ExportSummary>("export_excel_file", { req });
  },

  async exportDataset(
    columns: string[],
    rows: any[][],
    filePath: string,
  ): Promise<ExportSummary> {
    return await safeInvoke<ExportSummary>("export_dataset_file", {
      columns,
      rows,
      filePath,
    });
  },

  // ─── Index management ─────────────────────────────────────────────────────

  async listIndexes(database: string, table: string): Promise<IndexMetadata[]> {
    return await safeInvoke<IndexMetadata[]>("list_indexes", { database, table });
  },

  async createIndex(req: CreateIndexRequest): Promise<void> {
    await safeInvoke<void>("create_index", { req });
  },

  async dropIndex(
    database: string,
    table: string,
    indexName: string,
  ): Promise<void> {
    await safeInvoke<void>("drop_index", { database, table, indexName });
  },
};
