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
  AlertTriangle,
  Database,
  Edit3,
  Trash2,
} from "lucide-react";
import type { TableDataResult, PrimaryKeyCondition } from "../types/database";
import { dbService } from "../services/tauriDb";
import { EditRecordModal } from "./EditRecordModal";
import { ConfirmModal } from "./ConfirmModal";

interface DataGridCanvasProps {
  database: string;
  table: string;
  primaryKeyColumns?: string[];
  primaryKeyColumn?: string;
}

export const DataGridCanvas: React.FC<DataGridCanvasProps> = ({
  database,
  table,
  primaryKeyColumns,
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

  const [fetchedPkColumns, setFetchedPkColumns] = useState<string[]>([]);

  useEffect(() => {
    if (primaryKeyColumns && primaryKeyColumns.length > 0) {
      setFetchedPkColumns(primaryKeyColumns);
      return;
    }
    if (primaryKeyColumn) {
      setFetchedPkColumns([primaryKeyColumn]);
      return;
    }
    let isMounted = true;
    dbService.getTablePrimaryKey(database, table)
      .then((pk) => {
        if (isMounted && pk?.columns) {
          setFetchedPkColumns(pk.columns);
        }
      })
      .catch((err) => {
        console.warn("Could not retrieve primary key:", err);
      });
    return () => {
      isMounted = false;
    };
  }, [database, table, primaryKeyColumns, primaryKeyColumn]);

  const activePkColumns = useMemo(() => {
    if (primaryKeyColumns && primaryKeyColumns.length > 0) return primaryKeyColumns;
    if (primaryKeyColumn) return [primaryKeyColumn];
    return fetchedPkColumns;
  }, [primaryKeyColumns, primaryKeyColumn, fetchedPkColumns]);

  const hasPrimaryKey = activePkColumns.length > 0;

  const loadData = useCallback(
    async (offset: number, limit: number) => {
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
    [database, table],
  );

  useEffect(() => {
    setPageOffset(0);
    setSelectedRowIndex(null);
    loadData(0, pageSize);
  }, [database, table, loadData, pageSize]);

  // Columns definition for Glide Data Grid
  const columns: GridColumn[] = useMemo(() => {
    if (!dataResult || !dataResult.columns) return [];
    return dataResult.columns.map((col, idx) => {
      const colType = dataResult.column_types?.[idx] ? ` (${dataResult.column_types[idx]})` : "";
      const isPk = activePkColumns.includes(col);
      return {
        title: isPk ? `🔑 ${col}${colType}` : `${col}${colType}`,
        id: col,
        width: Math.max(130, Math.min(300, col.length * 12 + 40)),
        hasMenu: true,
      };
    });
  }, [dataResult, activePkColumns]);

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

      const isReadonly = !hasPrimaryKey;

      if (value === null || value === undefined) {
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

      const str =
        typeof value === "object" ? JSON.stringify(value) : String(value);

      return {
        kind: GridCellKind.Text,
        allowOverlay: !isReadonly,
        readonly: isReadonly,
        displayData: str,
        data: str,
      };
    },
    [displayRows, hasPrimaryKey],
  );

  // In-place real-time cell editing like Navicat
  const onCellEdited = useCallback(
    async ([col, row]: Item, newValue: EditableGridCell) => {
      if (newValue.kind !== GridCellKind.Text || !dataResult) return;
      if (!hasPrimaryKey) {
        setSaveStatus({
          success: false,
          message: "Esta tabla no tiene una clave primaria. La edición está deshabilitada para evitar modificaciones ambiguas.",
        });
        setTimeout(() => setSaveStatus(null), 5000);
        return;
      }

      const colName = dataResult.columns[col];
      const updatedValue = newValue.data;
      const rowData = displayRows[row];

      // Build composite primary key conditions
      const primaryKeys: PrimaryKeyCondition[] = [];
      for (const pkCol of activePkColumns) {
        const pkIndex = dataResult.columns.indexOf(pkCol);
        if (pkIndex === -1) {
          setSaveStatus({
            success: false,
            message: `Error: La columna de clave primaria '${pkCol}' no está presente en la vista.`,
          });
          setTimeout(() => setSaveStatus(null), 5000);
          return;
        }
        const pkVal = rowData[pkIndex];
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
          table,
          column_name: colName,
          new_value: updatedValue,
          primary_keys: primaryKeys,
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
    [dataResult, displayRows, hasPrimaryKey, activePkColumns, database, table],
  );

  // Save complete row from EditRecordModal
  const handleSaveRow = async (updatedRow: any[]) => {
    if (selectedRowIndex === null || !dataResult || !displayRows[selectedRowIndex]) return;
    if (!hasPrimaryKey) {
      throw new Error("Esta tabla no tiene una clave primaria. La edición está deshabilitada para evitar modificaciones ambiguas.");
    }

    const currentRow = displayRows[selectedRowIndex];
    const primaryKeys: PrimaryKeyCondition[] = [];
    for (const pkCol of activePkColumns) {
      const pkIdx = dataResult.columns.indexOf(pkCol);
      if (pkIdx === -1) {
        throw new Error(`La columna de clave primaria '${pkCol}' no está presente en la tabla.`);
      }
      const pkVal = currentRow[pkIdx];
      if (pkVal === undefined || pkVal === null) {
        throw new Error(`El valor de la clave primaria '${pkCol}' es nulo en la fila seleccionada.`);
      }
      primaryKeys.push({ column: pkCol, value: pkVal });
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
          primary_keys: primaryKeys,
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

  const [rowToDelete, setRowToDelete] = useState<{
    primaryKeys: PrimaryKeyCondition[];
    summary: string;
    currentRow: any[];
  } | null>(null);

  const handleDeleteRow = () => {
    if (selectedRowIndex === null || !dataResult || !displayRows[selectedRowIndex]) return;
    if (!hasPrimaryKey) {
      return;
    }

    const currentRow = displayRows[selectedRowIndex];
    const primaryKeys: PrimaryKeyCondition[] = [];
    for (const pkCol of activePkColumns) {
      const pkIdx = dataResult.columns.indexOf(pkCol);
      if (pkIdx === -1) {
        return;
      }
      const pkVal = currentRow[pkIdx];
      primaryKeys.push({ column: pkCol, value: pkVal });
    }

    const pkSummary = primaryKeys.map((k) => `${k.column} = '${k.value}'`).join(" AND ");
    setRowToDelete({
      primaryKeys,
      summary: pkSummary,
      currentRow,
    });
  };

  const executeDeleteRow = async () => {
    if (!rowToDelete || !dataResult) return;
    const { primaryKeys, summary, currentRow } = rowToDelete;
    setRowToDelete(null);

    try {
      await dbService.deleteRow({
        database,
        table,
        primary_keys: primaryKeys,
      });

      const rowIndexInData = dataResult.rows.indexOf(currentRow);
      if (rowIndexInData !== -1) {
        const newRows = [...dataResult.rows];
        newRows.splice(rowIndexInData, 1);
        setDataResult((prev) =>
          prev
            ? {
                ...prev,
                rows: newRows,
                total_rows: Math.max(0, (prev.total_rows ?? newRows.length) - 1),
              }
            : prev,
        );
      }
      setSelectedRowIndex(null);
      setSaveStatus({
        success: true,
        message: `Fila eliminada exitosamente en MariaDB (${summary}).`,
      });
      setTimeout(() => setSaveStatus(null), 4000);
    } catch (err: unknown) {
      const errorMsg =
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Error al eliminar registro";
      setSaveStatus({
        success: false,
        message: `Error al eliminar: ${errorMsg}`,
      });
      setTimeout(() => setSaveStatus(null), 6000);
    }
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
            onClick={() => {
              setSelectedRowIndex(null);
              loadData(pageOffset, pageSize);
            }}
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
              onClick={() => {
                if (!hasPrimaryKey) {
                  alert(
                    "Esta tabla no tiene una clave primaria. La edición y eliminación de registros está deshabilitada para evitar modificaciones ambiguas.",
                  );
                  return;
                }
                setIsEditModalOpen(true);
              }}
              disabled={!hasPrimaryKey}
              title={
                hasPrimaryKey
                  ? "Abrir formulario para editar todos los campos de la fila seleccionada"
                  : "Deshabilitado: Esta tabla no tiene clave primaria."
              }
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-all active:scale-95 ${
                hasPrimaryKey
                  ? "bg-orange-600/20 hover:bg-orange-600/30 text-orange-300 border border-orange-500/40"
                  : "bg-neutral-800/40 text-neutral-500 border border-neutral-700/30 cursor-not-allowed opacity-50"
              }`}
            >
              <Edit3 className="w-3.5 h-3.5 text-orange-400" />
              <span>Editar Fila #{selectedRowIndex + 1}</span>
            </button>
          )}

          {/* Delete Row Button */}
          {selectedRowIndex !== null && displayRows[selectedRowIndex] && (
            <button
              onClick={handleDeleteRow}
              disabled={!hasPrimaryKey}
              title={
                hasPrimaryKey
                  ? "Eliminar registro seleccionado de la tabla (DELETE)"
                  : "Deshabilitado: Esta tabla no tiene clave primaria."
              }
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-all active:scale-95 ${
                hasPrimaryKey
                  ? "bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/40"
                  : "bg-neutral-800/40 text-neutral-500 border border-neutral-700/30 cursor-not-allowed opacity-50"
              }`}
            >
              <Trash2 className="w-3.5 h-3.5 text-red-400" />
              <span>Eliminar Fila</span>
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
              setPageOffset(0);
              setSelectedRowIndex(null);
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
              setSelectedRowIndex(null);
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
              setSelectedRowIndex(null);
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

      {/* No Primary Key Warning Banner */}
      {!hasPrimaryKey && !isLoading && dataResult && (
        <div className="px-4 py-2 bg-amber-950/40 border-b border-amber-800/60 text-amber-300 text-xs flex items-center space-x-2 shrink-0 animate-in fade-in duration-150">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            Esta tabla no tiene una clave primaria. La edición y eliminación de registros está deshabilitada para evitar modificaciones ambiguas.
          </span>
        </div>
      )}

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
          pkColumns={activePkColumns}
          columns={dataResult.columns}
          rowData={displayRows[selectedRowIndex]}
          rowIndex={selectedRowIndex}
          onSave={handleSaveRow}
        />
      )}

      <ConfirmModal
        isOpen={!!rowToDelete}
        title="Eliminar Registro (DELETE)"
        message={`¿Estás seguro de que deseas eliminar permanentemente este registro de la tabla '${table}'?`}
        details={rowToDelete ? `WHERE ${rowToDelete.summary}` : undefined}
        confirmText="Eliminar Registro"
        variant="danger"
        onConfirm={executeDeleteRow}
        onClose={() => setRowToDelete(null)}
      />
    </div>
  );
};
