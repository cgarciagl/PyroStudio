import React, { useState, useCallback, useMemo, useEffect } from "react";
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
  Zap,
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
} from "lucide-react";
import { dbService } from "../services/tauriDb";
import type { QueryExecutionResult, PrimaryKeyCondition } from "../types/database";
import { QueryPlanViewer } from "./QueryPlanViewer";
import { EditRecordModal } from "./EditRecordModal";

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
  const [isExecuting, setIsExecuting] = useState(false);
  const [isExplaining, setIsExplaining] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [result, setResult] = useState<QueryExecutionResult | null>(null);
  const [explainResult, setExplainResult] = useState<QueryExecutionResult | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<"results" | "plan">("results");
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<{
    success?: boolean;
    message?: string;
  } | null>(null);

  // Row selection & Row Editor modal
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Target table and PK state
  const [targetTableOverride, setTargetTableOverride] = useState<string>("");
  const [targetPkOverride, setTargetPkOverride] = useState<string>("");
  const [tablePkColumns, setTablePkColumns] = useState<string[]>([]);

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

  const handleRunQuery = useCallback(async () => {
    if (!query.trim()) return;
    setIsExecuting(true);
    setError(null);
    setSelectedRowIndex(null);
    try {
      const res = await dbService.executeQuery(query, database);
      setResult(res);
      setActiveSubTab("results");
      if (res.rows.length > 0) {
        setSelectedRowIndex(0);
      }
    } catch (err: unknown) {
      const msg =
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Error al ejecutar la consulta";
      setError(msg);
      setResult(null);
    } finally {
      setIsExecuting(false);
    }
  }, [query, database]);

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
    if (!result || !result.columns || result.rows.length === 0) return;
    setIsExporting(true);
    try {
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
      const defaultName = `consulta_${database}_${timestamp}.xlsx`;
      const chosenPath = await dbService.saveExcelDialog(defaultName);
      if (!chosenPath) {
        setIsExporting(false);
        return;
      }

      const summary = await dbService.exportDataset(
        result.columns,
        result.rows,
        chosenPath,
      );

      setSaveStatus({
        success: true,
        message: `Excel generado: ${summary.total_rows} filas exportadas (${summary.execution_time_ms} ms)`,
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
  }, [result, database]);

  // Handle Ctrl+Enter to execute, Ctrl+Shift+Enter or Alt+X to explain
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        handleExplainQuery();
      } else {
        handleRunQuery();
      }
    }
  };

  // Result columns for Glide Data Grid
  const columns: GridColumn[] = useMemo(() => {
    if (!result || !result.columns) return [];
    return result.columns.map((col) => {
      const isPk = activePkColumns.includes(col);
      return {
        title: isPk ? `🔑 ${col}` : col,
        id: col,
        width: Math.max(130, Math.min(320, col.length * 12 + 45)),
        hasMenu: false,
      };
    });
  }, [result, activePkColumns]);

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

      // If value changed
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

    // Update in local memory state
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
      {/* Top action toolbar */}
      <div className="px-4 py-2 bg-[#10131b] border-b border-[#1b202e] flex flex-wrap items-center justify-between gap-3 text-xs select-none">
        <div className="flex items-center space-x-2.5">
          <button
            onClick={handleRunQuery}
            disabled={isExecuting}
            title="Ejecutar consulta en MariaDB (Ctrl+Enter)"
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white rounded-md font-semibold shadow-md shadow-orange-950/40 transition-all disabled:opacity-50 active:scale-95"
          >
            {isExecuting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current" />
            )}
            <span>Ejecutar (Ctrl+Enter)</span>
          </button>

          <button
            onClick={handleExplainQuery}
            disabled={isExplaining || isExecuting}
            title="Generar plan de ejecución EXPLAIN para optimizar la consulta"
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#171b26] hover:bg-[#212737] text-orange-300 border border-orange-500/30 hover:border-orange-500/60 rounded-md font-medium transition-all disabled:opacity-50"
          >
            {isExplaining ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-400" />
            ) : (
              <Activity className="w-3.5 h-3.5 text-orange-400" />
            )}
            <span>Explicar Plan (EXPLAIN)</span>
          </button>

          <div className="flex items-center space-x-1.5 px-2.5 py-1 bg-[#141824] border border-[#21283a] rounded text-neutral-400 font-mono text-[11px]">
            <Database className="w-3 h-3 text-orange-400" />
            <span>Esquema: <strong className="text-neutral-200">{database || "—"}</strong></span>
          </div>
        </div>

        {/* Live editing / execution banner */}
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

          {result && (
            <div className="flex items-center space-x-2 text-xs font-mono text-neutral-400">
              <span className="flex items-center space-x-1 text-emerald-400">
                <Zap className="w-3 h-3" />
                <span>{result.execution_time_ms} ms</span>
              </span>
              <span>•</span>
              <span>{result.rows.length} filas</span>
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
                      alert(
                        !activeTargetTable
                          ? "Por favor especifica la tabla destino en la barra superior."
                          : !hasPrimaryKey
                          ? "Esta tabla no tiene una clave primaria. La edición y eliminación de registros está deshabilitada para evitar modificaciones ambiguas."
                          : "Asegúrate de que todas las columnas de la clave primaria estén incluidas en la consulta.",
                      );
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
        {error ? (
          <div className="p-4 m-4 rounded-lg bg-red-950/30 border border-red-800/50 text-red-300 text-xs font-mono flex items-start space-x-2.5">
            <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold text-red-200">
                Error en la sentencia SQL:
              </div>
              <div className="mt-1 whitespace-pre-wrap">{error}</div>
            </div>
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
            <span>Presiona 'Ejecutar' (Ctrl+Enter) o 'Explicar Plan' para consultar MariaDB</span>
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
    </div>
  );
};
