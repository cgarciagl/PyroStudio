import React, { useState, useCallback, useMemo } from "react";
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
import type { QueryExecutionResult } from "../types/database";
import { QueryPlanViewer } from "./QueryPlanViewer";
import { EditRecordModal } from "./EditRecordModal";

interface QueryEditorTabProps {
  database: string;
  initialQuery?: string;
}

export const QueryEditorTab: React.FC<QueryEditorTabProps> = ({
  database,
  initialQuery = "SELECT * FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() LIMIT 100;",
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

  // Target table and PK overrides
  const [targetTableOverride, setTargetTableOverride] = useState<string>("");
  const [targetPkOverride, setTargetPkOverride] = useState<string>("");

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

  const detectedPk = useMemo(() => {
    if (!result || !result.columns || result.columns.length === 0) return "";
    return (
      result.columns.find(
        (c) =>
          c.toLowerCase() === "id" ||
          c.toLowerCase().endsWith("_id") ||
          c.toLowerCase().startsWith("id_"),
      ) || result.columns[0]
    );
  }, [result]);

  const activeTargetPk = targetPkOverride.trim() || detectedPk || "";

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
      const isPk = col === activeTargetPk;
      return {
        title: isPk ? `🔑 ${col}` : col,
        id: col,
        width: Math.max(130, Math.min(320, col.length * 12 + 45)),
        hasMenu: false,
      };
    });
  }, [result, activeTargetPk]);

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const rowData = result?.rows[row];
      const val = rowData ? rowData[col] : null;

      if (val === null || val === undefined) {
        return {
          kind: GridCellKind.Text,
          allowOverlay: true,
          readonly: false,
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
        allowOverlay: true,
        readonly: false,
        displayData: str,
        data: str,
      };
    },
    [result],
  );

  // In-place real-time cell editing on query results
  const onCellEdited = useCallback(
    async ([col, row]: Item, newValue: EditableGridCell) => {
      if (newValue.kind !== GridCellKind.Text || !result) return;
      const colName = result.columns[col];
      const updatedVal = newValue.data;

      const newRows = [...result.rows];
      const rowData = [...newRows[row]];
      rowData[col] = updatedVal;
      newRows[row] = rowData;

      // Update in local state immediately
      setResult((prev) => (prev ? { ...prev, rows: newRows } : prev));
      setSelectedRowIndex(row);

      const targetTbl = activeTargetTable;
      if (targetTbl) {
        const pkCol = activeTargetPk || result.columns[0];
        const pkIdx = result.columns.indexOf(pkCol);
        const pkValue = result.rows[row][pkIdx >= 0 ? pkIdx : 0];

        if (pkValue !== undefined && pkValue !== null) {
          try {
            await dbService.updateCell({
              database,
              table: targetTbl,
              column_name: colName,
              new_value: updatedVal,
              primary_key_column: pkCol,
              primary_key_value: pkValue,
            });

            setSaveStatus({
              success: true,
              message: `Guardado en MariaDB: \`${targetTbl}\`.\`${colName}\` = "${updatedVal}" (PK: ${pkValue})`,
            });
            setTimeout(() => setSaveStatus(null), 3500);
            return;
          } catch (err: unknown) {
            const errorMsg =
              typeof err === "string"
                ? err
                : (err as Error)?.message || "Error al actualizar en BD";
            setSaveStatus({
              success: false,
              message: `Modificado en grid (Error BD: ${errorMsg})`,
            });
            setTimeout(() => setSaveStatus(null), 6000);
            return;
          }
        }
      }

      setSaveStatus({
        success: true,
        message: `Valor [${colName}] modificado en la vista de resultados. (Selecciona una tabla destino para guardar en BD)`,
      });
      setTimeout(() => setSaveStatus(null), 3500);
    },
    [result, activeTargetTable, activeTargetPk, database],
  );

  // Save complete row from EditRecordModal
  const handleSaveRow = async (updatedRow: any[]) => {
    if (selectedRowIndex === null || !result) return;
    const targetTbl = activeTargetTable;
    if (!targetTbl) {
      throw new Error("Por favor especifica el nombre de la tabla destino en la barra superior para guardar los cambios.");
    }

    const pkCol = activeTargetPk || result.columns[0];
    const pkIdx = result.columns.indexOf(pkCol);
    const pkValue = result.rows[selectedRowIndex][pkIdx >= 0 ? pkIdx : 0];

    if (pkValue === undefined || pkValue === null) {
      throw new Error(`No se encontró el valor de la clave primaria '${pkCol}' en la fila seleccionada.`);
    }

    const originalRow = result.rows[selectedRowIndex];
    let updateCount = 0;

    for (let c = 0; c < result.columns.length; c++) {
      const colName = result.columns[c];
      const oldVal = originalRow[c];
      const newVal = updatedRow[c];

      // If value changed
      if (String(oldVal ?? "") !== String(newVal ?? "")) {
        await dbService.updateCell({
          database,
          table: targetTbl,
          column_name: colName,
          new_value: newVal,
          primary_key_column: pkCol,
          primary_key_value: pkValue,
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
      message: updateCount > 0
        ? `Fila #${selectedRowIndex + 1} actualizada: ${updateCount} campo(s) guardado(s) en \`${targetTbl}\`.`
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
          onChange={(val) => setQuery(val)}
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

              {/* Primary Key selector */}
              {result.columns.length > 0 && (
                <div className="flex items-center space-x-1.5 bg-[#141824] border border-[#232a3c] rounded px-2 py-0.5 text-[11px] font-mono">
                  <Key className="w-3 h-3 text-amber-400" />
                  <span className="text-neutral-400">PK:</span>
                  <select
                    value={activeTargetPk}
                    onChange={(e) => setTargetPkOverride(e.target.value)}
                    className="bg-transparent text-amber-300 text-[11px] focus:outline-none cursor-pointer"
                  >
                    {result.columns.map((c) => (
                      <option key={c} value={c} className="bg-[#141824] text-white">
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Edit Selected Row Button */}
              {selectedRowIndex !== null && result.rows[selectedRowIndex] && (
                <button
                  onClick={() => setIsEditModalOpen(true)}
                  title="Abrir formulario para editar todos los valores de la fila seleccionada"
                  className="flex items-center space-x-1 px-2.5 py-1 bg-orange-600/20 hover:bg-orange-600/30 text-orange-300 border border-orange-500/40 rounded text-xs font-medium transition-all active:scale-95"
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
          pkColumn={activeTargetPk}
          columns={result.columns}
          rowData={result.rows[selectedRowIndex]}
          rowIndex={selectedRowIndex}
          onSave={handleSaveRow}
        />
      )}
    </div>
  );
};
