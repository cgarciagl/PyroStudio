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
  Link as LinkIcon,
  Clock,
  Code2,
  BarChart3,
  Copy,
  FileCode2,
} from "lucide-react";
import type {
  ColumnMetadata,
  ExportProgressEvent,
  TableMetadata,
  ExportSummary,
  TableInspectorDetails,
} from "../types/database";
import { dbService } from "../services/tauriDb";
import { useUIStore } from "../stores/uiStore";
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

type InspectorSubTab =
  | "data"
  | "structure"
  | "indexes"
  | "foreign_keys"
  | "triggers"
  | "statistics"
  | "ddl";

export const TableViewer: React.FC<TableViewerProps> = ({
  database,
  table,
  onRefreshTable,
  onTableDeleted,
}) => {
  const { openSqlExportModal } = useUIStore();
  const [columns, setColumns] = useState<ColumnMetadata[]>([]);
  const [isLoadingCols, setIsLoadingCols] = useState(false);
  const [activeTab, setActiveTab] = useState<InspectorSubTab>("data");
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isAddColumnOpen, setIsAddColumnOpen] = useState(false);
  const [editingColumn, setEditingColumn] = useState<ColumnMetadata | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgressEvent | null>(null);
  const [exportSummary, setExportSummary] = useState<ExportSummary | null>(null);
  const [actionStatus, setActionStatus] = useState<{
    success?: boolean;
    message?: string;
  } | null>(null);

  // Extended inspector details for FK, Triggers, Statistics & DDL
  const [inspectorDetails, setInspectorDetails] = useState<TableInspectorDetails | null>(null);
  const [isLoadingInspector, setIsLoadingInspector] = useState(false);
  const [copiedDdl, setCopiedDdl] = useState(false);

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
    void subscribe().catch((error) => {
      console.error("No se pudo escuchar el progreso de exportación Excel:", error);
    });
    return () => {
      isDisposed = true;
      unlisten?.();
    };
  }, []);

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

  const fetchInspectorDetails = async () => {
    setIsLoadingInspector(true);
    try {
      const details = await dbService.getTableInspectorDetails(database, table.name);
      setInspectorDetails(details);
      if (details.structure && details.structure.length > 0) {
        setColumns(details.structure);
      }
    } catch (err) {
      console.error("Failed to load inspector details:", err);
    } finally {
      setIsLoadingInspector(false);
    }
  };

  useEffect(() => {
    fetchColumns();
    fetchInspectorDetails();
  }, [database, table.name]);

  const handleExport = async () => {
    setIsExporting(true);
    setExportProgress({ rows_written: 0, stage: "Preparando exportación" });
    setExportSummary(null);
    setActionStatus(null);
    try {
      const defaultName = `${table.name}.xlsx`;
      const chosenPath = await dbService.saveExcelDialog(defaultName);
      if (!chosenPath) {
        setExportProgress(null);
        setIsExporting(false);
        return;
      }
      const summary = await dbService.exportExcelFile({
        database,
        table: table.name,
        file_path: chosenPath,
      });
      setExportSummary(summary);
      setExportProgress(null);
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
      setExportProgress(null);
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

  const handleCopyDdl = () => {
    if (inspectorDetails?.ddl) {
      navigator.clipboard.writeText(inspectorDetails.ddl);
      setCopiedDdl(true);
      setTimeout(() => setCopiedDdl(false), 3000);
    }
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0d0f15] overflow-hidden">
      {/* Table Header Bar */}
      <div className="px-6 py-4 bg-[#11141c] border-b border-[#1d2230] flex flex-wrap items-center justify-between gap-4 select-none">
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
            onClick={() => openSqlExportModal({ database, table: table.name })}
            title="Exportar esta tabla a SQL (.sql Dump con DDL e INSERTs)"
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-rose-300 bg-rose-950/30 hover:bg-rose-900/40 border border-rose-800/40 rounded-md transition-colors"
          >
            <FileCode2 className="w-3.5 h-3.5 text-rose-400" />
            <span>Exportar SQL</span>
          </button>

          <button
            onClick={handleExport}
            disabled={isExporting}
            title="Exportar a Excel (.xlsx con formato profesional)"
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

      {/* Advanced Sub-Tabs Switcher: 7 Sub-tabs */}
      <div className="px-6 bg-[#0f1118] border-b border-[#1b202c] flex flex-wrap items-center justify-between text-xs font-medium select-none">
        <div className="flex items-center space-x-4 overflow-x-auto">
          <button
            onClick={() => setActiveTab("data")}
            className={`py-2.5 px-1 border-b-2 flex items-center space-x-2 transition-colors ${
              activeTab === "data"
                ? "border-orange-500 text-orange-400 font-semibold"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <TableIcon className="w-3.5 h-3.5" />
            <span>Vista de Datos</span>
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

          <button
            onClick={() => setActiveTab("foreign_keys")}
            className={`py-2.5 px-1 border-b-2 flex items-center space-x-2 transition-colors ${
              activeTab === "foreign_keys"
                ? "border-blue-500 text-blue-400 font-semibold"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <LinkIcon className="w-3.5 h-3.5" />
            <span>Llaves Foráneas ({inspectorDetails?.foreign_keys.length || 0})</span>
          </button>

          <button
            onClick={() => setActiveTab("triggers")}
            className={`py-2.5 px-1 border-b-2 flex items-center space-x-2 transition-colors ${
              activeTab === "triggers"
                ? "border-amber-500 text-amber-400 font-semibold"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Triggers ({inspectorDetails?.triggers.length || 0})</span>
          </button>

          <button
            onClick={() => setActiveTab("statistics")}
            className={`py-2.5 px-1 border-b-2 flex items-center space-x-2 transition-colors ${
              activeTab === "statistics"
                ? "border-emerald-500 text-emerald-400 font-semibold"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Estadísticas</span>
          </button>

          <button
            onClick={() => setActiveTab("ddl")}
            className={`py-2.5 px-1 border-b-2 flex items-center space-x-2 transition-colors ${
              activeTab === "ddl"
                ? "border-sky-500 text-sky-400 font-semibold"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>DDL (CREATE TABLE)</span>
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
              onClick={() => {
                fetchColumns();
                fetchInspectorDetails();
              }}
              title="Refrescar columnas y detalles"
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
        ) : activeTab === "foreign_keys" ? (
          /* Foreign Keys Tab */
          isLoadingInspector ? (
            <div className="flex items-center justify-center py-20 text-neutral-400">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500 mr-2" />
              <span>Cargando llaves foráneas...</span>
            </div>
          ) : !inspectorDetails?.foreign_keys || inspectorDetails.foreign_keys.length === 0 ? (
            <div className="p-8 text-center text-neutral-500 font-mono text-xs bg-[#11141c] border border-[#1f2535] rounded-lg">
              Esta tabla no tiene restricciones de llave foránea (Foreign Keys) configuradas.
            </div>
          ) : (
            <div className="bg-[#11141c] border border-[#1f2535] rounded-lg overflow-hidden shadow-xl">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#141822] text-neutral-400 font-semibold border-b border-[#212739] text-[11px] font-mono">
                    <th className="py-2.5 px-4">Nombre Restricción</th>
                    <th className="py-2.5 px-4">Columna Origen</th>
                    <th className="py-2.5 px-4">Tabla Referenciada</th>
                    <th className="py-2.5 px-4">Columna Referenciada</th>
                    <th className="py-2.5 px-4">ON UPDATE</th>
                    <th className="py-2.5 px-4">ON DELETE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1b202c]">
                  {inspectorDetails.foreign_keys.map((fk, idx) => (
                    <tr key={idx} className="hover:bg-[#151924] transition-colors font-mono">
                      <td className="py-2.5 px-4 font-semibold text-blue-300">{fk.name}</td>
                      <td className="py-2.5 px-4 text-white font-medium">{fk.column_name}</td>
                      <td className="py-2.5 px-4 text-orange-300">{fk.referenced_table}</td>
                      <td className="py-2.5 px-4 text-amber-300">{fk.referenced_column}</td>
                      <td className="py-2.5 px-4 text-neutral-400 text-[11px]">
                        <span className="px-1.5 py-0.5 rounded bg-[#171c28] border border-[#273046]">
                          {fk.update_rule}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-neutral-400 text-[11px]">
                        <span className="px-1.5 py-0.5 rounded bg-[#171c28] border border-[#273046]">
                          {fk.delete_rule}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : activeTab === "triggers" ? (
          /* Triggers Tab */
          isLoadingInspector ? (
            <div className="flex items-center justify-center py-20 text-neutral-400">
              <Loader2 className="w-6 h-6 animate-spin text-amber-500 mr-2" />
              <span>Cargando triggers...</span>
            </div>
          ) : !inspectorDetails?.triggers || inspectorDetails.triggers.length === 0 ? (
            <div className="p-8 text-center text-neutral-500 font-mono text-xs bg-[#11141c] border border-[#1f2535] rounded-lg">
              Esta tabla no tiene disparadores (Triggers) asociados.
            </div>
          ) : (
            <div className="space-y-4">
              {inspectorDetails.triggers.map((trg) => (
                <div
                  key={trg.name}
                  className="bg-[#11141c] border border-[#1f2535] rounded-lg p-4 space-y-3 shadow-md"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 font-mono">
                      <Zap className="w-4 h-4 text-amber-400" />
                      <span className="font-bold text-white text-sm">{trg.name}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                        {trg.timing} {trg.event}
                      </span>
                    </div>
                    {trg.created && (
                      <span className="text-neutral-500 text-[11px] font-mono">
                        Creado: {trg.created}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : activeTab === "statistics" ? (
          /* Statistics Tab */
          isLoadingInspector ? (
            <div className="flex items-center justify-center py-20 text-neutral-400">
              <Loader2 className="w-6 h-6 animate-spin text-emerald-500 mr-2" />
              <span>Cargando estadísticas del motor...</span>
            </div>
          ) : inspectorDetails?.statistics ? (
            <div className="space-y-6">
              {/* Stat Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-[#11141c] border border-[#1f2535] rounded-lg p-4">
                  <span className="text-[11px] text-neutral-400 font-mono">Filas Totales</span>
                  <div className="text-xl font-bold font-mono text-white mt-1">
                    {inspectorDetails.statistics.table_rows.toLocaleString()}
                  </div>
                  <span className="text-[10px] text-neutral-500">Estimación de almacenamiento</span>
                </div>
                <div className="bg-[#11141c] border border-[#1f2535] rounded-lg p-4">
                  <span className="text-[11px] text-neutral-400 font-mono">Tamaño de Datos</span>
                  <div className="text-xl font-bold font-mono text-emerald-400 mt-1">
                    {formatBytes(inspectorDetails.statistics.data_length)}
                  </div>
                  <span className="text-[10px] text-neutral-500">
                    Promedio: {inspectorDetails.statistics.avg_row_length} B / fila
                  </span>
                </div>
                <div className="bg-[#11141c] border border-[#1f2535] rounded-lg p-4">
                  <span className="text-[11px] text-neutral-400 font-mono">Tamaño de Índices</span>
                  <div className="text-xl font-bold font-mono text-purple-400 mt-1">
                    {formatBytes(inspectorDetails.statistics.index_length)}
                  </div>
                  <span className="text-[10px] text-neutral-500">Estructuras B-Tree / Claves</span>
                </div>
                <div className="bg-[#11141c] border border-[#1f2535] rounded-lg p-4">
                  <span className="text-[11px] text-neutral-400 font-mono">Espacio Libre (Fragmentación)</span>
                  <div className="text-xl font-bold font-mono text-amber-400 mt-1">
                    {formatBytes(inspectorDetails.statistics.data_free)}
                  </div>
                  <span className="text-[10px] text-neutral-500">
                    {inspectorDetails.statistics.data_free > 50 * 1024 * 1024
                      ? "Candidata a OPTIMIZE TABLE"
                      : "Nivel normal"}
                  </span>
                </div>
              </div>

              {/* Extended Details Table */}
              <div className="bg-[#11141c] border border-[#1f2535] rounded-lg p-5">
                <h4 className="font-semibold text-white text-sm mb-4">Detalles del Motor y Configuración</h4>
                <dl className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 font-mono text-xs">
                  <div className="flex justify-between py-1 border-b border-[#1b202c]">
                    <dt className="text-neutral-400">Motor de Almacenamiento:</dt>
                    <dd className="font-semibold text-orange-400">{inspectorDetails.statistics.engine}</dd>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#1b202c]">
                    <dt className="text-neutral-400">Formato de Fila (Row Format):</dt>
                    <dd className="text-neutral-200">{inspectorDetails.statistics.row_format || "Default"}</dd>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#1b202c]">
                    <dt className="text-neutral-400">Cotejamiento (Collation):</dt>
                    <dd className="text-neutral-200">{inspectorDetails.statistics.collation || "—"}</dd>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#1b202c]">
                    <dt className="text-neutral-400">Siguiente Auto-Increment:</dt>
                    <dd className="font-semibold text-amber-300">
                      {inspectorDetails.statistics.auto_increment?.toLocaleString() || "—"}
                    </dd>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#1b202c]">
                    <dt className="text-neutral-400">Fecha de Creación:</dt>
                    <dd className="text-neutral-300">{inspectorDetails.statistics.create_time || "—"}</dd>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#1b202c]">
                    <dt className="text-neutral-400">Última Actualización:</dt>
                    <dd className="text-neutral-300">{inspectorDetails.statistics.update_time || "—"}</dd>
                  </div>
                  {inspectorDetails.statistics.comment && (
                    <div className="col-span-full flex justify-between py-2 border-b border-[#1b202c]">
                      <dt className="text-neutral-400">Comentario de la Tabla:</dt>
                      <dd className="text-neutral-300">{inspectorDetails.statistics.comment}</dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-neutral-500 font-mono text-xs">
              No se pudieron obtener estadísticas de la tabla.
            </div>
          )
        ) : activeTab === "ddl" ? (
          /* DDL Tab */
          isLoadingInspector ? (
            <div className="flex items-center justify-center py-20 text-neutral-400">
              <Loader2 className="w-6 h-6 animate-spin text-sky-500 mr-2" />
              <span>Generando DDL (SHOW CREATE TABLE)...</span>
            </div>
          ) : inspectorDetails?.ddl ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-neutral-400 font-mono">
                  Definición SQL generada por MariaDB/MySQL:
                </span>
                <button
                  onClick={handleCopyDdl}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#171b26] hover:bg-[#22293b] text-sky-300 border border-sky-500/40 rounded text-xs font-semibold transition-colors"
                >
                  {copiedDdl ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-300">¡DDL Copiado!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copiar DDL</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="p-4 bg-[#0a0c10] border border-[#1b202e] rounded-lg text-emerald-300 font-mono text-xs overflow-x-auto whitespace-pre-wrap leading-relaxed shadow-inner">
                {inspectorDetails.ddl}
              </pre>
            </div>
          ) : (
            <div className="p-8 text-center text-neutral-500 font-mono text-xs">
              No se pudo obtener el DDL de la tabla.
            </div>
          )
        ) : activeTab === "structure" ? (
          /* Column Structure Tab */
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
          /* Data Grid View */
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
          fetchInspectorDetails();
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
            fetchInspectorDetails();
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
          fetchColumns();
          fetchInspectorDetails();
          if (onRefreshTable) onRefreshTable();
        }}
      />
    </div>
  );
};
