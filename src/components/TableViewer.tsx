import React, { useEffect, useState } from "react";
import {
  Key,
  Layers,
  FileSpreadsheet,
  Upload,
  Table as TableIcon,
  HardDrive,
  Hash,
  Loader2,
  Database,
  Plus,
  Edit3,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Zap,
} from "lucide-react";
import type { ColumnMetadata, TableMetadata, ExportSummary } from "../types/database";
import { dbService } from "../services/tauriDb";
import { DataGridCanvas } from "./DataGridCanvas";
import { ExcelImportModal } from "./ExcelImportModal";
import { AddColumnModal } from "./AddColumnModal";
import { EditColumnModal } from "./EditColumnModal";
import { IndexManagerTab } from "./IndexManagerTab";

interface TableViewerProps {
  database: string;
  table: TableMetadata;
  onRefreshTable?: () => void;
  onTableDeleted?: (dbName: string, tableName: string) => void;
}

export const TableViewer: React.FC<TableViewerProps> = ({
  database,
  table,
  onRefreshTable,
  onTableDeleted,
}) => {
  const [columns, setColumns] = useState<ColumnMetadata[]>([]);
  const [isLoadingCols, setIsLoadingCols] = useState(false);
  const [activeTab, setActiveTab] = useState<"structure" | "data" | "indexes">("data");
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isAddColumnOpen, setIsAddColumnOpen] = useState(false);
  const [editingColumn, setEditingColumn] = useState<ColumnMetadata | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportSummary, setExportSummary] = useState<ExportSummary | null>(null);
  const [actionStatus, setActionStatus] = useState<{
    success?: boolean;
    message?: string;
  } | null>(null);

  const fetchColumns = async () => {
    setIsLoadingCols(true);
    try {
      const cols = await dbService.getTableColumns(database, table.name);
      setColumns(cols);
    } catch (err) {
      console.error("Failed to load columns:", err);
    } finally {
      setIsLoadingCols(false);
    }
  };

  useEffect(() => {
    fetchColumns();
  }, [database, table.name]);

  const handleExport = async () => {
    setIsExporting(true);
    setExportSummary(null);
    setActionStatus(null);
    try {
      const defaultName = `${table.name}.xlsx`;
      const chosenPath = await dbService.saveExcelDialog(defaultName);
      if (!chosenPath) {
        setIsExporting(false);
        return;
      }
      const summary = await dbService.exportExcelFile({
        database,
        table: table.name,
        file_path: chosenPath,
      });
      setExportSummary(summary);
      setTimeout(() => setExportSummary(null), 8000);
    } catch (err: unknown) {
      console.error("Export error:", err);
      const msg =
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Error al exportar la tabla a Excel";
      setActionStatus({
        success: false,
        message: msg,
      });
      setTimeout(() => setActionStatus(null), 6000);
    } finally {
      setIsExporting(false);
    }
  };

  const handleDropTable = async () => {
    if (
      !window.confirm(
        `¿Estás seguro de que deseas eliminar permanentemente la tabla '${table.name}' de la base de datos '${database}'?\n\nEsta acción ejecutará DROP TABLE y no se puede deshacer.`,
      )
    ) {
      return;
    }

    try {
      await dbService.dropTable(database, table.name);
      if (onTableDeleted) {
        onTableDeleted(database, table.name);
      } else if (onRefreshTable) {
        onRefreshTable();
      }
    } catch (err: unknown) {
      const msg =
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Error al eliminar la tabla";
      setActionStatus({
        success: false,
        message: msg,
      });
      setTimeout(() => setActionStatus(null), 6000);
    }
  };

  const handleDeleteColumn = async (columnName: string) => {
    if (
      !window.confirm(
        `¿Estás seguro de eliminar la columna '${columnName}' de la tabla '${table.name}'? Esta acción no se puede deshacer.`,
      )
    ) {
      return;
    }

    try {
      const cleanDb = database.replace(/`/g, "``");
      const cleanTbl = table.name.replace(/`/g, "``");
      const cleanCol = columnName.replace(/`/g, "``");
      const sql = `ALTER TABLE \`${cleanDb}\`.\`${cleanTbl}\` DROP COLUMN \`${cleanCol}\`;`;

      await dbService.executeQuery(sql, database);
      setActionStatus({
        success: true,
        message: `Columna '${columnName}' eliminada exitosamente.`,
      });
      setTimeout(() => setActionStatus(null), 4000);
      fetchColumns();
      if (onRefreshTable) onRefreshTable();
    } catch (err: unknown) {
      const msg =
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Error al eliminar la columna";
      setActionStatus({
        success: false,
        message: msg,
      });
      setTimeout(() => setActionStatus(null), 6000);
    }
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0d0f15] overflow-hidden">
      {/* Table Header Bar */}
      <div className="px-6 py-4 bg-[#11141c] border-b border-[#1d2230] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-orange-600/15 border border-orange-500/25 flex items-center justify-center">
            <TableIcon className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs text-neutral-400 font-mono">
                {database}
              </span>
              <span className="text-neutral-600">/</span>
              <h1 className="text-base font-bold text-white font-mono tracking-tight">
                {table.name}
              </h1>
              <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded bg-[#1a202d] text-orange-400 border border-[#262e42]">
                {table.table_type}
              </span>
            </div>

            {/* Quick table metrics */}
            <div className="flex items-center space-x-4 mt-1 text-xs text-neutral-400 font-mono">
              {table.engine && (
                <span className="flex items-center space-x-1">
                  <Database className="w-3 h-3 text-neutral-500" />
                  <span>Motor: {table.engine}</span>
                </span>
              )}
              {table.rows_count !== null && table.rows_count !== undefined && (
                <span className="flex items-center space-x-1">
                  <Hash className="w-3 h-3 text-neutral-500" />
                  <span>{table.rows_count.toLocaleString()} filas aprox.</span>
                </span>
              )}
              {table.data_length && (
                <span className="flex items-center space-x-1">
                  <HardDrive className="w-3 h-3 text-neutral-500" />
                  <span>Tamaño: {formatBytes(table.data_length)}</span>
                </span>
              )}
              {table.collation && (
                <span className="hidden sm:inline text-neutral-500">
                  {table.collation}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action Toolbar */}
        <div className="flex items-center space-x-2">
          {exportSummary && (
            <div className="flex items-center space-x-1.5 px-3 py-1 bg-emerald-950/40 border border-emerald-800/60 rounded text-xs text-emerald-300 font-mono">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>
                Exportado: {exportSummary.total_rows.toLocaleString()} filas (
                {(exportSummary.file_size_bytes / 1024).toFixed(1)} KB)
              </span>
            </div>
          )}

          {actionStatus && (
            <div
              className={`flex items-center space-x-1.5 px-3 py-1 rounded text-xs font-mono border ${
                actionStatus.success
                  ? "bg-emerald-950/40 border-emerald-800/60 text-emerald-300"
                  : "bg-red-950/40 border-red-800/60 text-red-300"
              }`}
            >
              {actionStatus.success ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-red-400" />
              )}
              <span className="truncate max-w-xs">{actionStatus.message}</span>
            </div>
          )}

          <button
            onClick={handleExport}
            disabled={isExporting}
            title="Exportar a Excel (.xlsx con formato profesional: negrita, freeze panes y autofit)"
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-emerald-300 bg-emerald-950/30 hover:bg-emerald-900/40 border border-emerald-800/40 rounded-md transition-colors disabled:opacity-50"
          >
            {isExporting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
            ) : (
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
            )}
            <span>{isExporting ? "Exportando..." : "Exportar Excel"}</span>
          </button>

          <button
            onClick={() => setIsImportModalOpen(true)}
            title="Importar Excel con asistente paso a paso"
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-amber-300 bg-amber-950/30 hover:bg-amber-900/40 border border-amber-800/40 rounded-md transition-colors"
          >
            <Upload className="w-3.5 h-3.5 text-amber-400" />
            <span>Importar Excel</span>
          </button>

          <button
            onClick={handleDropTable}
            title="Eliminar tabla permanentemente (DROP TABLE)"
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-red-300 bg-red-950/30 hover:bg-red-900/40 border border-red-800/40 rounded-md transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5 text-red-400" />
            <span>Eliminar Tabla</span>
          </button>
        </div>
      </div>

      {/* Tabs Switcher: Estructura vs Vista de Datos vs Índices */}
      <div className="px-6 bg-[#0f1118] border-b border-[#1b202c] flex items-center justify-between text-xs font-medium">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => setActiveTab("data")}
            className={`py-2.5 px-1 border-b-2 flex items-center space-x-2 transition-colors ${
              activeTab === "data"
                ? "border-orange-500 text-orange-400 font-semibold"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <TableIcon className="w-3.5 h-3.5" />
            <span>Vista de Datos (Grid)</span>
          </button>
          <button
            onClick={() => setActiveTab("structure")}
            className={`py-2.5 px-1 border-b-2 flex items-center space-x-2 transition-colors ${
              activeTab === "structure"
                ? "border-orange-500 text-orange-400 font-semibold"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Columnas ({columns.length})</span>
          </button>
          <button
            onClick={() => setActiveTab("indexes")}
            className={`py-2.5 px-1 border-b-2 flex items-center space-x-2 transition-colors ${
              activeTab === "indexes"
                ? "border-purple-500 text-purple-400 font-semibold"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Índices</span>
          </button>
        </div>

        {activeTab === "structure" && (
          <div className="flex items-center space-x-2 py-1.5">
            <button
              onClick={() => setIsAddColumnOpen(true)}
              className="flex items-center space-x-1.5 px-3 py-1 bg-orange-600/20 hover:bg-orange-600/30 text-orange-300 border border-orange-500/40 rounded text-xs font-medium transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Añadir Columna</span>
            </button>

            <button
              onClick={fetchColumns}
              title="Refrescar columnas"
              className="p-1 rounded bg-[#161a24] hover:bg-[#202738] border border-[#242c3e] text-neutral-400 hover:text-white transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Main Content Pane */}
      <div className="flex-1 overflow-auto p-6">
        {activeTab === "indexes" ? (
          <IndexManagerTab database={database} table={table.name} columns={columns} />
        ) : activeTab === "structure" ? (
          isLoadingCols ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-2 text-neutral-400">
              <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
              <span className="text-xs">
                Inspeccionando metadatos de columnas en MariaDB...
              </span>
            </div>
          ) : (
            <div className="bg-[#11141c] border border-[#1f2535] rounded-lg overflow-hidden shadow-xl">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#141822] text-neutral-400 font-semibold border-b border-[#212739] select-none text-[11px] font-mono">
                    <th className="py-2.5 px-3 w-10 text-center">#</th>
                    <th className="py-2.5 px-4">Nombre de Columna</th>
                    <th className="py-2.5 px-4">Tipo de Dato</th>
                    <th className="py-2.5 px-3">Cotejamiento (Collation)</th>
                    <th className="py-2.5 px-4">Llave</th>
                    <th className="py-2.5 px-4">Permite Null</th>
                    <th className="py-2.5 px-4">Valor por Defecto</th>
                    <th className="py-2.5 px-4">Extra</th>
                    <th className="py-2.5 px-4">Comentario</th>
                    <th className="py-2.5 px-3 w-24 text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1b202c]">
                  {columns.map((col) => {
                    const isPK = col.column_key === "PRI";
                    const isUnique = col.column_key === "UNI";

                    return (
                      <tr
                        key={col.name}
                        className="hover:bg-[#151924] transition-colors"
                      >
                        <td className="py-2.5 px-3 text-center text-neutral-500 font-mono text-[11px]">
                          {col.ordinal_position}
                        </td>
                        <td className="py-2.5 px-4 font-mono font-medium text-white flex items-center space-x-2">
                          {isPK && (
                            <span title="Llave Primaria">
                              <Key className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            </span>
                          )}
                          <span>{col.name}</span>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-orange-300">
                          {col.column_type}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-xs text-neutral-300">
                          {col.collation ? (
                            <span className="text-orange-200/90 text-[11px] bg-[#1a1f2e] px-1.5 py-0.5 rounded border border-[#273048]">
                              {col.collation}
                            </span>
                          ) : col.character_set ? (
                            <span className="text-neutral-400 text-[11px]">
                              {col.character_set}
                            </span>
                          ) : (
                            <span className="text-neutral-600">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4">
                          {isPK && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                              PRIMARY
                            </span>
                          )}
                          {isUnique && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-sky-500/15 text-sky-400 border border-sky-500/30">
                              UNIQUE
                            </span>
                          )}
                          {col.column_key === "MUL" && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-500/15 text-purple-400 border border-purple-500/30">
                              INDEX
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-4">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                              col.is_nullable
                                ? "text-emerald-400 bg-emerald-950/20"
                                : "text-neutral-500 bg-neutral-900/40"
                            }`}
                          >
                            {col.is_nullable ? "YES" : "NO"}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-neutral-400">
                          {col.column_default !== null &&
                          col.column_default !== undefined ? (
                            <span className="text-neutral-300">
                              {col.column_default}
                            </span>
                          ) : (
                            <span className="text-neutral-600 italic">NULL</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-[11px] text-neutral-400">
                          {col.extra || "—"}
                        </td>
                        <td className="py-2.5 px-4 text-neutral-400 text-xs">
                          {col.comment || "—"}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <div className="flex items-center justify-center space-x-1.5">
                            <button
                              type="button"
                              onClick={() => setEditingColumn(col)}
                              title="Modificar estructura de columna (ALTER TABLE)"
                              className="p-1 rounded text-neutral-400 hover:text-orange-400 hover:bg-[#1f2638] transition-colors"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteColumn(col.name)}
                              title="Eliminar columna (DROP COLUMN)"
                              className="p-1 rounded text-neutral-400 hover:text-red-400 hover:bg-red-950/40 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <DataGridCanvas
            database={database}
            table={table.name}
            primaryKeyColumns={columns
              .filter((c) => c.column_key === "PRI")
              .map((c) => c.name)}
          />
        )}
      </div>

      {/* Add Column Modal */}
      <AddColumnModal
        isOpen={isAddColumnOpen}
        onClose={() => setIsAddColumnOpen(false)}
        database={database}
        table={table.name}
        existingColumns={columns}
        onColumnAdded={() => {
          fetchColumns();
          if (onRefreshTable) onRefreshTable();
        }}
      />

      {/* Edit Column Modal */}
      {editingColumn && (
        <EditColumnModal
          isOpen={!!editingColumn}
          onClose={() => setEditingColumn(null)}
          database={database}
          table={table.name}
          column={editingColumn}
          onColumnUpdated={() => {
            fetchColumns();
            if (onRefreshTable) onRefreshTable();
          }}
        />
      )}

      {/* Excel Import Stepper Wizard */}
      <ExcelImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        database={database}
        table={table.name}
        dbColumns={columns}
        onImportComplete={() => {
          if (onRefreshTable) onRefreshTable();
        }}
      />
    </div>
  );
};
