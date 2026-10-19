import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import CodeMirror, { type EditorView } from "@uiw/react-codemirror";
import { sql, MySQL } from "@codemirror/lang-sql";
import { completeFromList } from "@codemirror/autocomplete";
import { useSchemaStore } from "../stores/schemaStore";
import { resolveExecutionTarget, type ExecutionTargetMode } from "../services/sqlStatementExtractor";
import { DataGridCanvas } from "./DataGridCanvas";
import {
  Play,
  Terminal,
  CheckCircle2,
  AlertCircle,
  Database,
  Loader2,
  Activity,
  Table as TableIcon,
  FileSpreadsheet,
  Key,
  Shield,
  ShieldAlert,
  History,
  Star,
  Square,
  Sparkles,
  Bug,
  Lightbulb,
  Copy,
  Check,
  Clock,
  ChevronDown,
  Eye,
} from "lucide-react";

import { dbService } from "../services/tauriDb";
import { queryHistoryStorage } from "../services/queryHistoryStorage";
import { diagnoseSqlError } from "../services/sqlDiagnostics";
import { usePreferenceStore } from "../stores/preferenceStore";
import { useConnectionStore } from "../stores/connectionStore";
import { useUIStore } from "../stores/uiStore";
import { useStagedChangesStore } from "../stores/stagedChangesStore";
import type {
  QueryExecutionResult,
  ExportProgressEvent,
  SqlSafetyAnalysis,
  SlowQueryAnalysis,
} from "../types/database";
import { QueryPlanViewer } from "./QueryPlanViewer";
import { SafeExecutionModal } from "./SafeExecutionModal";
import { QueryHistoryModal } from "./QueryHistoryModal";
import { FavoritesModal } from "./FavoritesModal";
import { SqlCopilotDrawer, type CopilotActionType } from "./SqlCopilotDrawer";
import { SqlVariablesModal, extractSqlVariables } from "./SqlVariablesModal";

type ExecutionState = "idle" | "executing" | "success" | "error" | "cancelled";

interface QueryEditorTabProps {
  database: string;
  initialQuery?: string;
  onQueryChange?: (newQuery: string) => void;
}

export const QueryEditorTab: React.FC<QueryEditorTabProps> = ({
  database,
  initialQuery = "SELECT * FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() LIMIT 100;",
  onQueryChange,
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [executionState, setExecutionState] = useState<ExecutionState>("idle");
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const [copilotAction, setCopilotAction] = useState<CopilotActionType>("menu");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isExplaining, setIsExplaining] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [result, setResult] = useState<QueryExecutionResult | null>(null);
  const [resultSql, setResultSql] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<ExportProgressEvent | null>(null);
  const [explainResult, setExplainResult] = useState<QueryExecutionResult | null>(null);
  const [explainAnalysis, setExplainAnalysis] = useState<SlowQueryAnalysis | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<"results" | "plan">("results");
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<{
    success?: boolean;
    message?: string;
  } | null>(null);
  const [isVariablesModalOpen, setIsVariablesModalOpen] = useState(false);
  const [pendingVariableSql, setPendingVariableSql] = useState("");
  const [pendingVariables, setPendingVariables] = useState<string[]>([]);

  const { completionSchemas, routines, loadCompletionSchema } = useSchemaStore();
  const dbCompletionSchema = completionSchemas[database];

  useEffect(() => {
    if (database && (!dbCompletionSchema || Object.keys(dbCompletionSchema).length === 0)) {
      loadCompletionSchema(database);
    }
  }, [database, dbCompletionSchema, loadCompletionSchema]);

  const sqlExtensions = useMemo(() => {
    const schema = dbCompletionSchema || {};
    const tableItems = Object.keys(schema).map((tbl) => ({
      label: tbl,
      type: "type",
      detail: "Tabla",
      boost: 2,
    }));

    const routineItems = (routines[database] || []).map((r) => ({
      label: r.name,
      type: "function",
      detail: r.routine_type === "FUNCTION" ? "Función" : "Procedimiento",
      boost: 1,
    }));

    const sqlFunctions = [
      { label: "COUNT", type: "function", detail: "COUNT(expr)" },
      { label: "SUM", type: "function", detail: "SUM(expr)" },
      { label: "AVG", type: "function", detail: "AVG(expr)" },
      { label: "MIN", type: "function", detail: "MIN(expr)" },
      { label: "MAX", type: "function", detail: "MAX(expr)" },
      { label: "COALESCE", type: "function", detail: "COALESCE(val, fallback)" },
      { label: "IFNULL", type: "function", detail: "IFNULL(expr1, expr2)" },
      { label: "CONCAT", type: "function", detail: "CONCAT(s1, s2, ...)" },
      { label: "GROUP_CONCAT", type: "function", detail: "GROUP_CONCAT(expr)" },
      { label: "DATE_FORMAT", type: "function", detail: "DATE_FORMAT(date, format)" },
      { label: "DATEDIFF", type: "function", detail: "DATEDIFF(d1, d2)" },
      { label: "NOW", type: "function", detail: "NOW()" },
      { label: "CURDATE", type: "function", detail: "CURDATE()" },
      { label: "UNIX_TIMESTAMP", type: "function", detail: "UNIX_TIMESTAMP()" },
      { label: "JSON_EXTRACT", type: "function", detail: "JSON_EXTRACT(doc, path)" },
      { label: "JSON_UNQUOTE", type: "function", detail: "JSON_UNQUOTE(val)" },
      { label: "LAST_INSERT_ID", type: "function", detail: "LAST_INSERT_ID()" },
      { label: "UUID", type: "function", detail: "UUID()" },
      // MariaDB Vector functions (11.7+ / 11.8+)
      { label: "VEC_FromText", type: "function", detail: "VEC_FromText('[1.0, 2.0, ...]') (MariaDB Vector)" },
      { label: "VEC_ToText", type: "function", detail: "VEC_ToText(vector_column) (MariaDB Vector)" },
      { label: "VEC_DISTANCE", type: "function", detail: "VEC_DISTANCE(vec1, vec2) (MariaDB Vector)" },
      { label: "VEC_DISTANCE_COSINE", type: "function", detail: "VEC_DISTANCE_COSINE(vec1, vec2) (MariaDB Vector)" },
      { label: "VEC_DISTANCE_EUCLIDEAN", type: "function", detail: "VEC_DISTANCE_EUCLIDEAN(vec1, vec2) (MariaDB Vector)" },
      // MariaDB Temporal keywords
      { label: "FOR SYSTEM_TIME ALL", type: "keyword", detail: "Consultar todas las versiones históricas (MariaDB Temporal)" },
      { label: "FOR SYSTEM_TIME AS OF", type: "keyword", detail: "Consultar estado en fecha/hora exacta (MariaDB Temporal)" },
      { label: "FOR SYSTEM_TIME BETWEEN", type: "keyword", detail: "Consultar cambios en intervalo de tiempo (MariaDB Temporal)" },
      // MariaDB Sequences keywords
      { label: "NEXT VALUE FOR", type: "keyword", detail: "NEXT VALUE FOR sequence_name (MariaDB Sequence)" },
      { label: "PREVIOUS VALUE FOR", type: "keyword", detail: "PREVIOUS VALUE FOR sequence_name (MariaDB Sequence)" },
    ];

    const customCompletions = completeFromList([
      ...tableItems,
      ...routineItems,
      ...sqlFunctions,
    ]);

    return [
      sql({
        dialect: MySQL,
        schema,
        defaultSchema: database,
      }),
      MySQL.language.data.of({
        autocomplete: customCompletions,
      }),
    ];
  }, [dbCompletionSchema, routines, database]);

  // Editor & Execution control refs
  const editorViewRef = useRef<EditorView | null>(null);
  const cancelRequestedRef = useRef(false);
  const activeQueryIdRef = useRef<string | null>(null);
  const executionEpochRef = useRef<number>(0);
  const timerIntervalRef = useRef<number | null>(null);
  const timeoutTimerRef = useRef<number | null>(null);
  const executionStartRef = useRef<number>(0);

  // Execution mode & Timeout
  const [executionMode, setExecutionMode] = useState<ExecutionTargetMode>("auto");
  const [isExecMenuOpen, setIsExecMenuOpen] = useState(false);
  const [timeoutSec, setTimeoutSec] = useState<number>(30); // 0 = unlimited
  const [isTimeoutMenuOpen, setIsTimeoutMenuOpen] = useState(false);
  const [isCopiedError, setIsCopiedError] = useState(false);
  const execMenuRef = useRef<HTMLDivElement>(null);
  const timeoutMenuRef = useRef<HTMLDivElement>(null);

  // Safe Mode from store & Connection state
  const { safeModeEnabled, theme, noPrimaryKeyMode } = usePreferenceStore();
  const { connectionStatus } = useConnectionStore();
  const [isSafeModalOpen, setIsSafeModalOpen] = useState(false);
  const [safetyAnalysis, setSafetyAnalysis] = useState<SqlSafetyAnalysis | null>(null);
  const [estimatedAffectedRows, setEstimatedAffectedRows] = useState<number | null>(null);

  // History & Favorites Modals
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isFavoritesModalOpen, setIsFavoritesModalOpen] = useState(false);
  const [initialFavToSave, setInitialFavToSave] = useState<string | undefined>(undefined);

  // Close menus on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (execMenuRef.current && !execMenuRef.current.contains(e.target as Node)) {
        setIsExecMenuOpen(false);
      }
      if (timeoutMenuRef.current && !timeoutMenuRef.current.contains(e.target as Node)) {
        setIsTimeoutMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Structured SQL diagnostic parsing on error
  const diagnostic = useMemo(() => (error ? diagnoseSqlError(error) : null), [error]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let isDisposed = false;
    const subscribe = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const stopListening = await listen<ExportProgressEvent>(
        "excel-export-progress",
        (event) => setExportProgress(event.payload),
      );
      if (isDisposed) stopListening();
      else unlisten = stopListening;
    };
    void subscribe().catch((listenerError) => {
      console.error("No se pudo escuchar el progreso de exportación Excel:", listenerError);
    });
    return () => {
      isDisposed = true;
      unlisten?.();
    };
  }, []);

