import { invoke } from "@tauri-apps/api/core";
import type {
  CellUpdateRequest,
  ColumnMetadata,
  ConnectionConfig,
  ConnectionStatus,
  CreateIndexRequest,
  DatabaseSchema,
  ExcelPreviewData,
  ExportRequest,
  ExportSummary,
  ImportRequest,
  ImportSummary,
  IndexMetadata,
  QueryExecutionResult,
  RoutineDetail,
  RoutineMetadata,
  ServerInfo,
  TableDataResult,
  TableMetadata,
  TriggerDetail,
  TriggerMetadata,
} from "../types/database";

const isTauriEnv = (): boolean => {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
};

export const dbService = {
  async testConnection(config: ConnectionConfig): Promise<ServerInfo> {
    if (!isTauriEnv()) {
      // Mock for browser testing
      await new Promise((r) => setTimeout(r, 600));
      return {
        version: "10.11.8-MariaDB-log",
        current_user: `${config.user}@${config.host}`,
        current_database: config.database || undefined,
        ping_ms: 14,
      };
    }
    return await invoke<ServerInfo>("test_connection", { config });
  },

  async connect(config: ConnectionConfig): Promise<ServerInfo> {
    if (!isTauriEnv()) {
      await new Promise((r) => setTimeout(r, 700));
      return {
        version: "10.11.8-MariaDB-log",
        current_user: `${config.user}@${config.host}`,
        current_database: config.database || undefined,
        ping_ms: 12,
      };
    }
    return await invoke<ServerInfo>("connect_db", { config });
  },

  async disconnect(): Promise<void> {
    if (!isTauriEnv()) return;
    await invoke<void>("disconnect_db");
  },

  async getConnectionStatus(): Promise<ConnectionStatus> {
    if (!isTauriEnv()) {
      return { is_connected: false };
    }
    return await invoke<ConnectionStatus>("get_connection_status");
  },

  async listDatabases(): Promise<DatabaseSchema[]> {
    if (!isTauriEnv()) {
      return [
        { name: "information_schema", tables_count: 78 },
        { name: "institucion_escolar", tables_count: 14 },
        { name: "matriculas_2026", tables_count: 8 },
        { name: "mysql", tables_count: 35 },
        { name: "performance_schema", tables_count: 52 },
        { name: "sys", tables_count: 100 },
      ];
    }
    return await invoke<DatabaseSchema[]>("list_databases");
  },

  async listTables(database: string): Promise<TableMetadata[]> {
    if (!isTauriEnv()) {
      return [
        {
          name: "estudiantes",
          table_type: "BASE TABLE",
          engine: "InnoDB",
          rows_count: 15420,
          data_length: 2097152,
          collation: "utf8mb4_unicode_ci",
          comment: "Padrón general de alumnos matriculados",
        },
        {
          name: "matriculas",
          table_type: "BASE TABLE",
          engine: "InnoDB",
          rows_count: 24890,
          data_length: 3145728,
          collation: "utf8mb4_unicode_ci",
          comment: "Historial de inscripciones por ciclo",
        },
        {
          name: "cursos",
          table_type: "BASE TABLE",
          engine: "InnoDB",
          rows_count: 120,
          data_length: 65536,
          collation: "utf8mb4_unicode_ci",
          comment: "Catálogo de asignaturas",
        },
        {
          name: "calificaciones",
          table_type: "BASE TABLE",
          engine: "InnoDB",
          rows_count: 85200,
          data_length: 8388608,
          collation: "utf8mb4_unicode_ci",
          comment: "Notas parciales y finales",
        },
        {
          name: "vw_resumen_matriculados",
          table_type: "VIEW",
          rows_count: 0,
          comment: "Vista consolidada de matrículas activas",
        },
      ];
    }
    return await invoke<TableMetadata[]>("list_tables", { database });
  },

  async getTableColumns(
    database: string,
    table: string,
  ): Promise<ColumnMetadata[]> {
    if (!isTauriEnv()) {
      return [
        {
          name: "id",
          ordinal_position: 1,
          column_default: undefined,
          is_nullable: false,
          data_type: "bigint",
          column_type: "bigint(20) unsigned",
          column_key: "PRI",
          extra: "auto_increment",
          comment: "Identificador único",
        },
        {
          name: "codigo_estudiante",
          ordinal_position: 2,
          column_default: undefined,
          is_nullable: false,
          data_type: "varchar",
          column_type: "varchar(20)",
          column_key: "UNI",
          extra: "",
          comment: "Carnet institucional",
        },
        {
          name: "nombres",
          ordinal_position: 3,
          column_default: undefined,
          is_nullable: false,
          data_type: "varchar",
          column_type: "varchar(100)",
          column_key: "",
          extra: "",
          comment: "Nombres",
        },
        {
          name: "apellidos",
          ordinal_position: 4,
          column_default: undefined,
          is_nullable: false,
          data_type: "varchar",
          column_type: "varchar(100)",
          column_key: "",
          extra: "",
          comment: "Apellidos",
        },
        {
          name: "fecha_registro",
          ordinal_position: 5,
          column_default: "current_timestamp()",
          is_nullable: false,
          data_type: "timestamp",
          column_type: "timestamp",
          column_key: "",
          extra: "DEFAULT_GENERATED",
          comment: "Auditoría de alta",
        },
      ];
    }
    return await invoke<ColumnMetadata[]>("get_table_columns", {
      database,
      table,
    });
  },

  async dropTable(database: string, table: string): Promise<void> {
    if (!isTauriEnv()) return;
    await invoke<void>("drop_table", { database, table });
  },

  async truncateTable(database: string, table: string): Promise<void> {
    if (!isTauriEnv()) return;
    await invoke<void>("truncate_table", { database, table });
  },

  async queryTableData(
    database: string,
    table: string,
    limit = 1000,
    offset = 0,
  ): Promise<TableDataResult> {
    if (!isTauriEnv()) {
      await new Promise((r) => setTimeout(r, 120));
      const cols = ["id", "codigo_estudiante", "nombres", "apellidos", "ciclo", "promedio", "fecha_registro"];
      const colTypes = ["BIGINT", "VARCHAR", "VARCHAR", "VARCHAR", "INT", "DECIMAL", "TIMESTAMP"];
      const sampleNames = ["Carlos", "María", "Alejandro", "Lucía", "Mateo", "Valentina", "Sebastián", "Camila", "Daniel", "Sofía"];
      const sampleLast = ["Hernández", "García", "López", "Martínez", "Rodríguez", "González", "Pérez", "Sánchez", "Torres", "Ramírez"];

      const rows: any[][] = [];
      const effectiveCount = Math.min(limit, 1000);
      for (let i = 0; i < effectiveCount; i++) {
        const id = offset + i + 1;
        const fn = sampleNames[i % sampleNames.length];
        const ln = sampleLast[(i * 3) % sampleLast.length];
        const grade = (7.5 + ((i * 17) % 25) / 10).toFixed(2);
        rows.push([
          id,
          `EST-2026-${String(id).padStart(5, "0")}`,
          fn,
          ln,
          (i % 10) + 1,
          grade,
          `2026-02-${String((i % 28) + 1).padStart(2, "0")} 08:30:00`,
        ]);
      }

      return {
        columns: cols,
        column_types: colTypes,
        rows,
        total_rows: 15420,
        execution_time_ms: 18,
        limit,
        offset,
      };
    }
    return await invoke<TableDataResult>("query_table_data", {
      database,
      table,
      limit,
      offset,
    });
  },

  async updateCell(req: CellUpdateRequest): Promise<void> {
    if (!isTauriEnv()) {
      await new Promise((r) => setTimeout(r, 80));
      return;
    }
    await invoke<void>("update_cell", { req });
  },

  async executeQuery(
    sql: string,
    database?: string,
  ): Promise<QueryExecutionResult> {
    if (!isTauriEnv()) {
      await new Promise((r) => setTimeout(r, 150));
      return {
        columns: ["resultado"],
        rows: [["Consulta ejecutada en modo vista previa"]],
        affected_rows: 1,
        execution_time_ms: 15,
        message: "1 fila(s) retornada(s) en 15 ms",
      };
    }
    return await invoke<QueryExecutionResult>("execute_query", {
      sql,
      database,
    });
  },

  async listRoutines(
    database: string,
    routineType?: string,
  ): Promise<RoutineMetadata[]> {
    if (!isTauriEnv()) {
      return [
        {
          name: "sp_calcular_promedio",
          routine_type: "PROCEDURE",
          definer: "root@localhost",
          created: "2026-01-10 10:00:00",
          last_altered: "2026-01-10 10:00:00",
          security_type: "DEFINER",
          comment: "Calcula el promedio ponderado de un alumno",
        },
        {
          name: "fn_obtener_estado_matricula",
          routine_type: "FUNCTION",
          data_type: "VARCHAR(50)",
          definer: "root@localhost",
          created: "2026-01-15 14:30:00",
          last_altered: "2026-01-15 14:30:00",
          security_type: "DEFINER",
          comment: "Retorna el estado de la matrícula",
        },
      ];
    }
    return await invoke<RoutineMetadata[]>("list_routines", {
      database,
      routineType,
    });
  },

  async getRoutineDefinition(
    database: string,
    name: string,
    routineType: string,
  ): Promise<RoutineDetail> {
    if (!isTauriEnv()) {
      return {
        name,
        routine_type: routineType as any,
        ddl:
          routineType === "PROCEDURE"
            ? `CREATE PROCEDURE \`${name}\`(IN p_student_id INT, OUT p_avg DECIMAL(5,2))\nBEGIN\n  SELECT AVG(calificacion) INTO p_avg FROM calificaciones WHERE student_id = p_student_id;\nEND`
            : `CREATE FUNCTION \`${name}\`(p_id INT) RETURNS VARCHAR(50)\nBEGIN\n  DECLARE v_res VARCHAR(50);\n  SET v_res = 'Activo';\n  RETURN v_res;\nEND`,
        params: [
          { mode: "IN", name: "p_student_id", data_type: "INT" },
          { mode: "OUT", name: "p_avg", data_type: "DECIMAL(5,2)" },
        ],
      };
    }
    return await invoke<RoutineDetail>("get_routine_definition", {
      database,
      name,
      routineType,
    });
  },

  async listTriggers(
    database: string,
    table?: string,
  ): Promise<TriggerMetadata[]> {
    if (!isTauriEnv()) {
      return [
        {
          name: "trg_before_insert_matricula",
          table_name: "matriculas",
          timing: "BEFORE",
          event: "INSERT",
          definer: "root@localhost",
          created: "2026-01-12 09:00:00",
        },
      ];
    }
    return await invoke<TriggerMetadata[]>("list_triggers", {
      database,
      table,
    });
  },

  async getTriggerDefinition(
    database: string,
    name: string,
  ): Promise<TriggerDetail> {
    if (!isTauriEnv()) {
      return {
        name,
        table_name: "matriculas",
        timing: "BEFORE",
        event: "INSERT",
        ddl: `CREATE TRIGGER \`${name}\` BEFORE INSERT ON \`matriculas\` FOR EACH ROW\nBEGIN\n  IF NEW.fecha_creacion IS NULL THEN\n    SET NEW.fecha_creacion = NOW();\n  END IF;\nEND`,
      };
    }
    return await invoke<TriggerDetail>("get_trigger_definition", {
      database,
      name,
    });
  },

  async dropRoutine(
    database: string,
    name: string,
    routineType: string,
  ): Promise<void> {
    if (!isTauriEnv()) return;
    await invoke<void>("drop_routine", {
      database,
      name,
      routineType,
    });
  },

  async dropTrigger(database: string, name: string): Promise<void> {
    if (!isTauriEnv()) return;
    await invoke<void>("drop_trigger", {
      database,
      name,
    });
  },

  async saveRoutine(
    database: string,
    oldName: string | null,
    routineType: string,
    ddl: string,
  ): Promise<void> {
    if (!isTauriEnv()) return;
    await invoke<void>("save_routine", {
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
    if (!isTauriEnv()) return;
    await invoke<void>("save_trigger", {
      database,
      oldName,
      ddl,
    });
  },

  async executeRoutine(
    database: string,
    name: string,
    routineType: string,
    params: any[],
  ): Promise<QueryExecutionResult> {
    if (!isTauriEnv()) {
      return {
        columns: ["Resultado"],
        rows: [["OK"]],
        affected_rows: 1,
        execution_time_ms: 10,
        message: "Rutina ejecutada correctamente",
      };
    }
    return await invoke<QueryExecutionResult>("execute_routine", {
      database,
      name,
      routineType,
      params,
    });
  },

  async pickExcelFile(): Promise<string | null> {
    if (!isTauriEnv()) {
      return "c:/institucion/matriculas_2026.xlsx";
    }
    return await invoke<string | null>("pick_excel_file");
  },

  async saveExcelDialog(defaultName: string): Promise<string | null> {
    if (!isTauriEnv()) {
      return `c:/descargas/${defaultName}`;
    }
    return await invoke<string | null>("save_excel_dialog", { defaultName });
  },

  async previewExcelFile(
    filePath: string,
    sheetName?: string,
  ): Promise<ExcelPreviewData> {
    if (!isTauriEnv()) {
      await new Promise((r) => setTimeout(r, 200));
      return {
        file_path: filePath,
        sheets: ["Matrículas 2026", "Catálogo Carreras", "Resumen"],
        selected_sheet: sheetName || "Matrículas 2026",
        headers: [
          "Código Estudiante",
          "Nombres",
          "Apellidos",
          "Ciclo Académico",
          "Promedio Ponderado",
          "Fecha Alta",
        ],
        preview_rows: [
          ["EST-00101", "María Fernanda", "Gómez Salas", 1, 9.45, "2026-02-01"],
          ["EST-00102", "Juan Pablo", "Vásquez Ruiz", 2, 8.7, "2026-02-02"],
          ["EST-00103", "Luciana", "Peralta Mora", 1, 9.1, "2026-02-03"],
          ["EST-00104", "Rodrigo", "Castillo Flores", 3, 7.8, "2026-02-04"],
          ["EST-00105", "Andrea Carolina", "Ríos Medina", 2, 8.95, "2026-02-05"],
        ],
        total_rows: 15420,
      };
    }
    return await invoke<ExcelPreviewData>("preview_excel_file", {
      filePath,
      sheetName,
    });
  },

  async importExcelFile(req: ImportRequest): Promise<ImportSummary> {
    if (!isTauriEnv()) {
      await new Promise((r) => setTimeout(r, 1200));
      return {
        total_processed: 15420,
        successful_rows: 15418,
        failed_rows: 2,
        execution_time_ms: 840,
        errors: [
          {
            row_index: 342,
            error_message: "Data truncation: Out of range value for column 'ciclo'",
          },
          {
            row_index: 1209,
            error_message: "Duplicate entry 'EST-00102' for key 'codigo_estudiante'",
          },
        ],
      };
    }
    return await invoke<ImportSummary>("import_excel_file", { req });
  },

  async exportExcelFile(req: ExportRequest): Promise<ExportSummary> {
    if (!isTauriEnv()) {
      await new Promise((r) => setTimeout(r, 800));
      return {
        file_path: req.file_path || `c:/descargas/${req.table}.xlsx`,
        total_rows: 15420,
        execution_time_ms: 620,
        file_size_bytes: 1425890,
      };
    }
    return await invoke<ExportSummary>("export_excel_file", { req });
  },

  async exportDataset(
    columns: string[],
    rows: any[][],
    filePath: string,
  ): Promise<ExportSummary> {
    if (!isTauriEnv()) {
      await new Promise((r) => setTimeout(r, 600));
      return {
        file_path: filePath,
        total_rows: rows.length,
        execution_time_ms: 120,
        file_size_bytes: 54000,
      };
    }
    return await invoke<ExportSummary>("export_dataset_file", {
      columns,
      rows,
      filePath,
    });
  },

  // ─── Index management ─────────────────────────────────────────────────────

  async listIndexes(database: string, table: string): Promise<IndexMetadata[]> {
    if (!isTauriEnv()) return [];
    return await invoke<IndexMetadata[]>("list_indexes", { database, table });
  },

  async createIndex(req: CreateIndexRequest): Promise<void> {
    if (!isTauriEnv()) return;
    return await invoke<void>("create_index", { req });
  },

  async dropIndex(
    database: string,
    table: string,
    indexName: string,
  ): Promise<void> {
    if (!isTauriEnv()) return;
    return await invoke<void>("drop_index", { database, table, indexName });
  },
};
