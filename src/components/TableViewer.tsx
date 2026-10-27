import React, { useEffect, useMemo, useState } from "react";
import {
  Key,
  FileSpreadsheet,
  Upload,
  Loader2,
  Plus,
  Edit3,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Zap,
  Link as LinkIcon,
  Copy,
  Check,
  Play,
  FileCode2,
  ChevronDown,
} from "lucide-react";
import { ghostBtn, menuItem, menuPanel, menuSeparator, tabClass } from "./ui/styles";
import type {
  ColumnMetadata,
  ExportProgressEvent,
  TableMetadata,
  ExportSummary,
  TableInspectorDetails,
  IndexAdvisorReport,
} from "../types/database";
import { dbService } from "../services/tauriDb";
import { useUIStore } from "../stores/uiStore";
import { useIsLightTheme } from "../stores/preferenceStore";
import { DataGridCanvas } from "./DataGridCanvas";
import { ExcelImportModal } from "./ExcelImportModal";
import { AddColumnModal } from "./AddColumnModal";
import { EditColumnModal } from "./EditColumnModal";
import { IndexManagerTab } from "./IndexManagerTab";
import { ConfirmModal } from "./ConfirmModal";

interface TableViewerProps {
  database: string;
  table: TableMetadata;
  onRefreshTable?: () => void;
  onTableDeleted?: (dbName: string, tableName: string) => void;
  onOpenCreateTrigger?: (dbName: string, tableName?: string) => void;
}

type InspectorSubTab =
  | "data"
  | "structure"
  | "indexes"
  | "advisor"
  | "foreign_keys"
  | "triggers"
  | "statistics"
  | "ddl";