// Helper to robustly extract table and optional database from SQL
function extractTargetTableAndDb(sqlText: string): { db: string | null; table: string | null } {
  if (!sqlText) return { db: null, table: null };
  const clean = sqlText
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .replace(/#.*$/gm, " ");

  const match = clean.match(
    /\b(?:FROM|UPDATE|INTO)\s+[`"]?([a-zA-Z0-9_$]+)[`"]?(?:\s*\.\s*[`"]?([a-zA-Z0-9_$]+)[`"]?)?/i,
  );
  if (!match) return { db: null, table: null };
  if (match[2]) {
    return { db: match[1], table: match[2] };
  }
  return { db: null, table: match[1] };
}



  // Resizable SQL Editor height (with localStorage persistence)
  const [editorHeight, setEditorHeight] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("pyro_query_editor_height");
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 80 && parsed <= 900) return parsed;
      }
    } catch {}
    return 190;
  });

  const isDraggingSplitterRef = useRef(false);
  const startDragYRef = useRef(0);
  const startHeightRef = useRef(editorHeight);

  const handleSplitterMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingSplitterRef.current = true;
      startDragYRef.current = e.clientY;
      startHeightRef.current = editorHeight;

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!isDraggingSplitterRef.current) return;
        const deltaY = moveEvent.clientY - startDragYRef.current;
        const newHeight = Math.max(
          80,
          Math.min(window.innerHeight - 200, startHeightRef.current + deltaY),
        );
        setEditorHeight(newHeight);
        try {
          localStorage.setItem("pyro_query_editor_height", String(newHeight));
        } catch {}
      };

      const onMouseUp = () => {
        isDraggingSplitterRef.current = false;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [editorHeight],
  );

  // Target table and PK state
  const [targetTableOverride, setTargetTableOverride] = useState<string>("");
  const [targetPkOverride, setTargetPkOverride] = useState<string>("");
  const [tablePkColumns, setTablePkColumns] = useState<string[]>([]);

  // Clear timer interval on unmount
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, []);

  // Available tables in active database for auto-suggestions
  const { tables: schemaTables } = useSchemaStore();
  const availableTables = useMemo(() => {
    const fromStore = (schemaTables[database] || []).map((t) => t.name);
    if (fromStore.length > 0) return fromStore;
    if (dbCompletionSchema) return Object.keys(dbCompletionSchema);
    return [];
  }, [schemaTables, dbCompletionSchema, database]);

  // Helper to detect table and database from query (prioritize resultSql for current grid data)
  const detectedTarget = useMemo(() => {
    return extractTargetTableAndDb(resultSql || query);
  }, [resultSql, query]);

  const activeTargetTable = targetTableOverride.trim() || detectedTarget.table || "";
  const activeTargetDb = detectedTarget.db || database;

  // Proactively fetch real PK columns of the target table from DB metadata
  useEffect(() => {
    if (!activeTargetTable || !activeTargetDb) {
      setTablePkColumns([]);
      return;
    }
    let isMounted = true;
    dbService
      .getTablePrimaryKey(activeTargetDb, activeTargetTable)
      .then((pk) => {
        if (isMounted && pk?.columns) {
          setTablePkColumns(pk.columns);
        }
      })
      .catch(() => {
        if (isMounted) setTablePkColumns([]);
      });
    return () => {
      isMounted = false;
    };
  }, [activeTargetDb, activeTargetTable]);

  // Primary key columns: override if user specified, otherwise from DB schema
  const activePkColumns = useMemo(() => {
    if (targetPkOverride.trim()) {
      return targetPkOverride
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return tablePkColumns;
  }, [targetPkOverride, tablePkColumns]);

  const hasPrimaryKey = activePkColumns.length > 0;

  // Case-insensitive check to ensure all PK columns are present in query results
  const pkColumnsPresent = useMemo(() => {
    if (!result || !result.columns || !hasPrimaryKey) return false;
    const lowerResultCols = result.columns.map((c) => c.toLowerCase());
    return activePkColumns.every((pk) =>
      lowerResultCols.includes(pk.toLowerCase()),
    );
  }, [result, activePkColumns, hasPrimaryKey]);

  const canEditResult = Boolean(
    activeTargetTable &&
      (hasPrimaryKey ? pkColumnsPresent : noPrimaryKeyMode === "use_all_columns"),
  );

  // Resolves the SQL segment to execute based on selection, cursor and preferred mode
  const getTargetSql = useCallback(
    (preferredMode: ExecutionTargetMode = executionMode) => {
      let selectionText: string | undefined;
      let cursorOffset: number | undefined;

      if (editorViewRef.current) {
        const state = editorViewRef.current.state;
        const sel = state.selection.main;
        if (!sel.empty) {
          selectionText = state.sliceDoc(sel.from, sel.to);
        }
        cursorOffset = sel.head;
      }

      return resolveExecutionTarget({
        fullText: query,
        selectionText,
        cursorOffset,
        preferredMode,
      });
    },
    [query, executionMode],
  );

  // Direct internal query executor (called after Safe Mode check passes)
  const executeQueryInternal = useCallback(
    async (sqlToRun: string) => {
      const currentEpoch = ++executionEpochRef.current;
      const queryId = `query_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      activeQueryIdRef.current = queryId;
      cancelRequestedRef.current = false;
      setExecutionState("executing");
      setError(null);
      setResult(null);
      setResultSql(null);
      executionStartRef.current = Date.now();
      setElapsedMs(0);

      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
      timerIntervalRef.current = window.setInterval(() => {
        setElapsedMs(Date.now() - executionStartRef.current);
      }, 50);

      // Client-side configurable timeout guard
      if (timeoutTimerRef.current) {
        clearTimeout(timeoutTimerRef.current);
        timeoutTimerRef.current = null;
      }
      if (timeoutSec > 0) {
        timeoutTimerRef.current = window.setTimeout(async () => {
          if (executionEpochRef.current === currentEpoch) {
            cancelRequestedRef.current = true;
            try {
              await dbService.cancelQuery(queryId);
            } catch {}
            setExecutionState("error");
            setError(
              `Tiempo de espera excedido: La consulta superó el límite configurado de ${timeoutSec}s. Se envió la señal de cancelación al motor.`,
            );
            if (timerIntervalRef.current) {
              clearInterval(timerIntervalRef.current);
              timerIntervalRef.current = null;
            }
          }
        }, timeoutSec * 1000);
      }

      try {
        const res = await dbService.executeQuery(sqlToRun, database, queryId);

        // Guard against race conditions from previous slow executions
        if (executionEpochRef.current !== currentEpoch) {
          return;
        }

        if (cancelRequestedRef.current) {
          setExecutionState("cancelled");
          return;
        }

        const duration = Date.now() - executionStartRef.current;
        setElapsedMs(duration);
        setExecutionState("success");
        setResult(res);
        setResultSql(sqlToRun);
        setActiveSubTab("results");

        // Log successful execution in persistent history
        queryHistoryStorage.addEntry({
          connectionName: connectionStatus.config?.savedConnectionName || "Local",
          database,
          sql: sqlToRun,
          durationMs: res.execution_time_ms || duration,
          success: true,
          affectedRows: res.rows.length || (res.affected_rows as number),
        });
      } catch (err: unknown) {
        // Discard stale responses
        if (executionEpochRef.current !== currentEpoch) {
          return;
        }

        setExportProgress(null);
        if (cancelRequestedRef.current) {
          setExecutionState("cancelled");
          return;
        }

        const duration = Date.now() - executionStartRef.current;
        setElapsedMs(duration);
        setExecutionState("error");
        const msg =
          typeof err === "string"
            ? err
            : (err as Error)?.message || "Error al ejecutar la consulta";
        setError(msg);
        setResult(null);
        setResultSql(null);

        // Log failed execution in persistent history
        queryHistoryStorage.addEntry({
          connectionName: connectionStatus.config?.savedConnectionName || "Local",
          database,
          sql: sqlToRun,
          durationMs: duration,
          success: false,
          errorMessage: msg,
        });
      } finally {
        if (timeoutTimerRef.current) {
          clearTimeout(timeoutTimerRef.current);
          timeoutTimerRef.current = null;
        }
        if (executionEpochRef.current === currentEpoch && timerIntervalRef.current) {
          clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
        }
      }
    },
    [database, timeoutSec, connectionStatus.config?.savedConnectionName],
  );

  // Main entry point for query execution (checks Safe Mode first)
  const handleRunQuery = useCallback(
    async (forcedModeOrSql?: ExecutionTargetMode | string, explicitSql?: string) => {
      let targetSql = explicitSql?.trim();
      let forcedMode: ExecutionTargetMode = executionMode;

      if (forcedModeOrSql) {
        if (
          forcedModeOrSql === "auto" ||
          forcedModeOrSql === "selection" ||
          forcedModeOrSql === "statement" ||
          forcedModeOrSql === "all"
        ) {
          forcedMode = forcedModeOrSql;
        } else {
          targetSql = forcedModeOrSql.trim();
        }
      }

      if (!targetSql) {
        const target = getTargetSql(forcedMode);
        targetSql = target.sql.trim();
      }
      if (!targetSql) return;

      // Check if there are pending unapplied changes in the current target table
      if (!explicitSql && activeTargetTable) {
        const hasPending = useStagedChangesStore.getState().hasPendingChanges(activeTargetDb, activeTargetTable);
        if (hasPending) {
          useUIStore.getState().showConfirm({
            title: "Cambios Pendientes sin Guardar",
            message: `Hay cambios pendientes en la tabla '${activeTargetTable}'. Si ejecutas una nueva consulta se descartarán los cambios no aplicados. ¿Deseas continuar?`,
            variant: "warning",
            icon: "alert",
            confirmText: "Descartar y Ejecutar",
            cancelText: "Volver",
            onConfirm: () => {
              useStagedChangesStore.getState().clearTableChanges(activeTargetDb, activeTargetTable);
              handleRunQuery(forcedModeOrSql, targetSql);
            },
          });
          return;
        }
      }

      // Check for named dynamic parameters (:variable)
      const dynamicVars = extractSqlVariables(targetSql);
      if (dynamicVars.length > 0) {
        setPendingVariableSql(targetSql);
        setPendingVariables(dynamicVars);
        setIsVariablesModalOpen(true);
        return;
      }

      const isProduction = connectionStatus.config?.environment === "production";

      // In production, Safe Mode safety checks are always enforced
      if (safeModeEnabled || isProduction) {
        try {
          const analysis = await dbService.checkSqlSafety(targetSql);
          // In production, any destructive or non-safe query requires confirmation
          if (analysis.is_destructive || (isProduction && analysis.danger_level !== "Safe")) {
            setSafetyAnalysis(analysis);
            let affected: number | null = null;
            try {
              affected = await dbService.previewAffectedRows(database, targetSql);
            } catch {
              // Non-blocking if estimation query cannot run
            }
            setEstimatedAffectedRows(affected);
            setIsSafeModalOpen(true);
            return;
          }
        } catch (analysisErr) {
          // If safety analysis fails, apply conservative policy: do not run blindly
          setSafetyAnalysis({
            is_destructive: true,
            danger_level: "Critical",
            operation: "NO EVALUADA (Error de análisis)",
            message: `No se pudo verificar la seguridad de la consulta debido a un error: ${
              analysisErr instanceof Error ? analysisErr.message : String(analysisErr)
            }. Por precaución, confirme la ejecución explícitamente.`,
            requires_explicit_confirmation: true,
            is_uncertain: true,
          });
          setIsSafeModalOpen(true);
          return;
        }
      }

      await executeQueryInternal(targetSql);
    },
    [getTargetSql, executionMode, safeModeEnabled, executeQueryInternal, connectionStatus.config?.environment],
  );

  // Cancel running query and forward signal to backend
  const handleCancelQuery = useCallback(async () => {
    cancelRequestedRef.current = true;
    executionEpochRef.current++;
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    setExecutionState("cancelled");

    if (activeQueryIdRef.current) {
      try {
        await dbService.cancelQuery(activeQueryIdRef.current);
      } catch (cancelErr) {
        console.warn("No se pudo enviar KILL QUERY al motor:", cancelErr);
      }
    }
  }, []);

  const handleExplainQuery = useCallback(async () => {
    if (!query.trim()) return;
    setIsExplaining(true);
    setError(null);
    try {
      // 1. Fetch deep SlowQueryAnalysis (JSON plan, visual nodes, tree plan, bottlenecks)
      try {
        const analysis = await dbService.analyzeSlowQuery(query, database);
        setExplainAnalysis(analysis);
      } catch (analysisErr) {
        console.warn("analyzeSlowQuery fallback:", analysisErr);
        setExplainAnalysis(null);
      }

      // 2. Fetch raw tabular explain result for execution timing and column metadata
      const explainSql = `EXPLAIN ${query.trim().replace(/;+$/, "")};`;
      const res = await dbService.executeQuery(explainSql, database);
      setExplainResult(res);
      setActiveSubTab("plan");
    } catch (err: unknown) {
      const msg =
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Error al generar el plan de ejecución";
      setError(msg);
    } finally {
      setIsExplaining(false);
    }
  }, [query, database]);

  const handleExportExcel = useCallback(async () => {
    if (!result || !result.columns || result.rows.length === 0 || !resultSql) {
      setSaveStatus({
        success: false,
        message: "No hay filas en los resultados para exportar a Excel.",
      });
      setTimeout(() => setSaveStatus(null), 4000);
      return;
    }
    setIsExporting(true);
    setSaveStatus(null);
    setExportProgress({ rows_written: 0, stage: "Preparando exportación" });
    try {
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
      const defaultName = `consulta_${database}_${timestamp}.xlsx`;
      const chosenPath = await dbService.saveExcelDialog(defaultName);
      if (!chosenPath) {
        setExportProgress(null);
        setIsExporting(false);
        return;
      }

      const summary = await dbService.exportExcelFile({
        database,
        table: "",
        query: resultSql,
        file_path: chosenPath,
      });
      setExportProgress(null);

      setSaveStatus({
        success: true,
        message: `Excel generado: ${summary.total_rows.toLocaleString()} fila(s) exportada(s) (${summary.execution_time_ms} ms)`,
      });
      setTimeout(() => setSaveStatus(null), 5000);
    } catch (err: unknown) {
      const msg =
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Error al exportar a Excel";
      setSaveStatus({
        success: false,
        message: msg,
      });
      setTimeout(() => setSaveStatus(null), 6000);
    } finally {
      setIsExporting(false);
    }
  }, [result, resultSql, database]);

  // Tab modified tracking
  const { activeTabId, setTabModified } = useUIStore();
  useEffect(() => {
    if (activeTabId) {
      setTabModified(activeTabId, query !== initialQuery);
    }
  }, [query, initialQuery, activeTabId, setTabModified]);

  // Keyboard shortcuts:
  // - Ctrl+Enter / Cmd+Enter: Run
  // - Ctrl+Shift+Enter / Alt+X: Explain
  // - Ctrl+H: Open history
  // - Ctrl+S: Open Favorites to save
  // - Escape: Cancel query execution if running
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Alt + X for EXPLAIN
    if (e.altKey && e.key.toLowerCase() === "x") {
      e.preventDefault();
      handleExplainQuery();
      return;
    }

    // Escape to cancel execution
    if (e.key === "Escape" && executionState === "executing") {
      e.preventDefault();
      handleCancelQuery();
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) {
          // Ctrl+Shift+Enter: ejecuta todo el script de la pestaña
          handleRunQuery("all");
        } else {
          // Ctrl+Enter: ejecuta únicamente la sentencia bajo el cursor (o la selección activa)
          handleRunQuery("statement");
        }
      } else if (e.key.toLowerCase() === "h") {
        e.preventDefault();
        setIsHistoryModalOpen(true);
      } else if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        setInitialFavToSave(query);
        setIsFavoritesModalOpen(true);
      }
    }
  };

  const isLight =
    theme === "light" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: light)").matches);

  return (
    <div
      onKeyDown={handleKeyDown}
      className="flex-1 flex flex-col h-full bg-[#0b0d13] overflow-hidden"
    >
      {/* Top Action Toolbar */}
      <div className="px-4 py-2 bg-[#10131b] border-b border-[#1b202e] flex flex-wrap items-center justify-between gap-3 text-xs select-none">
        <div className="flex items-center space-x-2 flex-wrap gap-y-1">
          {/* Primary Action Group: Run / Cancel / EXPLAIN / Copilot */}
          <div className="flex items-center space-x-1.5">
            {executionState === "executing" ? (
              <button
                onClick={handleCancelQuery}
                title="Cancelar ejecución de la consulta (Esc)"
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-red-600/80 hover:bg-red-600 text-white rounded-md font-semibold shadow-md shadow-red-950/40 transition-all active:scale-95 animate-pulse"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Cancelar (Esc)</span>
              </button>
            ) : (
              <div className="relative inline-flex items-stretch rounded-md shadow-md shadow-orange-950/40" ref={execMenuRef}>
                <button
                  onClick={() => handleRunQuery()}
                  title={`Ejecutar: ${getTargetSql().mode === "selection" ? "Selección" : getTargetSql().mode === "statement" ? `Sentencia #${(getTargetSql().statementIndex ?? 0) + 1}` : "Todo el script"} (Ctrl+Enter)`}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white rounded-l-md font-semibold transition-all active:scale-95"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Ejecutar</span>
                  <span className="text-[10px] opacity-80 font-normal">
                    ({executionMode === "auto" ? (getTargetSql().mode === "selection" ? "Selección" : "Sentencia") : executionMode === "all" ? "Todo" : executionMode === "statement" ? "Sentencia" : "Selección"})
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsExecMenuOpen((prev) => !prev)}
                  title="Opciones de ejecución (Sentencia actual, Selección o Todo el script)"
                  className="px-1.5 bg-amber-700 hover:bg-amber-600 text-white border-l border-amber-800/40 rounded-r-md transition-colors flex items-center justify-center"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>

                {isExecMenuOpen && (
                  <div className="absolute left-0 top-full mt-1 w-64 bg-[#11141c] border border-[#232a3c] rounded-md shadow-2xl py-1 z-50 text-xs">
                    <button
                      onClick={() => {
                        setExecutionMode("auto");
                        setIsExecMenuOpen(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 hover:bg-[#1a202e] flex items-center justify-between transition-colors ${
                        executionMode === "auto" ? "text-orange-400 font-semibold" : "text-neutral-200"
                      }`}
                    >
                      <span>Auto (Cursor o Selección)</span>
                      <span className="text-[10px] text-neutral-400">Ctrl+Enter</span>
                    </button>
                    <button
                      onClick={() => {
                        setExecutionMode("statement");
                        setIsExecMenuOpen(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 hover:bg-[#1a202e] flex items-center justify-between transition-colors ${
                        executionMode === "statement" ? "text-orange-400 font-semibold" : "text-neutral-200"
                      }`}
                    >
                      <span>Sentencia Actual</span>
                      <span className="text-[10px] text-neutral-400">Cursor</span>
                    </button>
                    <button
                      onClick={() => {
                        setExecutionMode("selection");
                        setIsExecMenuOpen(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 hover:bg-[#1a202e] flex items-center justify-between transition-colors ${
                        executionMode === "selection" ? "text-orange-400 font-semibold" : "text-neutral-200"
                      }`}
                    >
                      <span>Solo Selección</span>
                      <span className="text-[10px] text-neutral-400">Resaltado</span>
                    </button>
                    <button
                      onClick={() => {
                        setExecutionMode("all");
                        setIsExecMenuOpen(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 hover:bg-[#1a202e] flex items-center justify-between transition-colors ${
                        executionMode === "all" ? "text-orange-400 font-semibold" : "text-neutral-200"
                      }`}
                    >
                      <span>Todo el Script</span>
                      <span className="text-[10px] text-neutral-400">Ctrl+Shift+Enter</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Target SQL Preview Pill */}
            {query.trim() && (
              <div
                title={`SQL que se ejecutará: "${getTargetSql().preview}"`}
                className="hidden lg:flex items-center space-x-1 px-2 py-1 bg-[#12151f] border border-[#20273a] rounded text-[11px] text-neutral-300 max-w-[200px] truncate font-mono"
              >
                <Terminal className="w-3 h-3 text-neutral-400 shrink-0" />
                <span className="truncate">{getTargetSql().preview || "Vacío"}</span>
              </div>
            )}

            {/* Timeout Selector */}
            <div className="relative inline-flex items-center" ref={timeoutMenuRef}>
              <button
                type="button"
                onClick={() => setIsTimeoutMenuOpen((prev) => !prev)}
                title="Configurar tiempo de espera (Timeout) para cancelar consultas lentas automáticamente"
                className="flex items-center space-x-1 px-2 py-1.5 bg-[#141824] hover:bg-[#1c2233] text-neutral-300 hover:text-white border border-[#21283a] rounded-md transition-colors"
              >
                <Clock className="w-3.5 h-3.5 text-neutral-400" />
                <span className="text-[11px] font-mono">
                  {timeoutSec === 0 ? "Sin límite" : `${timeoutSec}s`}
                </span>
                <ChevronDown className="w-3 h-3 text-neutral-400" />
              </button>

              {isTimeoutMenuOpen && (
                <div className="absolute left-0 top-full mt-1 w-44 bg-[#11141c] border border-[#232a3c] rounded-md shadow-2xl py-1 z-50 text-xs font-mono">
                  {[
                    { label: "5 segundos", val: 5 },
                    { label: "10 segundos", val: 10 },
                    { label: "30 segundos (default)", val: 30 },
                    { label: "60 segundos", val: 60 },
                    { label: "120 segundos", val: 120 },
                    { label: "Sin límite", val: 0 },
                  ].map((opt) => (
                    <button
                      key={opt.val}
                      onClick={() => {
                        setTimeoutSec(opt.val);
                        setIsTimeoutMenuOpen(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 hover:bg-[#1a202e] transition-colors ${
                        timeoutSec === opt.val ? "text-orange-400 font-semibold" : "text-neutral-300"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Explain Query Button */}
            <button
              onClick={handleExplainQuery}
              disabled={isExplaining || executionState === "executing"}
              title="Generar plan de ejecución EXPLAIN para optimizar la consulta (Ctrl+Shift+Enter / Alt+X)"
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#171b26] hover:bg-[#212737] text-orange-300 border border-orange-500/30 hover:border-orange-500/60 rounded-md font-medium transition-all disabled:opacity-50"
            >
              {isExplaining ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-400" />
              ) : (
                <Activity className="w-3.5 h-3.5 text-orange-400" />
              )}
              <span>EXPLAIN</span>
            </button>

            {/* SQL Copilot Assistant Button */}
            <button
              onClick={() => {
                setCopilotAction("menu");
                setIsCopilotOpen(true);
              }}
              disabled={executionState === "executing"}
              title="Abrir SQL Copilot (Hub inteligente: Explicar, Optimizar, Crear Vistas, Diagnosticar y Generar SQL con IA)"
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-950/60 to-indigo-950/60 hover:from-purple-900/70 hover:to-indigo-900/70 text-purple-200 border border-purple-500/40 hover:border-purple-400/60 rounded-md font-semibold transition-all disabled:opacity-50 shadow-xs"
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-300" />
              <span>Copilot IA</span>
            </button>

            {/* Convert to Database View Button */}
            <button
              onClick={() => {
                setCopilotAction("create_view");
                setIsCopilotOpen(true);
              }}
              disabled={executionState === "executing" || !query.trim()}
              title="Convertir la consulta actual en una Vista persistente de la BD (CREATE OR REPLACE VIEW)"
              className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-[#141824] hover:bg-[#1f2638] text-sky-300 hover:text-white border border-sky-500/30 hover:border-sky-500/60 rounded-md font-medium transition-all disabled:opacity-40"
            >
              <Eye className="w-3.5 h-3.5 text-sky-400" />
              <span>Crear Vista</span>
            </button>
          </div>

          <div className="h-4 w-px bg-[#232838] mx-1 hidden sm:block" />

          {/* Secondary Tools Group: History / Favorites / Assistant */}
          <div className="flex items-center space-x-1">
            {/* History Button */}
            <button
              onClick={() => setIsHistoryModalOpen(true)}
              title="Historial de consultas ejecutadas (Ctrl+H)"
              className="flex items-center space-x-1 px-2.5 py-1.5 bg-[#141824] hover:bg-[#1e2436] text-neutral-300 hover:text-white border border-[#21283a] rounded-md font-medium transition-colors"
            >
              <History className="w-3.5 h-3.5 text-neutral-400" />
              <span>Historial</span>
            </button>

            {/* Favorites Button */}
            <button
              onClick={() => {
                setInitialFavToSave(undefined);
                setIsFavoritesModalOpen(true);
              }}
              title="Consultas favoritas y snippets (Ctrl+S para guardar)"
              className="flex items-center space-x-1 px-2.5 py-1.5 bg-[#141824] hover:bg-[#1e2436] text-neutral-300 hover:text-white border border-[#21283a] rounded-md font-medium transition-colors"
            >
              <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400/20" />
              <span>Favoritos (Ctrl+S)</span>
            </button>
          </div>

          <div className="h-4 w-px bg-[#232838] mx-1 hidden sm:block" />

          {/* Safe Mode Indicator Badge (Linked to Settings) */}
          <button
            onClick={() => useUIStore.getState().openSettingsModal("database")}
            title={`Modo Seguro: ${
              safeModeEnabled ? "ACTIVADO" : "DESACTIVADO"
            } (Haz clic para configurar en Preferencias)`}
            className={`flex items-center space-x-1 px-2.5 py-1 rounded border text-[11px] font-mono transition-colors ${
              safeModeEnabled
                ? "bg-emerald-950/30 border-emerald-700/50 text-emerald-400 hover:bg-emerald-950/50"
                : "bg-amber-950/30 border-amber-700/50 text-amber-400 hover:bg-amber-950/50"
            }`}
          >
            {safeModeEnabled ? (
              <Shield className="w-3 h-3 text-emerald-400" />
            ) : (
              <ShieldAlert className="w-3 h-3 text-amber-400" />
            )}
            <span>Seguro: {safeModeEnabled ? "ON" : "OFF"}</span>
          </button>

          {/* Active Database Tag */}
          <div className="flex items-center space-x-1.5 px-2 py-1 bg-[#141824] border border-[#21283a] rounded text-neutral-400 font-mono text-[11px]">
            <Database className="w-3 h-3 text-orange-400" />
            <span>Esquema: <strong className="text-neutral-200">{database || "—"}</strong></span>
          </div>
        </div>

        {/* Right side: Execution status indicators & Save alerts */}
        <div className="flex items-center space-x-3">
          {saveStatus && (
            <div
              className={`px-3 py-1 rounded text-xs flex items-center space-x-1.5 border font-mono animate-in fade-in duration-150 ${
                saveStatus.success
                  ? "bg-emerald-950/40 border-emerald-800/60 text-emerald-300"
                  : "bg-red-950/40 border-red-800/60 text-red-300"
              }`}
            >
              {saveStatus.success ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
              )}
              <span className="truncate max-w-sm">{saveStatus.message}</span>
            </div>
          )}
          {isExporting && exportProgress && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 rounded border border-sky-800/50 bg-sky-950/30 px-3 py-1 text-xs text-sky-200"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" />
              <span>
                {exportProgress.rows_written.toLocaleString()} filas · {exportProgress.stage}
              </span>
            </div>
          )}

          {/* Clear execution status banner */}
          {executionState === "executing" && (
            <div className="flex items-center space-x-2 text-xs font-mono text-amber-400 bg-amber-950/30 border border-amber-800/40 px-2.5 py-1 rounded">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Executing... ({elapsedMs} ms)</span>
            </div>
          )}

          {executionState === "cancelled" && (
            <div className="flex items-center space-x-1.5 text-xs font-mono text-neutral-400 bg-neutral-900 border border-neutral-700 px-2.5 py-1 rounded">
              <Square className="w-3 h-3 text-red-400 fill-current" />
              <span>Cancelled</span>
            </div>
          )}

          {executionState === "error" && error && (
            <div className="flex items-center space-x-1.5 text-xs font-mono text-red-400 bg-red-950/30 border border-red-800/50 px-2.5 py-1 rounded">
              <AlertCircle className="w-3.5 h-3.5 text-red-400" />
              <span>Error ({elapsedMs} ms)</span>
            </div>
          )}

          {executionState === "success" && result && (
            <div className="flex items-center space-x-2 text-xs font-mono text-emerald-400 bg-emerald-950/30 border border-emerald-800/50 px-2.5 py-1 rounded">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>
                Success — {result.rows.length} fila(s) — {result.execution_time_ms || elapsedMs} ms
              </span>
            </div>
          )}
        </div>
      </div>

      {/* SQL Editor Area (CodeMirror 6) with Dynamic Height */}
      <div
        style={{ height: `${editorHeight}px` }}
        className="border-b border-[#1c2232] overflow-hidden bg-[#0d0f15] relative shrink-0"
      >
        <CodeMirror
          value={query}
          height={`${editorHeight}px`}
          theme={isLight ? "light" : "dark"}
          extensions={sqlExtensions}
          basicSetup={{
            autocompletion: true,
            lineNumbers: true,
            foldGutter: true,
            highlightActiveLine: true,
          }}
          onCreateEditor={(view) => {
            editorViewRef.current = view;
          }}
          onChange={(val) => {
            setQuery(val);
            onQueryChange?.(val);
          }}
          className="text-xs font-mono h-full"
        />
      </div>

      {/* Splitter / Resizer Handle */}
      <div
        onMouseDown={handleSplitterMouseDown}
        title="Arrastra verticalmente para redimensionar el editor SQL"
        className="h-2 w-full bg-[#10131d] hover:bg-orange-600/30 active:bg-orange-600/50 border-b border-[#1b202e] cursor-row-resize flex items-center justify-center transition-colors group select-none shrink-0 z-10"
      >
        <div className="w-10 h-1 rounded-full bg-[#283044] group-hover:bg-orange-400 group-active:bg-orange-500 transition-colors" />
      </div>

      {/* Sub-tab Navigation & Target Table Binding Bar */}
      {(result || explainResult) && (
        <div className="px-4 bg-[#0f121a] border-b border-[#1b202e] flex flex-wrap items-center justify-between gap-3 text-xs font-medium select-none min-h-[42px]">
          <div className="flex items-center space-x-4">
            {result && (
              <button
                onClick={() => setActiveSubTab("results")}
                className={`py-2 px-1 border-b-2 flex items-center space-x-2 transition-colors ${
                  activeSubTab === "results"
                    ? "border-orange-500 text-orange-400 font-semibold"
                    : "border-transparent text-neutral-400 hover:text-neutral-200"
                }`}
              >
                <TableIcon className="w-3.5 h-3.5" />
                <span>Resultados de la Consulta ({result.rows.length} filas)</span>
              </button>
            )}

            {explainResult && (
              <button
                onClick={() => setActiveSubTab("plan")}
                className={`py-2 px-1 border-b-2 flex items-center space-x-2 transition-colors ${
                  activeSubTab === "plan"
                    ? "border-orange-500 text-orange-400 font-semibold"
                    : "border-transparent text-neutral-400 hover:text-neutral-200"
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>Plan de Ejecución EXPLAIN</span>
              </button>
            )}
          </div>

          {/* Target Table Binding & Quick Actions */}
          {result && activeSubTab === "results" && result.rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 py-1 text-xs">
              {/* Target table input with auto-suggest datalist */}
              <div className="flex items-center space-x-1.5 bg-[#141824] border border-[#232a3c] rounded px-2 py-1 text-[11px] font-mono">
                <span className="text-neutral-400">Tabla:</span>
                <input
                  type="text"
                  list={`tables-list-${database}`}
                  value={targetTableOverride || detectedTarget.table || ""}
                  onChange={(e) => setTargetTableOverride(e.target.value)}
                  placeholder="tabla_bd"
                  title="Tabla a la cual enviar los cambios de celdas"
                  className="bg-transparent text-orange-300 w-28 focus:outline-none focus:text-white font-semibold"
                />
                {availableTables.length > 0 && (
                  <datalist id={`tables-list-${database}`}>
                    {availableTables.map((tbl) => (
                      <option key={tbl} value={tbl} />
                    ))}
                  </datalist>
                )}
              </div>

              {/* Primary Key indicator & Selector */}
              {result.columns.length > 0 && (
                <div className="flex items-center space-x-1.5 bg-[#141824] border border-[#232a3c] rounded px-2 py-1 text-[11px] font-mono">
                  <Key className="w-3 h-3 text-amber-400" />
                  <span className="text-neutral-400">PK:</span>
                  <select
                    value={targetPkOverride || (tablePkColumns.length > 0 ? tablePkColumns.join(",") : "")}
                    onChange={(e) => setTargetPkOverride(e.target.value)}
                    title="Columna usada para identificar la fila (WHERE pk = ?)"
                    className="bg-transparent text-amber-300 text-[11px] focus:outline-none cursor-pointer max-w-[170px] truncate"
                  >
                    {tablePkColumns.length > 0 && (
                      <option value={tablePkColumns.join(",")} className="bg-[#141824] text-amber-300 font-semibold">
                        🔑 Auto: {tablePkColumns.join(", ")}
                      </option>
                    )}
                    <option value="" className="bg-[#141824] text-neutral-400">
                      (Seleccionar columna clave...)
                    </option>
                    {result.columns.map((c) => (
                      <option key={c} value={c} className="bg-[#141824] text-white">
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Read-only vs Inline Editing badge */}
              {canEditResult ? (
                <span
                  title="Edición Inline Activa: Haz doble clic en cualquier celda para editar su valor directamente."
                  className="px-2 py-0.5 rounded bg-emerald-950/50 border border-emerald-700/60 text-emerald-300 text-[11px] font-mono flex items-center space-x-1"
                >
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  <span>Edición Inline: ON</span>
                </span>
              ) : (
                <span
                  title={
                    !activeTargetTable
                      ? "Edición deshabilitada: Especifica la tabla destino para editar."
                      : !hasPrimaryKey
                      ? "Selecciona una columna como Clave Primaria (PK) en el selector de la izquierda para permitir la edición de celdas."
                      : "La consulta no incluye las columnas de la clave primaria. Selecciona una columna de los resultados como PK arriba."
                  }
                  className="px-2 py-0.5 rounded bg-amber-950/40 border border-amber-800/50 text-amber-300 text-[11px] font-mono flex items-center space-x-1"
                >
                  <AlertCircle className="w-3 h-3 text-amber-400" />
                  <span>Solo Lectura</span>
                </span>
              )}

              {/* Convert to Database View */}
              <button
                onClick={() => {
                  setCopilotAction("create_view");
                  setIsCopilotOpen(true);
                }}
                title="Convertir esta consulta ejecutada en una Vista persistente de la BD (CREATE OR REPLACE VIEW)"
                className="flex items-center space-x-1.5 px-3 py-1 bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/40 hover:border-sky-500/70 rounded text-xs font-semibold transition-all active:scale-95"
              >
                <Eye className="w-3.5 h-3.5 text-sky-400" />
                <span>Convertir en Vista</span>
              </button>

              {/* Export to Excel */}
              <button
                onClick={handleExportExcel}
                disabled={isExporting}
                title="Exportar todos los resultados de la consulta a un archivo Excel (.xlsx)"
                className="flex items-center space-x-1.5 px-3 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 hover:border-emerald-500/70 rounded text-xs font-semibold transition-all disabled:opacity-40 active:scale-95"
              >
                {isExporting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                ) : (
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                )}
                <span>Exportar Excel</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Results / Plan Section */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#0a0c10]">
        {error && diagnostic ? (
          <div className="p-4 m-4 rounded-lg bg-red-950/25 border border-red-800/50 text-red-300 text-xs font-mono space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start space-x-2.5">
                <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold text-red-200 flex flex-wrap items-center gap-2">
                    <span>Error en la sentencia SQL</span>
                    {diagnostic.error_code && (
                      <span className="px-1.5 py-0.5 rounded bg-red-900/60 text-red-200 border border-red-700/50 text-[10px]">
                        Código: {diagnostic.error_code}
                      </span>
                    )}
                    {diagnostic.sqlstate && (
                      <span className="px-1.5 py-0.5 rounded bg-red-900/60 text-red-200 border border-red-700/50 text-[10px]">
                        SQLSTATE: {diagnostic.sqlstate}
                      </span>
                    )}
                    <span className="px-1.5 py-0.5 rounded bg-red-950/80 text-amber-300 border border-amber-800/40 text-[10px]">
                      {diagnostic.category}
                    </span>
                  </div>
                  <div className="mt-1.5 whitespace-pre-wrap text-red-300 select-text">
                    {diagnostic.original_error}
                  </div>
                </div>
              </div>
              <div className="flex items-center space-x-2 shrink-0">
                <button
                  onClick={() => {
                    if (diagnostic.original_error) {
                      navigator.clipboard.writeText(diagnostic.original_error);
                      setIsCopiedError(true);
                      setTimeout(() => setIsCopiedError(false), 2000);
                    }
                  }}
                  title="Copiar mensaje técnico del error al portapapeles"
                  className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-[#181d2a] hover:bg-[#22283a] text-neutral-300 hover:text-white border border-[#2b3348] rounded text-xs font-medium transition-colors"
                >
                  {isCopiedError ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-300">Copiado</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-neutral-400" />
                      <span>Copiar Error</span>
                    </>
                  )}
                </button>

                <button
                  onClick={() => {
                    setCopilotAction("fix");
                    setIsCopilotOpen(true);
                  }}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded text-xs font-semibold shadow-sm transition-all"
                >
                  <Bug className="w-3.5 h-3.5" />
                  <span>Corregir con Copilot</span>
                </button>
              </div>
            </div>

            {diagnostic.suggested_action && (
              <div className="p-2.5 bg-[#141018] border border-amber-900/40 rounded flex items-start space-x-2 text-amber-200">
                <Lightbulb className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                <div>
                  <span className="font-semibold text-amber-300">Sugerencia recomendada: </span>
                  <span>{diagnostic.suggested_action}</span>
                </div>
              </div>
            )}
          </div>
        ) : activeSubTab === "plan" && explainResult ? (
          <QueryPlanViewer
            planRows={explainAnalysis?.execution_plan || []}
            rawResult={
              explainResult
                ? {
                    columns: explainResult.columns,
                    rows: explainResult.rows,
                    execution_time_ms: explainResult.execution_time_ms,
                  }
                : undefined
            }
            jsonPlan={explainAnalysis?.json_plan}
            treePlan={explainAnalysis?.tree_plan}
            visualNodes={explainAnalysis?.visual_nodes}
            bottlenecks={explainAnalysis?.bottlenecks}
            potentialOptimizations={explainAnalysis?.potential_optimizations}
            querySql={query}
          />
        ) : result ? (
          result.columns.length > 0 ? (
            <div className="flex-1 w-full h-full relative overflow-hidden">
              <DataGridCanvas
                database={activeTargetDb || database}
                table={activeTargetTable}
                primaryKeyColumns={activePkColumns}
                externalData={result}
                isReadonly={!canEditResult}
                onRefresh={() => handleRunQuery()}
              />
            </div>
          ) : (
            <div className="p-6 flex items-center space-x-3 text-xs text-emerald-300 font-mono">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <span>{result.message}</span>
            </div>
          )
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-neutral-500 text-xs font-mono space-y-2 select-none">
            <Terminal className="w-8 h-8 opacity-30 text-orange-400" />
            <span>Presiona 'Ejecutar' (Ctrl+Enter) o 'Explicar' para consultar MariaDB</span>
            <span className="text-[11px] text-neutral-600">
              Atajos: Ctrl+H (Historial), Ctrl+S (Guardar Favorito)
            </span>
          </div>
        )}
      </div>

      {/* Safe Execution Warning Modal */}
      {isSafeModalOpen && safetyAnalysis && (
        <SafeExecutionModal
          isOpen={isSafeModalOpen}
          onClose={() => {
            setIsSafeModalOpen(false);
            setSafetyAnalysis(null);
          }}
          onConfirm={() => {
            setIsSafeModalOpen(false);
            setSafetyAnalysis(null);
            executeQueryInternal(query);
          }}
          analysis={safetyAnalysis}
          sql={query}
          estimatedAffectedRows={estimatedAffectedRows}
        />
      )}

      {/* Query History Modal */}
      {isHistoryModalOpen && (
        <QueryHistoryModal
          isOpen={isHistoryModalOpen}
          onClose={() => setIsHistoryModalOpen(false)}
          currentDatabase={database}
          onSelectQuery={(selectedSql, runImmediately) => {
            setQuery(selectedSql);
            onQueryChange?.(selectedSql);
            if (runImmediately) {
              handleRunQuery(selectedSql);
            }
          }}
        />
      )}

      {/* Favorites / Snippets Modal */}
      {isFavoritesModalOpen && (
        <FavoritesModal
          isOpen={isFavoritesModalOpen}
          onClose={() => {
            setIsFavoritesModalOpen(false);
            setInitialFavToSave(undefined);
          }}
          initialQueryToSave={initialFavToSave}
          onSelectQuery={(selectedSql, runImmediately) => {
            setQuery(selectedSql);
            onQueryChange?.(selectedSql);
            if (runImmediately) {
              handleRunQuery(selectedSql);
            }
          }}
        />
      )}

      {/* SQL Copilot Drawer */}
      {isCopilotOpen && (
        <SqlCopilotDrawer
          isOpen={isCopilotOpen}
          onClose={() => setIsCopilotOpen(false)}
          database={database}
          query={query}
          errorMessage={error || undefined}
          initialAction={copilotAction}
          onApplySql={(newSql) => {
            setQuery(newSql);
            onQueryChange?.(newSql);
          }}
        />
      )}

      {/* Dynamic Parameters Modal */}
      <SqlVariablesModal
        isOpen={isVariablesModalOpen}
        onClose={() => setIsVariablesModalOpen(false)}
        rawSql={pendingVariableSql}
        variableNames={pendingVariables}
        onExecuteWithParams={(finalSql) => {
          handleRunQuery(finalSql);
        }}
      />
    </div>
  );
};
