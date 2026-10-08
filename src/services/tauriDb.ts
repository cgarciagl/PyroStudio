import { invoke } from "@tauri-apps/api/core";
import type {
  AiDatabaseContext,
  CellUpdateRequest,
  ColumnMetadata,
  ConnectionConfig,
  ConnectionStatus,
  CreateIndexRequest,
  DatabaseDashboardInfo,
  DatabaseSchema,
  DatabaseTablesOverview,
  DeleteRowRequest,
  ExcelPreviewData,
  ExportRequest,
  ExportSummary,
  HealthReport,
  ImportRequest,
  ImportSummary,
  IndexAdvisorReport,
  IndexMetadata,
  MigrationPlan,
  PrimaryKey,
  QueryExecutionResult,
  RoutineDetail,
  RoutineMetadata,
  SchemaDiffResult,
  ServerInfo,
  ServerSlowQueriesReport,
  SlowQueryAnalysis,
  SqlAssistantDiagnosis,
  SqlDumpRequest,
  SqlDumpSummary,
  SqlRestoreRequest,
  SqlRestoreSummary,
  SqlSafetyAnalysis,
  TableDataResult,
  TableInspectorDetails,
  TableMetadata,
  TableOperationResult,
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
      name: routineName,
      routineName,
      routine_name: routineName,
      routineType,
      routine_type: routineType,
    });
  },

  async listTriggers(database: string, table?: string): Promise<TriggerMetadata[]> {
    return await safeInvoke<TriggerMetadata[]>("list_triggers", {
      database,
      table,
    });
  },

  async getTriggerDefinition(
    database: string,
    triggerName: string,
  ): Promise<TriggerDetail> {
    return await safeInvoke<TriggerDetail>("get_trigger_definition", {
      database,
      name: triggerName,
      triggerName,
      trigger_name: triggerName,
    });
  },

  async dropRoutine(
    database: string,
    routineName: string,
    routineType: string,
  ): Promise<void> {
    await safeInvoke<void>("drop_routine", {
      database,
      name: routineName,
      routineName,
      routine_name: routineName,
      routineType,
      routine_type: routineType,
    });
  },

  async dropTrigger(database: string, triggerName: string): Promise<void> {
    await safeInvoke<void>("drop_trigger", {
      database,
      name: triggerName,
      triggerName,
      trigger_name: triggerName,
    });
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
      old_name: oldName,
      routineType,
      routine_type: routineType,
      ddl,
    });
  },

  async saveTrigger(
    database: string,
    oldName: string | null,
    ddl: string,
  ): Promise<void> {
    await safeInvoke<void>("save_trigger", {
      database,
      oldName,
      old_name: oldName,
      ddl,
    });
  },

  async executeRoutine(
    database: string,
    routineName: string,
    routineType: string,
    params: any[] | Record<string, any>,
  ): Promise<QueryExecutionResult> {
    let paramsList: any[] = [];
    if (Array.isArray(params)) {
      paramsList = params;
    } else if (params && typeof params === "object") {
      paramsList = Object.values(params);
    }
    return await safeInvoke<QueryExecutionResult>("execute_routine", {
      database,
      name: routineName,
      routineName,
      routine_name: routineName,
      routineType,
      routine_type: routineType,
      params: paramsList,
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
    return await safeInvoke<string | null>("pick_excel_file", {
      dialogTitle,
      dialog_title: dialogTitle,
      title: dialogTitle,
    });
  },

  async saveExcelDialog(defaultFilename?: string): Promise<string | null> {
    return await safeInvoke<string | null>("save_excel_dialog", {
      defaultName: defaultFilename,
      default_name: defaultFilename,
      defaultFilename,
      default_filename: defaultFilename,
    });
  },

  async previewExcelFile(
    filePath: string,
    sheetName?: string,
    maxPreviewRows?: number,
  ): Promise<ExcelPreviewData> {
    return await safeInvoke<ExcelPreviewData>("preview_excel_file", {
      filePath,
      file_path: filePath,
      sheetName,
      sheet_name: sheetName,
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
      file_path: filePath,
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

  // ─── Safe Mode Analysis ───────────────────────────────────────────────────

  async checkSqlSafety(sql: string): Promise<SqlSafetyAnalysis> {
    return await safeInvoke<SqlSafetyAnalysis>("check_sql_safety", { sql });
  },

  // ─── Phase 1: Database Dashboard & Health ──────────────────────────────────

  async getDatabaseDashboard(database: string): Promise<DatabaseDashboardInfo> {
    return await safeInvoke<DatabaseDashboardInfo>("get_database_dashboard", { database });
  },

  async getHealthReport(database: string): Promise<HealthReport> {
    return await safeInvoke<HealthReport>("get_health_report", { database });
  },

  // ─── Phase 2: Slow Query & EXPLAIN Analysis ────────────────────────────────

  async analyzeSlowQuery(
    sql: string,
    database?: string,
  ): Promise<SlowQueryAnalysis> {
    return await safeInvoke<SlowQueryAnalysis>("analyze_slow_query", {
      sql,
      database,
    });
  },

  // ─── Phase 3: Index Advisor ────────────────────────────────────────────────

  async analyzeDatabaseIndexes(database: string): Promise<IndexAdvisorReport> {
    return await safeInvoke<IndexAdvisorReport>("analyze_database_indexes", { database });
  },

  // ─── Phase 4, 5, 6: Schema Diff & Migrations ───────────────────────────────

  async compareSchemas(
    sourceDatabase: string,
    targetDatabase: string,
  ): Promise<SchemaDiffResult> {
    return await safeInvoke<SchemaDiffResult>("compare_schemas", {
      sourceDatabase,
      source_database: sourceDatabase,
      targetDatabase,
      target_database: targetDatabase,
    });
  },

  async compareCrossConnectionSchemas(
    sourceConfig: ConnectionConfig,
    sourceDatabase: string,
    targetConfig: ConnectionConfig,
    targetDatabase: string,
  ): Promise<SchemaDiffResult> {
    return await safeInvoke<SchemaDiffResult>("compare_cross_connection_schemas", {
      sourceConfig,
      source_config: sourceConfig,
      sourceDatabase,
      source_database: sourceDatabase,
      targetConfig,
      target_config: targetConfig,
      targetDatabase,
      target_database: targetDatabase,
    });
  },

  async generateMigrationPlan(diff: SchemaDiffResult): Promise<MigrationPlan> {
    return await safeInvoke<MigrationPlan>("generate_migration_plan", { diff });
  },

  // ─── Phase 7: Table Inspector, Operations & Assistant ──────────────────────

  async getTableInspectorDetails(
    database: string,
    table: string,
  ): Promise<TableInspectorDetails> {
    return await safeInvoke<TableInspectorDetails>("get_table_inspector_details", {
      database,
      table,
    });
  },

  async executeTableOperation(
    database: string,
    table: string,
    operation: "ANALYZE" | "OPTIMIZE" | "CHECK" | "REPAIR" | "CHECKSUM",
  ): Promise<TableOperationResult> {
    return await safeInvoke<TableOperationResult>("execute_table_operation", {
      database,
      table,
      operation,
    });
  },

  async executeMaintenanceFlush(flushType: "TABLES" | "PRIVILEGES" | "STATUS"): Promise<string> {
    return await safeInvoke<string>("execute_maintenance_flush", {
      flushType,
      flush_type: flushType,
    });
  },

  async diagnoseQueryWithMetadata(
    sql: string,
    database?: string,
  ): Promise<SqlAssistantDiagnosis> {
    return await safeInvoke<SqlAssistantDiagnosis>("diagnose_query_with_metadata", {
      sql,
      database,
    });
  },

  async buildSanitizedAiContext(
    database: string,
    tables: string[],
    query?: string,
    errorMessage?: string,
    includeIndexes: boolean = true,
  ): Promise<AiDatabaseContext> {
    return await safeInvoke<AiDatabaseContext>("build_sanitized_ai_context", {
      database,
      tables,
      query,
      errorMessage,
      error_message: errorMessage,
      includeIndexes,
      include_indexes: includeIndexes,
    });
  },

  async getServerSlowQueries(database?: string): Promise<ServerSlowQueriesReport> {
    return await safeInvoke<ServerSlowQueriesReport>("get_server_slow_queries", {
      database,
    });
  },

  async getDatabaseTablesOverview(database: string): Promise<DatabaseTablesOverview> {
    return await safeInvoke<DatabaseTablesOverview>("get_database_tables_overview", {
      database,
    });
  },

  async exportSqlDump(req: SqlDumpRequest): Promise<SqlDumpSummary> {
    return await safeInvoke<SqlDumpSummary>("export_sql_dump", {
      req,
      request: req,
    });
  },

  async saveSqlDialog(defaultName?: string): Promise<string | null> {
    return await safeInvoke<string | null>("save_sql_dialog", {
      defaultName,
      default_name: defaultName,
    });
  },

  async openSqlDialog(): Promise<string | null> {
    return await safeInvoke<string | null>("open_sql_dialog");
  },

  async executeSqlRestore(req: SqlRestoreRequest): Promise<SqlRestoreSummary> {
    return await safeInvoke<SqlRestoreSummary>("execute_sql_restore", {
      req,
      request: req,
    });
  },
};



