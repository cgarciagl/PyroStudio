import React, { useCallback, useMemo, useState, useEffect } from "react";
import DataEditor, {
  GridCell,
  GridCellKind,
  GridColumn,
  Item,
  EditableGridCell,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import {
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  Zap,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Database,
  Edit3,
} from "lucide-react";
import type { TableDataResult } from "../types/database";
import { dbService } from "../services/tauriDb";
import { EditRecordModal } from "./EditRecordModal";

interface DataGridCanvasProps {
  database: string;
  table: string;
  primaryKeyColumn?: string;
}

export const DataGridCanvas: React.FC<DataGridCanvasProps> = ({
  database,
  table,
  primaryKeyColumn,
}) => {
  const [dataResult, setDataResult] = useState<TableDataResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [pageSize, setPageSize] = useState<number>(1000);
  const [pageOffset, setPageOffset] = useState<number>(0);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{
    success?: boolean;
    message?: string;
  } | null>(null);

  const loadData = useCallback(
    async (offset = pageOffset, limit = pageSize) => {
      setIsLoading(true);
      try {
        const result = await dbService.queryTableData(
          database,
          table,
          limit,
          offset,
        );
        setDataResult(result);
      } catch (err) {
        console.error("Failed to load table data:", err);
      } finally {
        setIsLoading(false);
      }
    },
    [database, table, pageOffset, pageSize],
  );

  useEffect(() => {
    loadData(0, pageSize);
    setPageOffset(0);
  }, [database, table, loadData, pageSize]);

  // Columns definition for Glide Data Grid
  const columns: GridColumn[] = useMemo(() => {
    if (!dataResult || !dataResult.columns) return [];
    return dataResult.columns.map((col, idx) => {
      const colType = dataResult.column_types?.[idx] ? ` (${dataResult.column_types[idx]})` : "";
      const isPk = col === primaryKeyColumn;
      return {
        title: isPk ? `🔑 ${col}${colType}` : `${col}${colType}`,
        id: col,
        width: Math.max(130, Math.min(300, col.length * 12 + 40)),
        hasMenu: true,
      };
    });
  }, [dataResult, primaryKeyColumn]);

  // Filtered rows for client-side search in current batch
  const displayRows = useMemo(() => {
    if (!dataResult) return [];
    if (!searchTerm.trim()) return dataResult.rows;

    const term = searchTerm.toLowerCase();
    return dataResult.rows.filter((row) =>
      row.some((val) =>
        val !== null && val !== undefined
          ? String(val).toLowerCase().includes(term)
          : false,
      ),
    );
  }, [dataResult, searchTerm]);

  // Glide Data Grid cell supplier callback
  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const rowData = displayRows[row];
      const value = rowData ? rowData[col] : null;

      if (value === null || value === undefined) {
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

      const str =
        typeof value === "object" ? JSON.stringify(value) : String(value);

      return {
        kind: GridCellKind.Text,
        allowOverlay: true,
        readonly: false,
        displayData: str,
        data: str,
      };
    },
    [displayRows],
  );

  // In-place real-time cell editing like Navicat
  const onCellEdited = useCallback(
    async ([col, row]: Item, newValue: EditableGridCell) => {
      if (newValue.kind !== GridCellKind.Text || !dataResult) return;
      const colName = dataResult.columns[col];
      const updatedValue = newValue.data;

      // Identify primary key column or default to column 0
      const pkCol = primaryKeyColumn || dataResult.columns[0];
      const pkIndex = dataResult.columns.indexOf(pkCol);
      const rowData = displayRows[row];
      const pkValue = rowData[pkIndex];

      try {
        await dbService.updateCell({
          database,
          table,
          primary_key_column: pkCol,
          primary_key_value: pkValue,
          column_name: colName,
          new_value: updatedValue,
        });

        // Mutate local state
        const rowIndexInData = dataResult.rows.indexOf(rowData);
        if (rowIndexInData !== -1) {
          const newRows = [...dataResult.rows];
          newRows[rowIndexInData] = [...newRows[rowIndexInData]];
          newRows[rowIndexInData][col] = updatedValue;
          setDataResult((prev) => (prev ? { ...prev, rows: newRows } : prev));
        }

        setSaveStatus({
          success: true,
          message: `Celda [${colName}] actualizada en tiempo real en MariaDB.`,
        });
        setTimeout(() => setSaveStatus(null), 3500);
      } catch (err: unknown) {
        const errorMsg =
          typeof err === "string"
            ? err
            : (err as Error)?.message || "Error al actualizar";
        setSaveStatus({
          success: false,
          message: `Error al actualizar: ${errorMsg}`,
        });
        setTimeout(() => setSaveStatus(null), 6000);
      }
    },
    [dataResult, displayRows, primaryKeyColumn, database, table],
  );

  // Save complete row from EditRecordModal
  const handleSaveRow = async (updatedRow: any[]) => {
    if (selectedRowIndex === null || !dataResult || !displayRows[selectedRowIndex]) return;
    const pkCol = primaryKeyColumn || dataResult.columns[0];
    const pkIdx = dataResult.columns.indexOf(pkCol);
    const currentRow = displayRows[selectedRowIndex];
    const pkValue = currentRow[pkIdx >= 0 ? pkIdx : 0];

    if (pkValue === undefined || pkValue === null) {
      throw new Error(`No se encontró el valor de la clave primaria '${pkCol}' en la fila seleccionada.`);
    }

    let updateCount = 0;
    for (let c = 0; c < dataResult.columns.length; c++) {
      const colName = dataResult.columns[c];
      const oldVal = currentRow[c];
      const newVal = updatedRow[c];

      if (String(oldVal ?? "") !== String(newVal ?? "")) {
        await dbService.updateCell({
          database,
          table,
          column_name: colName,
          new_value: newVal,
          primary_key_column: pkCol,
          primary_key_value: pkValue,
        });
        updateCount++;
      }
    }

    const rowIndexInData = dataResult.rows.indexOf(currentRow);
    if (rowIndexInData !== -1) {
      const newRows = [...dataResult.rows];
      newRows[rowIndexInData] = [...updatedRow];
      setDataResult((prev) => (prev ? { ...prev, rows: newRows } : prev));
    }

    setSaveStatus({
      success: true,
      message: updateCount > 0
        ? `Fila #${selectedRowIndex + 1} actualizada: ${updateCount} campo(s) guardado(s) en '${table}'.`
        : `Sin cambios en la fila #${selectedRowIndex + 1}.`,
    });
    setTimeout(() => setSaveStatus(null), 4000);
  };

  // Pyro Dark Theme for Glide Data Grid Canvas
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
      textHeaderSelected: "#ffffff",
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

  const totalRowsCount = dataResult?.total_rows ?? displayRows.length;
  const currentStart = pageOffset + 1;
  const currentEnd = Math.min(pageOffset + pageSize, totalRowsCount);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0a0c10] overflow-hidden">
      {/* Control bar / Grid Toolbar */}
      <div className="px-4 py-2 bg-[#10131a] border-b border-[#1c2230] flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center space-x-3">
          {/* Quick filter within loaded rows */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Buscar en resultados..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 pr-3 py-1.5 bg-[#0a0c10] border border-[#23293a] rounded text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-orange-500/60 font-mono text-xs w-48 sm:w-60"
            />
          </div>

          <button
            onClick={() => loadData(pageOffset, pageSize)}
            disabled={isLoading}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#171b26] hover:bg-[#202636] border border-[#252c3e] rounded text-neutral-300 transition-colors disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-orange-400 ${
                isLoading ? "animate-spin" : ""
              }`}
            />
            <span>Refrescar Grid</span>
          </button>

          {/* Edit Row Button */}
          {selectedRowIndex !== null && displayRows[selectedRowIndex] && (
            <button
              onClick={() => setIsEditModalOpen(true)}
              title="Abrir formulario para editar todos los campos de la fila seleccionada"
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-orange-600/20 hover:bg-orange-600/30 text-orange-300 border border-orange-500/40 rounded text-xs font-semibold transition-all active:scale-95"
            >
              <Edit3 className="w-3.5 h-3.5 text-orange-400" />
              <span>Editar Fila #{selectedRowIndex + 1}</span>
            </button>
          )}

          {dataResult && (
            <div className="hidden sm:flex items-center space-x-2 text-neutral-400 font-mono text-[11px]">
              <span className="flex items-center space-x-1 text-emerald-400">
                <Zap className="w-3 h-3" />
                <span>{dataResult.execution_time_ms} ms</span>
              </span>
              <span>•</span>
              <span>
                {displayRows.length} de {totalRowsCount.toLocaleString()} filas
              </span>
            </div>
          )}
        </div>

        {/* Live editing status banner */}
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
            <span className="truncate max-w-xs">{saveStatus.message}</span>
          </div>
        )}

        {/* Pagination controls */}
        <div className="flex items-center space-x-2">
          <select
            value={pageSize}
            onChange={(e) => {
              const newSize = parseInt(e.target.value, 10);
              setPageSize(newSize);
              loadData(0, newSize);
            }}
            className="px-2 py-1 bg-[#0d0f15] border border-[#23293a] rounded text-neutral-300 font-mono text-xs focus:outline-none"
          >
            <option value={100}>100 filas</option>
            <option value={500}>500 filas</option>
            <option value={1000}>1,000 filas</option>
            <option value={5000}>5,000 filas</option>
          </select>

          <button
            onClick={() => {
              const newOffset = Math.max(0, pageOffset - pageSize);
              setPageOffset(newOffset);
              loadData(newOffset, pageSize);
            }}
            disabled={pageOffset === 0 || isLoading}
            className="p-1 rounded bg-[#171b26] hover:bg-[#202636] border border-[#252c3e] text-neutral-300 disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <span className="font-mono text-[11px] text-neutral-400 px-1">
            {totalRowsCount > 0
              ? `${currentStart}-${currentEnd} / ${totalRowsCount.toLocaleString()}`
              : "0 filas"}
          </span>

          <button
            onClick={() => {
              const newOffset = pageOffset + pageSize;
              setPageOffset(newOffset);
              loadData(newOffset, pageSize);
            }}
            disabled={
              pageOffset + pageSize >= totalRowsCount || isLoading
            }
            className="p-1 rounded bg-[#171b26] hover:bg-[#202636] border border-[#252c3e] text-neutral-300 disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Canvas Data Grid Container */}
      <div className="flex-1 w-full h-full relative overflow-hidden bg-[#0d0f15]">
        {isLoading && !dataResult && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/50 backdrop-blur-xs space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
            <span className="text-xs text-neutral-300 font-mono">
              Cargando registros desde MariaDB...
            </span>
          </div>
        )}

        {columns.length > 0 ? (
          <DataEditor
            width="100%"
            height="100%"
            columns={columns}
            rows={displayRows.length}
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
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-neutral-500 text-xs">
            <Database className="w-8 h-8 mb-2 opacity-40 text-orange-400" />
            <span>Sin datos para mostrar en esta tabla.</span>
          </div>
        )}
      </div>

      {/* Edit Record Modal */}
      {isEditModalOpen && selectedRowIndex !== null && displayRows[selectedRowIndex] && dataResult && (
        <EditRecordModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          database={database}
          tableName={table}
          pkColumn={primaryKeyColumn || dataResult.columns[0]}
          columns={dataResult.columns}
          rowData={displayRows[selectedRowIndex]}
          rowIndex={selectedRowIndex}
          onSave={handleSaveRow}
        />
      )}
    </div>
  );
};