export const TableViewer: React.FC<TableViewerProps> = ({
  database,
  table,
  onRefreshTable,
  onTableDeleted: _onTableDeleted,
  onOpenCreateTrigger,
}) => {
  const { openSqlExportModal, openTab } = useUIStore();
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

  const [inspectorDetails, setInspectorDetails] = useState<TableInspectorDetails | null>(null);
  const [isLoadingInspector, setIsLoadingInspector] = useState(false);
  const [copiedDdl, setCopiedDdl] = useState(false);

  // Table-specific Index Advisor state
  const [tableAdvisorReport, setTableAdvisorReport] = useState<IndexAdvisorReport | null>(null);
  const [isLoadingTableAdvisor, setIsLoadingTableAdvisor] = useState(false);
  const [copiedAdvisorSql, setCopiedAdvisorSql] = useState<string | null>(null);

  const primaryKeyColumns = useMemo(
    () => columns.filter((c) => c.column_key === "PRI").map((c) => c.name),
    [columns],
  );

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

  const fetchAdvisorReport = async () => {
    setIsLoadingTableAdvisor(true);
    try {
      const rep = await dbService.analyzeTableIndexes(database, table.name);
      setTableAdvisorReport(rep);
    } catch (err) {
      console.error("Failed to analyze table indexes:", err);
    } finally {
      setIsLoadingTableAdvisor(false);
    }
  };

  useEffect(() => {
    setInspectorDetails(null);
    setTableAdvisorReport(null);
    fetchColumns();
  }, [database, table.name]);

  useEffect(() => {
    if (
      activeTab === "foreign_keys" ||
      activeTab === "triggers" ||
      activeTab === "statistics" ||
      activeTab === "ddl"
    ) {
      if (!inspectorDetails && !isLoadingInspector) {
        fetchInspectorDetails();
      }
    } else if (activeTab === "advisor") {
      if (!tableAdvisorReport && !isLoadingTableAdvisor) {
        fetchAdvisorReport();
      }
    }
  }, [activeTab, database, table.name]);

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

  const [columnToDelete, setColumnToDelete] = useState<string | null>(null);

  const handleDeleteColumn = (columnName: string) => {
    setColumnToDelete(columnName);
  };

  const executeDeleteColumn = async () => {
    if (!columnToDelete) return;
    const colName = columnToDelete;
    setColumnToDelete(null);

    try {
      const cleanDb = database.replace(/`/g, "``");
      const cleanTbl = table.name.replace(/`/g, "``");
      const cleanCol = colName.replace(/`/g, "``");
      const sql = `ALTER TABLE \`${cleanDb}\`.\`${cleanTbl}\` DROP COLUMN \`${cleanCol}\`;`;

      await dbService.executeConfirmedQuery(sql, database);
      setActionStatus({
        success: true,
        message: `Columna '${colName}' eliminada exitosamente.`,
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

  const isLight = useIsLightTheme();

  const [openMenu, setOpenMenu] = useState<"transfer" | "more" | null>(null);

  const primaryTabs: { id: InspectorSubTab; label: string }[] = [
    { id: "data", label: "Datos" },
    { id: "structure", label: `Estructura (${columns.length})` },
    { id: "indexes", label: "Índices" },
    {
      id: "foreign_keys",
      label: `Relaciones${inspectorDetails ? ` (${inspectorDetails.foreign_keys.length})` : ""}`,
    },
    { id: "ddl", label: "DDL" },
  ];
  const advisorCount = tableAdvisorReport?.recommendations?.length ?? 0;
  const secondaryTabs: { id: InspectorSubTab; label: string }[] = [
    { id: "triggers", label: `Triggers${inspectorDetails ? ` (${inspectorDetails.triggers.length})` : ""}` },
    { id: "statistics", label: "Estadísticas" },
    { id: "advisor", label: `Asesor de índices${advisorCount ? ` (${advisorCount})` : ""}` },
  ];
  const activeSecondary = secondaryTabs.find((t) => t.id === activeTab);

  return (
    <div
      className={`flex-1 flex flex-col h-full overflow-hidden transition-colors ${
        isLight ? "bg-slate-50 text-slate-800" : "bg-surface text-neutral-200"
      }`}
    >
      {/* Table Header: one compact row — identity on the left, a single neutral menu on the right */}
      <div
        className={`relative z-40 px-4 py-2 border-b flex items-center justify-between gap-3 select-none ${
          isLight ? "bg-white border-slate-200" : "bg-surface border-line"
        }`}
      >
        <div className="min-w-0 flex items-baseline gap-2">
          <span className={`text-xs font-mono shrink-0 ${isLight ? "text-slate-400" : "text-neutral-500"}`}>
            {database} /
          </span>
          <h1
            className={`text-sm font-semibold font-mono truncate ${isLight ? "text-slate-900" : "text-white"}`}
            title={[table.table_type, table.engine, table.collation].filter(Boolean).join(" · ")}
          >
            {table.name}
          </h1>
          <span className={`hidden md:inline text-[11px] font-mono truncate ${isLight ? "text-slate-400" : "text-neutral-500"}`}>
            {[
              table.rows_count !== null && table.rows_count !== undefined
                ? `~${table.rows_count.toLocaleString()} filas`
                : null,
              table.data_length ? formatBytes(table.data_length) : null,
              table.table_type && table.table_type !== "BASE TABLE" ? table.table_type : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Transient status: one neutral line, color only on the icon */}
          {isExporting && exportProgress ? (
            <span role="status" aria-live="polite" className="flex items-center gap-1.5 text-[11px] text-neutral-400 font-mono">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-400" />
              {exportProgress.rows_written.toLocaleString()} filas · {exportProgress.stage}
            </span>
          ) : exportSummary ? (
            <span className="flex items-center gap-1.5 text-[11px] text-neutral-400 font-mono">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              Exportado: {exportSummary.total_rows.toLocaleString()} filas ({(exportSummary.file_size_bytes / 1024).toFixed(1)} KB)
            </span>
          ) : actionStatus ? (
            <span className="flex items-center gap-1.5 text-[11px] text-neutral-400 font-mono max-w-xs truncate" title={actionStatus.message}>
              {actionStatus.success ? (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-red-400" />
              )}
              <span className="truncate">{actionStatus.message}</span>
            </span>
          ) : null}

          <div className="relative">
            <button
              onClick={() => setOpenMenu(openMenu === "transfer" ? null : "transfer")}
              disabled={isExporting}
              className={ghostBtn}
            >
              <span>Importar / Exportar</span>
              <ChevronDown className="w-3.5 h-3.5 opacity-60" />
            </button>
            {openMenu === "transfer" && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOpenMenu(null)} />
                <div className={menuPanel}>
                  <button className={menuItem} onClick={() => { setOpenMenu(null); handleExport(); }}>
                    <FileSpreadsheet className="w-3.5 h-3.5 opacity-70" /> Exportar a Excel
                  </button>
                  <button className={menuItem} onClick={() => { setOpenMenu(null); openSqlExportModal({ database, table: table.name }); }}>
                    <FileCode2 className="w-3.5 h-3.5 opacity-70" /> Exportar a SQL
                  </button>
                  <div className={menuSeparator} />
                  <button className={menuItem} onClick={() => { setOpenMenu(null); setIsImportModalOpen(true); }}>
                    <Upload className="w-3.5 h-3.5 opacity-70" /> Importar desde Excel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Sub-tabs: one accent color; secondary views live under "Más" */}
      <div
        className={`relative z-30 px-4 border-b flex items-center justify-between text-xs select-none ${
          isLight ? "bg-white border-slate-200" : "bg-surface border-line"
        }`}
      >
        <div className="flex items-center gap-1 min-w-0">
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-none min-w-0">
          {primaryTabs.map((t) => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} className={tabClass(activeTab === t.id)}>
              {t.label}
            </button>
          ))}
          {activeSecondary && (
            <button className={tabClass(true)}>{activeSecondary.label}</button>
          )}
          </div>
          {/* Outside the scroll container so the dropdown is not clipped */}
          <div className="relative shrink-0">
            <button
              onClick={() => setOpenMenu(openMenu === "more" ? null : "more")}
              className={`${tabClass(false)} flex items-center gap-1`}
            >
              Más <ChevronDown className="w-3 h-3 opacity-60" />
            </button>
            {openMenu === "more" && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOpenMenu(null)} />
                <div className={`${menuPanel} left-0 right-auto`}>
                  {secondaryTabs.map((t) => (
                    <button
                      key={t.id}
                      className={menuItem}
                      onClick={() => {
                        setOpenMenu(null);
                        setActiveTab(t.id);
                        if (t.id === "advisor") fetchAdvisorReport();
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {activeTab === "structure" && (
          <div className="flex items-center gap-1 py-1">
            <button onClick={() => setIsAddColumnOpen(true)} className={ghostBtn}>
              <Plus className="w-3.5 h-3.5" /> Columna
            </button>
            <button
              onClick={() => {
                fetchColumns();
                fetchInspectorDetails();
              }}
              title="Refrescar columnas y detalles"
              className={ghostBtn}
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {activeTab === "advisor" && (
          <div className="flex items-center py-1">
            <button onClick={fetchAdvisorReport} disabled={isLoadingTableAdvisor} className={ghostBtn}>
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingTableAdvisor ? "animate-spin" : ""}`} /> Re-analizar
            </button>
          </div>
        )}
      </div>

      {/* Main Content Pane */}
      {activeTab === "data" ? (
        <div className="flex-1 min-h-0 relative overflow-hidden">
          <DataGridCanvas
            database={database}
            table={table.name}
            primaryKeyColumns={primaryKeyColumns}
          />
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-6">
          {activeTab === "advisor" ? (
            /* Table Index Advisor Tab */
            isLoadingTableAdvisor ? (
              <div className="flex flex-col items-center justify-center py-20 text-neutral-400 space-y-3">
                <Loader2 className="w-7 h-7 animate-spin text-amber-500" />
                <span className="text-xs font-mono">Analizando índices y restricciones de '{table.name}'...</span>
              </div>
            ) : tableAdvisorReport ? (
              <div className="space-y-6">
                {/* Header summary cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl bg-surface border border-line flex items-center justify-between">
                    <div>
                      <span className="text-xs text-neutral-400 font-medium">Índices Analizados</span>
                      <h3 className="text-xl font-bold text-white font-mono mt-1">
                        {inspectorDetails?.indexes?.length || 1}
                      </h3>
                    </div>
                    <div className="w-9 h-9 rounded-lg bg-raised border border-line flex items-center justify-center text-fg-muted">
                      <Zap className="w-4 h-4" />
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-surface border border-line flex items-center justify-between">
                    <div>
                      <span className="text-xs text-neutral-400 font-medium">Índices Redundantes</span>
                      <h3 className={`text-xl font-bold font-mono mt-1 ${
                        (tableAdvisorReport.redundant_indexes_count ?? 0) > 0 ? "text-amber-400" : "text-emerald-400"
                      }`}>
                        {tableAdvisorReport.redundant_indexes_count ?? 0}
                      </h3>
                    </div>
                    <div className="w-9 h-9 rounded-lg bg-amber-950/40 border border-amber-500/30 flex items-center justify-center text-amber-400">
                      <AlertCircle className="w-4 h-4" />
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-surface border border-line flex items-center justify-between">
                    <div>
                      <span className="text-xs text-neutral-400 font-medium">FKs sin Indexar</span>
                      <h3 className={`text-xl font-bold font-mono mt-1 ${
                        (tableAdvisorReport.missing_indexes_count ?? 0) > 0 ? "text-orange-400" : "text-emerald-400"
                      }`}>
                        {tableAdvisorReport.missing_indexes_count ?? 0}
                      </h3>
                    </div>
                    <div className="w-9 h-9 rounded-lg bg-orange-950/40 border border-orange-500/30 flex items-center justify-center text-orange-400">
                      <LinkIcon className="w-4 h-4" />
                    </div>
                  </div>
                </div>

                {/* Recommendations List */}
                {(!tableAdvisorReport.recommendations || tableAdvisorReport.recommendations.length === 0) ? (
                  <div className="p-8 text-center bg-surface border border-emerald-900/30 rounded-xl space-y-2">
                    <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
                    <h4 className="text-sm font-semibold text-emerald-300">
                      ¡Esquema de Índices Optimizado!
                    </h4>
                    <p className="text-xs text-neutral-400 max-w-md mx-auto">
                      No se detectaron índices redundantes ni claves foráneas sin indexar en la tabla <code className="text-orange-300 font-mono">{table.name}</code>.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-neutral-300 uppercase tracking-wider font-mono">
                        Recomendaciones ({tableAdvisorReport.recommendations.length})
                      </h4>
                    </div>

                  {tableAdvisorReport.recommendations.map((rec, idx) => (
                    <div
                      key={idx}
                      className="p-4 rounded-xl bg-surface border border-line space-y-3 shadow-md"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center space-x-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider font-mono ${
                              rec.is_redundant
                                ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                                : "bg-raised text-fg border border-line"
                            }`}
                          >
                            {rec.is_redundant ? "Índice Redundante" : "Falta Índice en FK"}
                          </span>
                          <span className="text-sm font-bold text-white font-mono">
                            {rec.recommendation}
                          </span>
                        </div>
                      </div>

                      <p className="text-xs text-neutral-300 leading-relaxed">
                        {rec.reason}
                      </p>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-neutral-400 font-mono">
                        <div className="p-2 rounded bg-surface border border-line">
                          <strong className="text-emerald-400">Beneficio estimado:</strong> {rec.estimated_benefit}
                        </div>
                        <div className="p-2 rounded bg-surface border border-line">
                          <strong className="text-neutral-300">Costo potencial:</strong> {rec.potential_cost}
                        </div>
                      </div>

                      {/* Proposed SQL */}
                      <div className="space-y-1.5">
                        <span className="text-[10px] uppercase font-bold text-neutral-500 font-mono">
                          Propuesta SQL:
                        </span>
                        <div className="p-3 bg-canvas border border-line rounded-lg flex items-center justify-between gap-3 font-mono text-xs text-orange-300">
                          <span className="truncate">{rec.sql_proposal}</span>
                          <div className="flex items-center space-x-2 shrink-0">
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(rec.sql_proposal);
                                setCopiedAdvisorSql(rec.sql_proposal);
                                setTimeout(() => setCopiedAdvisorSql(null), 2000);
                              }}
                              className="flex items-center space-x-1 px-2.5 py-1 bg-raised hover:bg-hover border border-line rounded text-neutral-300 hover:text-white transition-colors text-[11px]"
                            >
                              {copiedAdvisorSql === rec.sql_proposal ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-400" />
                                  <span className="text-emerald-400">¡Copiado!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  <span>Copiar</span>
                                </>
                              )}
                            </button>

                            <button
                              onClick={() => {
                                openTab({
                                  id: `query-${Date.now()}`,
                                  title: `Optimizar ${table.name}`,
                                  type: "query",
                                  database,
                                  queryContent: `-- Propuesta generada por Asesor de Índices para tabla '${table.name}'\n${rec.sql_proposal}\n`,
                                });
                              }}
                              className="flex items-center space-x-1 px-2.5 py-1 bg-orange-600/20 hover:bg-orange-600/30 border border-orange-500/40 rounded text-orange-300 font-semibold transition-colors text-[11px]"
                            >
                              <Play className="w-3 h-3" />
                              <span>Abrir en Consulta</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="p-8 text-center text-neutral-500 font-mono text-xs bg-surface border border-line rounded-lg">
              No se pudo obtener el informe de índices.
            </div>
          )
        ) : activeTab === "indexes" ? (
          <IndexManagerTab database={database} table={table.name} columns={columns} />
        ) : activeTab === "foreign_keys" ? (
          /* Foreign Keys Tab */
          isLoadingInspector ? (
            <div className="flex items-center justify-center py-20 text-neutral-400">
              <Loader2 className="w-6 h-6 animate-spin text-fg-muted mr-2" />
              <span>Cargando llaves foráneas...</span>
            </div>
          ) : !inspectorDetails?.foreign_keys || inspectorDetails.foreign_keys.length === 0 ? (
            <div className="p-8 text-center text-neutral-500 font-mono text-xs bg-surface border border-line rounded-lg">
              Esta tabla no tiene restricciones de llave foránea (Foreign Keys) configuradas.
            </div>
          ) : (
            <div className="bg-surface border border-line rounded-lg overflow-hidden shadow-xl">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-raised text-neutral-400 font-semibold border-b border-line text-[11px] font-mono">
                    <th className="py-2.5 px-4">Nombre Restricción</th>
                    <th className="py-2.5 px-4">Columna Origen</th>
                    <th className="py-2.5 px-4">Tabla Referenciada</th>
                    <th className="py-2.5 px-4">Columna Referenciada</th>
                    <th className="py-2.5 px-4">ON UPDATE</th>
                    <th className="py-2.5 px-4">ON DELETE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {inspectorDetails.foreign_keys.map((fk, idx) => (
                    <tr key={idx} className="hover:bg-hover transition-colors font-mono">
                      <td className="py-2.5 px-4 font-semibold text-fg">{fk.name}</td>
                      <td className="py-2.5 px-4 text-white font-medium">{fk.column_name}</td>
                      <td className="py-2.5 px-4 text-orange-300">{fk.referenced_table}</td>
                      <td className="py-2.5 px-4 text-amber-300">{fk.referenced_column}</td>
                      <td className="py-2.5 px-4 text-neutral-400 text-[11px]">
                        <span className="px-1.5 py-0.5 rounded bg-raised border border-line-strong">
                          {fk.update_rule}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-neutral-400 text-[11px]">
                        <span className="px-1.5 py-0.5 rounded bg-raised border border-line-strong">
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
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-neutral-400 font-mono">
                  Disparadores asociados a <strong className="text-white">{table.name}</strong>
                </span>
                {onOpenCreateTrigger && (
                  <button
                    onClick={() => onOpenCreateTrigger(database, table.name)}
                    className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded text-xs font-semibold flex items-center space-x-1.5 transition-colors"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>Nuevo Trigger</span>
                  </button>
                )}
              </div>

              {!inspectorDetails?.triggers || inspectorDetails.triggers.length === 0 ? (
                <div className="p-8 text-center text-neutral-500 font-mono text-xs bg-surface border border-line rounded-lg space-y-3">
                  <p>Esta tabla no tiene disparadores (Triggers) asociados.</p>
                  {onOpenCreateTrigger && (
                    <button
                      onClick={() => onOpenCreateTrigger(database, table.name)}
                      className="px-3 py-1.5 bg-amber-600/30 hover:bg-amber-600/40 text-amber-200 border border-amber-500/40 rounded text-xs font-semibold inline-flex items-center space-x-1.5 transition-colors"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>Crear Primer Trigger para {table.name}</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {inspectorDetails.triggers.map((trg) => (
                    <div
                      key={trg.name}
                      className="bg-surface border border-line rounded-lg p-4 space-y-3 shadow-md"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2 font-mono">
                          <Zap className="w-4 h-4 text-fg-muted" />
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
              )}
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
                <div className="bg-surface border border-line rounded-lg p-4">
                  <span className="text-[11px] text-neutral-400 font-mono">Filas Totales</span>
                  <div className="text-xl font-bold font-mono text-white mt-1">
                    {inspectorDetails.statistics.table_rows.toLocaleString()}
                  </div>
                  <span className="text-[10px] text-neutral-500">Estimación de almacenamiento</span>
                </div>
                <div className="bg-surface border border-line rounded-lg p-4">
                  <span className="text-[11px] text-neutral-400 font-mono">Tamaño de Datos</span>
                  <div className="text-xl font-bold font-mono text-emerald-400 mt-1">
                    {formatBytes(inspectorDetails.statistics.data_length)}
                  </div>
                  <span className="text-[10px] text-neutral-500">
                    Promedio: {inspectorDetails.statistics.avg_row_length} B / fila
                  </span>
                </div>
                <div className="bg-surface border border-line rounded-lg p-4">
                  <span className="text-[11px] text-neutral-400 font-mono">Tamaño de Índices</span>
                  <div className="text-xl font-bold font-mono text-fg-muted mt-1">
                    {formatBytes(inspectorDetails.statistics.index_length)}
                  </div>
                  <span className="text-[10px] text-neutral-500">Estructuras B-Tree / Claves</span>
                </div>
                <div className="bg-surface border border-line rounded-lg p-4">
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
              <div className="bg-surface border border-line rounded-lg p-5">
                <h4 className="font-semibold text-white text-sm mb-4">Detalles del Motor y Configuración</h4>
                <dl className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 font-mono text-xs">
                  <div className="flex justify-between py-1 border-b border-line">
                    <dt className="text-neutral-400">Motor de Almacenamiento:</dt>
                    <dd className="font-semibold text-orange-400">{inspectorDetails.statistics.engine}</dd>
                  </div>
                  <div className="flex justify-between py-1 border-b border-line">
                    <dt className="text-neutral-400">Formato de Fila (Row Format):</dt>
                    <dd className="text-neutral-200">{inspectorDetails.statistics.row_format || "Default"}</dd>
                  </div>
                  <div className="flex justify-between py-1 border-b border-line">
                    <dt className="text-neutral-400">Cotejamiento (Collation):</dt>
                    <dd className="text-neutral-200">{inspectorDetails.statistics.collation || "—"}</dd>
                  </div>
                  <div className="flex justify-between py-1 border-b border-line">
                    <dt className="text-neutral-400">Siguiente Auto-Increment:</dt>
                    <dd className="font-semibold text-amber-300">
                      {inspectorDetails.statistics.auto_increment?.toLocaleString() || "—"}
                    </dd>
                  </div>
                  <div className="flex justify-between py-1 border-b border-line">
                    <dt className="text-neutral-400">Fecha de Creación:</dt>
                    <dd className="text-neutral-300">{inspectorDetails.statistics.create_time || "—"}</dd>
                  </div>
                  <div className="flex justify-between py-1 border-b border-line">
                    <dt className="text-neutral-400">Última Actualización:</dt>
                    <dd className="text-neutral-300">{inspectorDetails.statistics.update_time || "—"}</dd>
                  </div>
                  {inspectorDetails.statistics.comment && (
                    <div className="col-span-full flex justify-between py-2 border-b border-line">
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
              <Loader2 className="w-6 h-6 animate-spin text-fg-muted mr-2" />
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
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-raised hover:bg-hover text-fg border border-line rounded text-xs font-semibold transition-colors"
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
              <pre className="p-4 bg-canvas border border-line rounded-lg text-emerald-300 font-mono text-xs overflow-x-auto whitespace-pre-wrap leading-relaxed shadow-inner">
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
            <div
              className={`rounded-lg overflow-hidden shadow-xl border ${
                isLight
                  ? "bg-white border-slate-200 shadow-slate-200/50"
                  : "bg-surface border-line"
              }`}
            >
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr
                    className={`font-semibold border-b select-none text-[11px] font-mono ${
                      isLight
                        ? "bg-slate-100/90 text-slate-700 border-slate-200"
                        : "bg-raised text-neutral-400 border-line"
                    }`}
                  >
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
                <tbody
                  className={`divide-y ${
                    isLight ? "divide-slate-200" : "divide-line"
                  }`}
                >
                  {columns.map((col) => {
                    const isPK = col.column_key === "PRI";
                    const isUnique = col.column_key === "UNI";

                    return (
                      <tr
                        key={col.name}
                        className={`transition-colors ${
                          isLight
                            ? "hover:bg-slate-50/80"
                            : "hover:bg-hover"
                        }`}
                      >
                        <td
                          className={`py-2.5 px-3 text-center font-mono text-[11px] ${
                            isLight ? "text-slate-500" : "text-neutral-500"
                          }`}
                        >
                          {col.ordinal_position}
                        </td>
                        <td
                          className={`py-2.5 px-4 font-mono font-medium flex items-center space-x-2 ${
                            isLight ? "text-slate-900" : "text-white"
                          }`}
                        >
                          {isPK && (
                            <span title="Llave Primaria">
                              <Key className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                            </span>
                          )}
                          <span>{col.name}</span>
                        </td>
                        <td
                          className={`py-2.5 px-4 font-mono ${
                            isLight
                              ? "text-orange-700 font-medium"
                              : "text-orange-300"
                          }`}
                        >
                          {col.column_type}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-xs">
                          {col.collation ? (
                            <span
                              className={`text-[11px] px-2 py-0.5 rounded border font-mono ${
                                isLight
                                  ? "bg-amber-50 text-amber-950 border-amber-300 font-semibold shadow-2xs"
                                  : "bg-elevated text-orange-200/90 border-line-strong"
                              }`}
                            >
                              {col.collation}
                            </span>
                          ) : col.character_set ? (
                            <span
                              className={`text-[11px] font-mono ${
                                isLight ? "text-slate-600" : "text-neutral-400"
                              }`}
                            >
                              {col.character_set}
                            </span>
                          ) : (
                            <span
                              className={`font-mono ${
                                isLight ? "text-slate-400" : "text-neutral-600"
                              }`}
                            >
                              —
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-4">
                          {isPK && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                              PRIMARY
                            </span>
                          )}
                          {isUnique && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-raised text-fg-muted border border-line">
                              UNIQUE
                            </span>
                          )}
                          {col.column_key === "MUL" && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-raised text-fg-muted border border-line">
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
                              className="p-1 rounded text-neutral-400 hover:text-orange-400 hover:bg-hover transition-colors"
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
          )) : null}
        </div>
      )}

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

      <ConfirmModal
        isOpen={!!columnToDelete}
        title="Eliminar Columna"
        message={`¿Estás seguro de eliminar la columna '${columnToDelete}' de la tabla '${table.name}'?`}
        details="Esta acción ejecutará ALTER TABLE DROP COLUMN y borrará todos los datos almacenados en dicha columna."
        confirmText="Eliminar Columna"
        variant="danger"
        onConfirm={executeDeleteColumn}
        onClose={() => setColumnToDelete(null)}
      />
    </div>
  );
};
