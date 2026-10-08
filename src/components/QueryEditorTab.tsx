import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";
import DataEditor, {
  GridCell,
  GridCellKind,
  GridColumn,
  Item,
  EditableGridCell,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
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
  Edit3,
  Key,
  Shield,
  ShieldAlert,
  History,
  Star,
  Square,
  BookmarkPlus,
  Sparkles,
  Lightbulb,
  Bug,
} from "lucide-react";
import { dbService } from "../services/tauriDb";
import { queryHistoryStorage } from "../services/queryHistoryStorage";
import { diagnoseSqlError } from "../services/sqlDiagnostics";
import { usePreferenceStore } from "../stores/preferenceStore";
import { useUIStore } from "../stores/uiStore";
import type {
  QueryExecutionResult,
  ExportProgressEvent,
  PrimaryKeyCondition,
  SqlSafetyAnalysis,
} from "../types/database";
import { QueryPlanViewer } from "./QueryPlanViewer";
import { EditRecordModal } from "./EditRecordModal";
import { SafeExecutionModal } from "./SafeExecutionModal";
import { QueryHistoryModal } from "./QueryHistoryModal";
import { FavoritesModal } from "./FavoritesModal";
import { SqlAssistantModal } from "./SqlAssistantModal";
import { SqlCopilotDrawer, type CopilotActionType } from "./SqlCopilotDrawer";

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
  const [copilotAction, setCopilotAction] = useState<CopilotActionType>("explain");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isExplaining, setIsExplaining] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [result, setResult] = useState<QueryExecutionResult | null>(null);
  const [resultSql, setResultSql] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<ExportProgressEvent | null>(null);
  const [explainResult, setExplainResult] = useState<QueryExecutionResult | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<"results" | "plan">("results");
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<{
    success?: boolean;
    message?: string;
  } | null>(null);

  // Cancellation ref to discard late responses
  const cancelRequestedRef = useRef(false);
  const timerIntervalRef = useRef<number | null>(null);
  const executionStartRef = useRef<number>(0);

  // Safe Mode from store
  const { safeModeEnabled, toggleSafeMode } = usePreferenceStore();
  const [isSafeModalOpen, setIsSafeModalOpen] = useState(false);
  const [safetyAnalysis, setSafetyAnalysis] = useState<SqlSafetyAnalysis | null>(null);

  // History & Favorites Modals
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isFavoritesModalOpen, setIsFavoritesModalOpen] = useState(false);
  const [isAssistantModalOpen, setIsAssistantModalOpen] = useState(false);
  const [initialFavToSave, setInitialFavToSave] = useState<string | undefined>(undefined);

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

  // Row selection & Row Editor modal
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

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

  // Helper to detect table name from SELECT / UPDATE / FROM queries
  const detectedTargetTable = useMemo(() => {
    const matchWithDb = query.match(
      /\bFROM\s+[`]?([a-zA-Z0-9_$]+)[`]?\.[`]?([a-zA-Z0-9_$]+)[`]?\b/i,
    );
    if (matchWithDb) return matchWithDb[2];
    const match = query.match(/\bFROM\s+[`]?([a-zA-Z0-9_$]+)[`]?\b/i);
    return match ? match[1] : null;
  }, [query]);

  const activeTargetTable = targetTableOverride.trim() || detectedTargetTable || "";

  // Proactively fetch real PK columns of the target table from DB metadata
  useEffect(() => {
    if (!activeTargetTable) {
      setTablePkColumns([]);
      return;
    }
    let isMounted = true;
    dbService
      .getTablePrimaryKey(database, activeTargetTable)
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
  }, [database, activeTargetTable]);

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

  // Verify all PK columns are present in result columns
  const pkColumnsPresent = useMemo(() => {
    if (!result || !result.columns || !hasPrimaryKey) return false;
    return activePkColumns.every((pk) => result.columns.includes(pk));
  }, [result, activePkColumns, hasPrimaryKey]);

  const canEditResult = Boolean(
    activeTargetTable && hasPrimaryKey && pkColumnsPresent,
  );

  // Direct internal query executor (called after Safe Mode check passes)
  const executeQueryInternal = useCallback(
    async (sqlToRun: string) => {
      cancelRequestedRef.current = false;
      setExecutionState("executing");
      setError(null);
      setResult(null);
      setResultSql(null);
      setSelectedRowIndex(null);
      executionStartRef.current = Date.now();
      setElapsedMs(0);

      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
      timerIntervalRef.current = window.setInterval(() => {
        setElapsedMs(Date.now() - executionStartRef.current);
      }, 50);

      try {
        const res = await dbService.executeQuery(sqlToRun, database);

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
        if (res.rows.length > 0) {
          setSelectedRowIndex(0);
        }

        // Log successful execution in persistent history
        queryHistoryStorage.addEntry({
          connectionName: "Local",
          database,
          sql: sqlToRun,
          durationMs: res.execution_time_ms || duration,
          success: true,
          affectedRows: res.rows.length || (res.affected_rows as number),
        });
      } catch (err: unknown) {
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
          connectionName: "Local",
          database,
          sql: sqlToRun,
          durationMs: duration,
          success: false,
          errorMessage: msg,
        });
      } finally {
        if (timerIntervalRef.current) {
          clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
        }
      }
    },
    [database],
  );

  // Main entry point for query execution (checks Safe Mode first)
  const handleRunQuery = useCallback(
    async (explicitSql?: string) => {
      const targetSql = (explicitSql || query).trim();
      if (!targetSql) return;

      if (safeModeEnabled) {
        try {
          const analysis = await dbService.checkSqlSafety(targetSql);
          if (analysis.is_destructive) {
            setSafetyAnalysis(analysis);
            setIsSafeModalOpen(true);
            return;
          }
        } catch {
          // Fallback to direct execution if check fails
        }
      }

      await executeQueryInternal(targetSql);
    },
    [query, safeModeEnabled, executeQueryInternal],
  );

  // Cancel running query
  const handleCancelQuery = () => {
    cancelRequestedRef.current = true;
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    setExecutionState("cancelled");
  };

  const handleExplainQuery = useCallback(async () => {
    if (!query.trim()) return;
    setIsExplaining(true);
    setError(null);
    try {
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

  // Keyboard shortcuts:
  // - Ctrl+Enter / Cmd+Enter: Run
  // - Ctrl+Shift+Enter / Alt+X: Explain
  // - Ctrl+H: Open history
  // - Ctrl+S: Open Favorites to save
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) {
          handleExplainQuery();
        } else {
          handleRunQuery();
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

  const [customWidths, setCustomWidths] = useState<Record<string, number>>({});

  const handleColumnResize = useCallback((column: GridColumn, newSize: number) => {
    if (column.id) {
      setCustomWidths((prev) => ({
        ...prev,
        [column.id!]: Math.max(70, Math.round(newSize)),
      }));
    }
  }, []);

  // Result columns for Glide Data Grid
  const columns: GridColumn[] = useMemo(() => {
    if (!result || !result.columns) return [];
    return result.columns.map((col, idx) => {
      const isPk = activePkColumns.includes(col);

      // Auto estimate width based on column title and sample row contents
      let estimatedWidth = Math.max(140, col.length * 9 + 45);
      if (result.rows && result.rows.length > 0) {
        const sampleLimit = Math.min(50, result.rows.length);
        for (let r = 0; r < sampleLimit; r++) {
          const val = result.rows[r][idx];
          if (val !== null && val !== undefined) {
            const strLen = String(val).length;
            estimatedWidth = Math.max(estimatedWidth, Math.min(650, strLen * 8.8 + 40));
          }
        }
      }

      return {
        title: isPk ? `🔑 ${col}` : col,
        id: col,
        width: customWidths[col] ?? Math.round(estimatedWidth),
        hasMenu: false,
      };
    });
  }, [result, activePkColumns, customWidths]);

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const rowData = result?.rows[row];
      const val = rowData ? rowData[col] : null;
      const isReadonly = !canEditResult;

      if (val === null || val === undefined) {
        return {
          kind: GridCellKind.Text,
          allowOverlay: !isReadonly,
          readonly: isReadonly,
          displayData: "NULL",
          data: "",
          themeOverride: {
            textDark: "#64748b",
            baseFontStyle: "italic 11px monospace",
          },
        };
      }

      const str = typeof val === "object" ? JSON.stringify(val) : String(val);
      return {
        kind: GridCellKind.Text,
        allowOverlay: !isReadonly,
        readonly: isReadonly,
        displayData: str,
        data: str,
      };
    },
    [result, canEditResult],
  );

  // In-place real-time cell editing on query results
  const onCellEdited = useCallback(
    async ([col, row]: Item, newValue: EditableGridCell) => {
      if (newValue.kind !== GridCellKind.Text || !result) return;
      if (!canEditResult) {
        setSaveStatus({
          success: false,
          message:
            "Edición deshabilitada: Se requiere una tabla con clave primaria completa presente en los resultados.",
        });
        setTimeout(() => setSaveStatus(null), 5000);
        return;
      }

      const colName = result.columns[col];
      const updatedVal = newValue.data;
      const rowData = result.rows[row];

      // Build composite primary key conditions
      const primaryKeys: PrimaryKeyCondition[] = [];
      for (const pkCol of activePkColumns) {
        const pkIdx = result.columns.indexOf(pkCol);
        if (pkIdx === -1) {
          setSaveStatus({
            success: false,
            message: `Error: La columna de clave primaria '${pkCol}' no está en los resultados.`,
          });
          setTimeout(() => setSaveStatus(null), 5000);
          return;
        }
        const pkVal = rowData[pkIdx];
        if (pkVal === undefined || pkVal === null) {
          setSaveStatus({
            success: false,
            message: `Error: El valor de la clave primaria '${pkCol}' es nulo en esta fila.`,
          });
          setTimeout(() => setSaveStatus(null), 5000);
          return;
        }
        primaryKeys.push({ column: pkCol, value: pkVal });
      }

      try {
        await dbService.updateCell({
          database,
          table: activeTargetTable,
          column_name: colName,
          new_value: updatedVal,
          primary_keys: primaryKeys,
        });

        // Update in local state immediately
        const newRows = [...result.rows];
        const newRow = [...newRows[row]];
        newRow[col] = updatedVal;
        newRows[row] = newRow;
        setResult((prev) => (prev ? { ...prev, rows: newRows } : prev));
        setSelectedRowIndex(row);

        const pkSummary = primaryKeys.map((k) => `${k.column}=${k.value}`).join(", ");
        setSaveStatus({
          success: true,
          message: `Guardado en MariaDB: \`${activeTargetTable}\`.\`${colName}\` = "${updatedVal}" (${pkSummary})`,
        });
        setTimeout(() => setSaveStatus(null), 3500);
      } catch (err: unknown) {
        const errorMsg =
          typeof err === "string"
            ? err
            : (err as Error)?.message || "Error al actualizar en BD";
        setSaveStatus({
          success: false,
          message: `Error al actualizar: ${errorMsg}`,
        });
        setTimeout(() => setSaveStatus(null), 6000);
      }
    },
    [result, canEditResult, activePkColumns, activeTargetTable, database],
  );

  // Save complete row from EditRecordModal
  const handleSaveRow = async (updatedRow: any[]) => {
    if (selectedRowIndex === null || !result) return;
    if (!canEditResult) {
      throw new Error(
        "No se puede guardar: Se requiere especificar la tabla y que todas las columnas de la clave primaria estén incluidas en la consulta.",
      );
    }

    const currentRow = result.rows[selectedRowIndex];
    const primaryKeys: PrimaryKeyCondition[] = [];
    for (const pkCol of activePkColumns) {
      const pkIdx = result.columns.indexOf(pkCol);
      if (pkIdx === -1) {
        throw new Error(
          `La columna de clave primaria '${pkCol}' no está presente en los resultados.`,
        );
      }
      const pkVal = currentRow[pkIdx];
      if (pkVal === undefined || pkVal === null) {
        throw new Error(
          `El valor de la clave primaria '${pkCol}' es nulo en la fila seleccionada.`,
        );
      }
      primaryKeys.push({ column: pkCol, value: pkVal });
    }

    let updateCount = 0;
    for (let c = 0; c < result.columns.length; c++) {
      const colName = result.columns[c];
      const oldVal = currentRow[c];
      const newVal = updatedRow[c];

      if (String(oldVal ?? "") !== String(newVal ?? "")) {
        await dbService.updateCell({
          database,
          table: activeTargetTable,
          column_name: colName,
          new_value: newVal,
          primary_keys: primaryKeys,
        });
        updateCount++;
      }
    }

    const newRows = [...result.rows];
    newRows[selectedRowIndex] = [...updatedRow];
    setResult((prev) => (prev ? { ...prev, rows: newRows } : prev));

    setSaveStatus({
      success: true,
      message:
        updateCount > 0
          ? `Fila #${selectedRowIndex + 1} actualizada: ${updateCount} campo(s) guardado(s) en \`${activeTargetTable}\`.`
          : `Sin cambios en la fila #${selectedRowIndex + 1}.`,
    });
    setTimeout(() => setSaveStatus(null), 4000);
  };

  const pyroTheme = useMemo(
    () => ({
      accentColor: "#ff5c16",
      accentLight: "rgba(255, 92, 22, 0.15)",
      bgCell: "#0d0f15",
      bgCellMedium: "#11141c",
      bgHeader: "#131722",
      bgHeaderHasFocus: "#1a202d",
      bgHeaderHovered: "#181d29",
      textDark: "#e2e8f0",
      textMedium: "#94a3b8",
      textLight: "#64748b",
      textHeader: "#f1f5f9",
      borderColor: "#1e2434",
      drilldownBorder: "#2a3246",
      lineHeight: 1.4,
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      baseFontStyle: "12px ui-monospace",
      headerFontStyle: "600 12px -apple-system, BlinkMacSystemFont, sans-serif",
      editorFontSize: "12px",
    }),
    [],
  );

  return (
    <div
      onKeyDown={handleKeyDown}
      className="flex-1 flex flex-col h-full bg-[#0b0d13] overflow-hidden"
    >
      {/* Top Action Toolbar */}
      <div className="px-4 py-2 bg-[#10131b] border-b border-[#1b202e] flex flex-wrap items-center justify-between gap-3 text-xs select-none">
        <div className="flex items-center space-x-2">
          {/* Run Query / Cancel Button */}
          {executionState === "executing" ? (
            <button
              onClick={handleCancelQuery}
              title="Cancelar ejecución de la consulta"
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-red-600/80 hover:bg-red-600 text-white rounded-md font-semibold shadow-md shadow-red-950/40 transition-all active:scale-95 animate-pulse"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Cancelar</span>
            </button>
          ) : (
            <button
              onClick={() => handleRunQuery()}
              title="Ejecutar consulta en MariaDB (Ctrl+Enter)"
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white rounded-md font-semibold shadow-md shadow-orange-950/40 transition-all active:scale-95"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Ejecutar (Ctrl+Enter)</span>
            </button>
          )}

          {/* Explain Query Button */}
          <button
            onClick={handleExplainQuery}
            disabled={isExplaining || executionState === "executing"}
            title="Generar plan de ejecución EXPLAIN para optimizar la consulta (Ctrl+Shift+Enter)"
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#171b26] hover:bg-[#212737] text-orange-300 border border-orange-500/30 hover:border-orange-500/60 rounded-md font-medium transition-all disabled:opacity-50"
          >
            {isExplaining ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-400" />
            ) : (
              <Activity className="w-3.5 h-3.5 text-orange-400" />
            )}
            <span>Explicar (EXPLAIN)</span>
          </button>

          {/* SQL Copilot Assistant Button */}
          <button
            onClick={() => {
              setCopilotAction("explain");
              setIsCopilotOpen(true);
            }}
            disabled={executionState === "executing"}
            title="Abrir SQL Copilot (Explicar, Optimizar, Diagnosticar y Generar pruebas con IA)"
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-950/60 to-indigo-950/60 hover:from-purple-900/70 hover:to-indigo-900/70 text-purple-200 border border-purple-500/40 hover:border-purple-400/60 rounded-md font-semibold transition-all disabled:opacity-50 shadow-xs"
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-300" />
            <span>SQL Copilot</span>
          </button>

          {/* History Button */}
          <button
            onClick={() => setIsHistoryModalOpen(true)}
            title="Abrir historial de consultas ejecutadas (Ctrl+H)"
            className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-[#141824] hover:bg-[#1e2436] text-neutral-300 hover:text-white border border-[#21283a] rounded-md font-medium transition-colors"
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
            title="Abrir consultas favoritas y snippets (Ctrl+S para guardar)"
            className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-[#141824] hover:bg-[#1e2436] text-neutral-300 hover:text-white border border-[#21283a] rounded-md font-medium transition-colors"
          >
            <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400/20" />
            <span>Favoritos</span>
          </button>

          {/* Save to Favorites Quick Button */}
          <button
            onClick={() => {
              setInitialFavToSave(query);
              setIsFavoritesModalOpen(true);
            }}
            title="Guardar consulta actual en favoritos"
            className="p-1.5 bg-[#141824] hover:bg-[#1e2436] text-neutral-400 hover:text-amber-400 border border-[#21283a] rounded-md transition-colors"
          >
            <BookmarkPlus className="w-3.5 h-3.5" />
          </button>

          {/* Safe Mode Toggle Badge */}
          <button
            onClick={toggleSafeMode}
            title={
              safeModeEnabled
                ? "Modo Seguro ACTIVO: Protege contra sentencias destructivas accidentales (DROP, TRUNCATE, DELETE/UPDATE sin WHERE)."
                : "Modo Seguro DESACTIVADO: Las consultas se ejecutarán directamente sin confirmación."
            }
            className={`flex items-center space-x-1 px-2.5 py-1 rounded border text-[11px] font-mono transition-colors ${
              safeModeEnabled
                ? "bg-emerald-950/30 border-emerald-700/50 text-emerald-400 hover:bg-emerald-950/50"
                : "bg-amber-950/30 border-amber-700/50 text-amber-400 hover:bg-amber-950/50"
            }`}
          >
            {safeModeEnabled ? (
              <>
                <Shield className="w-3 h-3 text-emerald-400" />
                <span>Seguro: ON</span>
              </>
            ) : (
              <>
                <ShieldAlert className="w-3 h-3 text-amber-400" />
                <span>Seguro: OFF</span>
              </>
            )}
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

      {/* SQL Editor Area (CodeMirror 6) */}
      <div className="h-44 border-b border-[#1c2232] overflow-hidden bg-[#0d0f15]">
        <CodeMirror
          value={query}
          height="176px"
          theme="dark"
          extensions={[sql()]}
          onChange={(val) => {
            setQuery(val);
            onQueryChange?.(val);
          }}
          className="text-xs font-mono"
        />
      </div>

      {/* Sub-tab Navigation & Target Table Binding Bar */}
      {(result || explainResult) && (
        <div className="px-4 bg-[#0f121a] border-b border-[#1b202e] flex flex-wrap items-center justify-between gap-3 text-xs font-medium select-none">
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
              {/* Target table input */}
              <div className="flex items-center space-x-1.5 bg-[#141824] border border-[#232a3c] rounded px-2 py-0.5 text-[11px] font-mono">
                <span className="text-neutral-400">Tabla Destino:</span>
                <input
                  type="text"
                  value={targetTableOverride || detectedTargetTable || ""}
                  onChange={(e) => setTargetTableOverride(e.target.value)}
                  placeholder="tabla_bd"
                  className="bg-transparent text-orange-300 w-24 focus:outline-none focus:text-white font-semibold"
                />
              </div>

              {/* Primary Key indicator/selector */}
              {result.columns.length > 0 && (
                <div className="flex items-center space-x-1.5 bg-[#141824] border border-[#232a3c] rounded px-2 py-0.5 text-[11px] font-mono">
                  <Key className="w-3 h-3 text-amber-400" />
                  <span className="text-neutral-400">PK:</span>
                  {activePkColumns.length > 0 ? (
                    <span
                      className="text-amber-300 font-semibold"
                      title={`Clave Primaria: ${activePkColumns.join(", ")}`}
                    >
                      {activePkColumns.join(", ")}
                    </span>
                  ) : (
                    <select
                      value={targetPkOverride}
                      onChange={(e) => setTargetPkOverride(e.target.value)}
                      className="bg-transparent text-amber-300 text-[11px] focus:outline-none cursor-pointer"
                    >
                      <option value="" className="bg-[#141824] text-neutral-400">
                        (Sin PK definida)
                      </option>
                      {result.columns.map((c) => (
                        <option key={c} value={c} className="bg-[#141824] text-white">
                          {c}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Read-only / safety badge */}
              {!canEditResult && (
                <span
                  title={
                    !activeTargetTable
                      ? "Edición deshabilitada: Especifica la tabla destino para editar."
                      : !hasPrimaryKey
                      ? "Esta tabla no tiene una clave primaria. La edición y eliminación de registros está deshabilitada para evitar modificaciones ambiguas."
                      : "La consulta no incluye todas las columnas de la clave primaria."
                  }
                  className="px-2 py-0.5 rounded bg-neutral-800/60 border border-neutral-700/40 text-neutral-400 text-[11px] font-mono"
                >
                  Solo Lectura
                </span>
              )}

              {/* Edit Selected Row Button */}
              {selectedRowIndex !== null && result.rows[selectedRowIndex] && (
                <button
                  onClick={() => {
                    if (!canEditResult) {
                      const msg = !activeTargetTable
                        ? "Por favor especifica la tabla destino en la barra superior."
                        : !hasPrimaryKey
                        ? "Esta tabla no tiene una clave primaria. La edición y eliminación de registros está deshabilitada para evitar modificaciones ambiguas."
                        : "Asegúrate de que todas las columnas de la clave primaria estén incluidas en la consulta.";
                      useUIStore.getState().showAlert({
                        title: "Edición no Disponible",
                        message: msg,
                        variant: "warning",
                        icon: "alert",
                      });
                      return;
                    }
                    setIsEditModalOpen(true);
                  }}
                  disabled={!canEditResult}
                  title={
                    canEditResult
                      ? "Abrir formulario para editar todos los valores de la fila seleccionada"
                      : "Deshabilitado: Se requiere una tabla con clave primaria completa en los resultados."
                  }
                  className={`flex items-center space-x-1 px-2.5 py-1 rounded text-xs font-medium transition-all active:scale-95 ${
                    canEditResult
                      ? "bg-orange-600/20 hover:bg-orange-600/30 text-orange-300 border border-orange-500/40"
                      : "bg-neutral-800/40 text-neutral-500 border border-neutral-700/30 cursor-not-allowed opacity-50"
                  }`}
                >
                  <Edit3 className="w-3.5 h-3.5 text-orange-400" />
                  <span>Editar Fila #{selectedRowIndex + 1}</span>
                </button>
              )}

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
                    setCopilotAction("fix");
                    setIsCopilotOpen(true);
                  }}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded text-xs font-semibold shadow-sm transition-all"
                >
                  <Bug className="w-3.5 h-3.5" />
                  <span>Corregir con Copilot</span>
                </button>
                <button
                  onClick={() => setIsAssistantModalOpen(true)}
                  className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-purple-950/40 hover:bg-purple-900/50 text-purple-200 border border-purple-700/50 rounded text-xs font-semibold transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                  <span>Asistente</span>
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
            planRows={[]}
            rawResult={{
              columns: explainResult.columns,
              rows: explainResult.rows,
              execution_time_ms: explainResult.execution_time_ms,
            }}
          />
        ) : result ? (
          result.columns.length > 0 ? (
            <div className="flex-1 w-full h-full relative overflow-hidden">
              <DataEditor
                width="100%"
                height="100%"
                columns={columns}
                rows={result.rows.length}
                getCellContent={getCellContent}
                onCellEdited={onCellEdited}
                onColumnResize={handleColumnResize}
                onCellClicked={([, row]: Item) => setSelectedRowIndex(row)}
                onCellActivated={([, row]: Item) => setSelectedRowIndex(row)}
                theme={pyroTheme}
                rowMarkers="both"
                smoothScrollX
                smoothScrollY
                getCellsForSelection
                verticalBorder
                fillHandle
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

      {/* Edit Record Modal */}
      {isEditModalOpen && selectedRowIndex !== null && result && result.rows[selectedRowIndex] && (
        <EditRecordModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          database={database}
          tableName={activeTargetTable}
          pkColumns={activePkColumns}
          columns={result.columns}
          rowData={result.rows[selectedRowIndex]}
          rowIndex={selectedRowIndex}
          onSave={handleSaveRow}
        />
      )}

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

      {/* SQL Assistant & AI Metadata Context Modal */}
      {isAssistantModalOpen && (
        <SqlAssistantModal
          isOpen={isAssistantModalOpen}
          onClose={() => setIsAssistantModalOpen(false)}
          database={database}
          query={query}
          errorMessage={error || undefined}
          onApplyRewrite={(rewrittenSql) => {
            setQuery(rewrittenSql);
            onQueryChange?.(rewrittenSql);
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
    </div>
  );
};
