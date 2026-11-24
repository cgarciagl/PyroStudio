import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const TableSizeTreemap = React.lazy(() =>
  import("./charts/StorageCharts").then((m) => ({ default: m.TableSizeTreemap })),
);
import {
  ArrowUpDown,
  Download,
  Eye,
  FileSpreadsheet,
  HardDrive,
  Plus,
  RefreshCw,
  Search,
  Table as TableIcon,
  Wrench,
  FileCode2,
} from "lucide-react";
import { dbService } from "../services/tauriDb";
import { downloadFile } from "../services/diagnosticExport";
import type { DatabaseTablesOverview } from "../types/database";
import { useUIStore } from "../stores/uiStore";
import { primaryBtn } from "./ui/styles";
import { EmptyState, Spinner } from "./ui/Modal";
import { errorText } from "../utils/errors";

interface DatabaseTablesOverviewTabProps {
  database: string;
  onOpenTableData?: (tableName: string) => void;
  onOpenCreateTable?: (dbName: string) => void;
  onOpenImportExcel?: (dbName: string, tableName?: string) => void;
  onOpenSqlExport?: (dbName: string, tableName?: string) => void;
  onOpenOperations?: (dbName: string) => void;
}

type SortField = "name" | "rows_count" | "total_bytes" | "data_bytes" | "index_bytes" | "data_free_bytes";
type SortOrder = "asc" | "desc";

export const DatabaseTablesOverviewTab: React.FC<DatabaseTablesOverviewTabProps> = ({
  database,
  onOpenTableData,
  onOpenCreateTable,
  onOpenImportExcel,
  onOpenSqlExport,
  onOpenOperations,
}) => {
  const { t } = useTranslation("objects");
  const [data, setData] = useState<DatabaseTablesOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [engineFilter, setEngineFilter] = useState<string>("ALL");
  const [sortField, setSortField] = useState<SortField>("total_bytes");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const { openTab } = useUIStore();

  const loadTablesOverview = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await dbService.getDatabaseTablesOverview(database);
      setData(res);
    } catch (err: unknown) {
      console.error("Failed to load tables overview:", err);
      setError(
        errorText(err, t("tablesOverview.loadError")),
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTablesOverview();
  }, [database]);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  const handleOpenTable = (tableName: string) => {
    if (onOpenTableData) {
      onOpenTableData(tableName);
    } else {
      openTab({
        id: `table-${database}-${tableName}`,
        title: tableName,
        type: "table",
        database,
        tableName,
      });
    }
  };

  const handleExportCsv = () => {
    if (!data) return;
    const headers = [
      t("tablesOverview.csvHeaders.table"),
      t("tablesOverview.csvHeaders.type"),
      t("tablesOverview.csvHeaders.engine"),
      t("tablesOverview.csvHeaders.rows"),
      t("tablesOverview.csvHeaders.dataBytes"),
      t("tablesOverview.csvHeaders.indexBytes"),
      t("tablesOverview.csvHeaders.totalBytes"),
      t("tablesOverview.csvHeaders.freeBytes"),
      t("tablesOverview.csvHeaders.collation"),
      t("tablesOverview.csvHeaders.comment"),
    ];

    const rows = data.tables.map((t) => [
      `"${t.name}"`,
      `"${t.table_type}"`,
      `"${t.engine || ""}"`,
      t.rows_count,
      t.data_bytes,
      t.index_bytes,
      t.total_bytes,
      t.data_free_bytes,
      `"${t.collation || ""}"`,
      `"${(t.comment || "").replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    downloadFile(csvContent, `tablas_${database}_${Date.now()}.csv`, "text/csv;charset=utf-8;");
  };

  const availableEngines = Array.from(
    new Set((data?.tables || []).map((t) => t.engine).filter(Boolean) as string[]),
  );

  const filteredTables = (data?.tables || [])
    .filter((t) => {
      const matchesSearch =
        !searchTerm.trim() ||
        t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (t.comment && t.comment.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesEngine =
        engineFilter === "ALL" || (t.engine && t.engine.toUpperCase() === engineFilter);
      return matchesSearch && matchesEngine;
    })
    .sort((a, b) => {
      let valA: any = a[sortField];
      let valB: any = b[sortField];

      if (typeof valA === "string") {
        return sortOrder === "asc"
          ? valA.localeCompare(valB)
          : valB.localeCompare(valA);
      }

      valA = Number(valA) || 0;
      valB = Number(valB) || 0;
      return sortOrder === "asc" ? valA - valB : valB - valA;
    });

  if (isLoading) {
    return (
      <div className="flex-1 flex bg-canvas">
        <EmptyState icon={<Spinner className="w-6 h-6" />} title={t("tablesOverview.loading", { database })} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-canvas text-center">
        <HardDrive className="w-10 h-10 mb-3 text-fg-muted" />
        <h3 className="text-base font-semibold text-fg mb-1">{t("tablesOverview.errorTitle")}</h3>
        <p className="text-sm text-fg-muted max-w-md mb-4">{error || t("tablesOverview.errorFallback")}</p>
        <button
          onClick={loadTablesOverview}
          className={primaryBtn}
        >
          {t("tablesOverview.retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="pyro-view pyro-tables-overview flex-1 min-h-0 h-full p-6 bg-canvas overflow-y-auto space-y-6 select-none" data-tables-overview>
      {/* Top Header */}
      <div data-tables-header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-line">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg border border-line flex items-center justify-center text-warning">
            <TableIcon className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-sm font-semibold text-fg font-mono">{database}</h2>
              <span className="text-[11px] font-medium px-2 py-0.5 rounded text-warning border border-line">
                {t("tablesOverview.badge")}
              </span>
            </div>
            <p className="text-xs text-fg-muted">
              {t("tablesOverview.subtitle")}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {onOpenCreateTable && (
            <button
              onClick={() => onOpenCreateTable(database)}
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-accent-fg bg-accent hover:bg-accent-hover border border-accent/40 rounded-md transition-colors shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t("tablesOverview.newTable")}</span>
            </button>
          )}
          {onOpenImportExcel && (
            <button
              onClick={() => onOpenImportExcel(database)}
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-success hover:bg-hover border border-line rounded-md transition-colors"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>{t("tablesOverview.importData")}</span>
            </button>
          )}
          {onOpenSqlExport && (
            <button
              onClick={() => onOpenSqlExport(database)}
              title={t("tablesOverview.exportSqlTitle")}
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-danger hover:bg-hover border border-line rounded-md transition-colors"
            >
              <FileCode2 className="w-3.5 h-3.5" />
              <span>{t("tablesOverview.exportSql")}</span>
            </button>
          )}
          <button
            onClick={handleExportCsv}
            title={t("tablesOverview.exportCsvTitle")}
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-fg bg-raised hover:bg-hover border border-line rounded-md transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{t("tablesOverview.exportCsv")}</span>
          </button>
          <button
            onClick={loadTablesOverview}
            title={t("tablesOverview.refreshTitle")}
            className="p-1.5 text-fg-muted hover:text-fg bg-raised hover:bg-hover border border-line rounded-md transition-colors"
          >
            <RefreshCw className="w-4 h-4 text-fg-muted" />
          </button>
        </div>
      </div>

      {/* Primary Database KPIs */}
      <div data-tables-summary className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="p-3.5 rounded-xl bg-surface border border-line flex flex-col justify-between">
          <span className="text-[11px] font-medium text-fg-muted block">
            {t("tablesOverview.totalTables")}
          </span>
          <div className="text-lg font-semibold text-fg font-mono mt-1">
            {data.tables_count}
          </div>
          <span className="text-[11px] text-fg-subtle mt-0.5">{t("tablesOverview.viewsCount", { count: data.views_count })}</span>
        </div>

        <div className="p-3.5 rounded-xl bg-surface border border-line flex flex-col justify-between">
          <span className="text-[11px] font-medium text-fg-muted block">
            {t("tablesOverview.estimatedRows")}
          </span>
          <div className="text-lg font-semibold text-success font-mono mt-1">
            ~{data.total_rows.toLocaleString()}
          </div>
          <span className="text-[11px] text-fg-subtle mt-0.5">{t("tablesOverview.wholeDb")}</span>
        </div>

        <div className="p-3.5 rounded-xl bg-surface border border-line flex flex-col justify-between">
          <span className="text-[11px] font-medium text-fg-muted block">
            {t("tablesOverview.totalDisk")}
          </span>
          <div className="text-lg font-semibold text-fg-muted font-mono mt-1">
            {formatBytes(data.total_bytes)}
          </div>
          <span className="text-[11px] text-fg-subtle mt-0.5">{t("tablesOverview.dataPlusIndexes")}</span>
        </div>

        <div className="p-3.5 rounded-xl bg-surface border border-line flex flex-col justify-between">
          <span className="text-[11px] font-medium text-fg-muted block">
            {t("tablesOverview.indexSize")}
          </span>
          <div className="text-lg font-semibold text-accent-text font-mono mt-1">
            {formatBytes(data.total_index_bytes)}
          </div>
          <span className="text-[11px] text-fg-subtle mt-0.5">
            {data.total_bytes > 0
              ? t("tablesOverview.percentOfTotal", { pct: Math.round((data.total_index_bytes / data.total_bytes) * 100) })
              : "0%"}
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-surface border border-line flex flex-col justify-between">
          <span className="text-[11px] font-medium text-fg-muted block">
            {t("tablesOverview.freeSpace")}
          </span>
          <div className="text-lg font-semibold text-fg font-mono mt-1">
            {formatBytes(data.total_free_bytes)}
          </div>
          <span className="text-[11px] text-fg-subtle mt-0.5">{t("tablesOverview.reclaimableOptimize")}</span>
        </div>
      </div>

      {/* Storage distribution */}
      {data.tables.length > 1 && (
        <div data-tables-storage className="rounded-lg border border-line bg-surface p-3">
          <div className="text-[11px] text-fg-muted mb-2">{t("tablesOverview.storageDistTitle")}</div>
          <React.Suspense fallback={<div className="h-40 flex items-center justify-center text-[11px] text-fg-muted">{t("tablesOverview.loadingChart")}</div>}>
            <TableSizeTreemap tables={data.tables.filter((t) => t.table_type !== "VIEW")} />
          </React.Suspense>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div data-tables-filters className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-raised p-3 rounded-xl border border-line">
        <div className="relative flex-1 max-w-md 2xl:max-w-xl">
          <Search className="w-3.5 h-3.5 text-fg-subtle absolute left-3 top-3" />
          <input
            type="text"
            placeholder={t("tablesOverview.searchPlaceholder")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-canvas border border-line rounded-md text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent transition-colors"
          />
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-xs text-fg-muted font-medium">{t("tablesOverview.engineLabel")}</span>
          <select
            value={engineFilter}
            onChange={(e) => setEngineFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-canvas border border-line rounded-md text-fg focus:outline-none focus:border-accent font-mono"
          >
            <option value="ALL">{t("tablesOverview.allEngines")}</option>
            {availableEngines.map((eng) => (
              <option key={eng} value={eng.toUpperCase()}>
                {eng}
              </option>
            ))}
          </select>

          <span className="text-xs text-fg-subtle font-mono px-2">
            {t("tablesOverview.showingCount", { shown: filteredTables.length, total: data.tables.length })}
          </span>
        </div>
      </div>

      {/* Tables List Data Grid */}
      <div data-tables-grid className="rounded-xl bg-surface border border-line overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse font-mono">
            <thead>
              <tr className="bg-raised text-fg-muted font-semibold border-b border-line text-[11px]">
                <th
                  onClick={() => handleSort("name")}
                  className="py-3 px-4 cursor-pointer hover:text-fg transition-colors"
                >
                  <div className="flex items-center space-x-1.5">
                    <span>{t("tablesOverview.colTable")}</span>
                    <ArrowUpDown className="w-3 h-3 text-fg-subtle" />
                  </div>
                </th>
                <th className="py-3 px-3">{t("tablesOverview.colEngine")}</th>
                <th
                  onClick={() => handleSort("rows_count")}
                  className="py-3 px-4 text-right cursor-pointer hover:text-fg transition-colors"
                >
                  <div className="flex items-center justify-end space-x-1.5">
                    <span>{t("tablesOverview.colEstimatedRows")}</span>
                    <ArrowUpDown className="w-3 h-3 text-fg-subtle" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort("data_bytes")}
                  className="py-3 px-4 text-right cursor-pointer hover:text-fg transition-colors"
                >
                  <div className="flex items-center justify-end space-x-1.5">
                    <span>{t("tablesOverview.colDataSize")}</span>
                    <ArrowUpDown className="w-3 h-3 text-fg-subtle" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort("index_bytes")}
                  className="py-3 px-4 text-right cursor-pointer hover:text-fg transition-colors"
                >
                  <div className="flex items-center justify-end space-x-1.5">
                    <span>{t("tablesOverview.colIndexSize")}</span>
                    <ArrowUpDown className="w-3 h-3 text-fg-subtle" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort("total_bytes")}
                  className="py-3 px-4 text-right cursor-pointer hover:text-fg transition-colors"
                >
                  <div className="flex items-center justify-end space-x-1.5">
                    <span>{t("tablesOverview.colTotalSpace")}</span>
                    <ArrowUpDown className="w-3 h-3 text-fg-subtle" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort("data_free_bytes")}
                  className="py-3 px-4 text-right cursor-pointer hover:text-fg transition-colors"
                >
                  <div className="flex items-center justify-end space-x-1.5">
                    <span>{t("tablesOverview.colFreeFrag")}</span>
                    <ArrowUpDown className="w-3 h-3 text-fg-subtle" />
                  </div>
                </th>
                <th className="py-3 px-4 text-center">{t("tablesOverview.colActions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line text-fg">
              {filteredTables.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-fg-subtle italic">
                    {t("tablesOverview.noMatchingTables")}
                  </td>
                </tr>
              ) : (
                filteredTables.map((tbl) => {
                  const isView = tbl.table_type === "VIEW";

                  return (
                    <tr
                      key={tbl.name}
                      className="hover:bg-hover transition-colors group cursor-pointer"
                      onClick={() => handleOpenTable(tbl.name)}
                    >
                      <td className="py-2.5 px-4 font-bold text-fg">
                        <div className="flex items-center space-x-2">
                          <TableIcon className="w-3.5 h-3.5 shrink-0 text-fg-muted" />
                          <span className="group-hover:text-accent-text transition-colors">
                            {tbl.name}
                          </span>
                          {isView && (
                            <span className="text-[11px] px-1.5 py-0.2 rounded bg-raised text-fg border border-line">
                              {t("tablesOverview.viewBadge")}
                            </span>
                          )}
                          {tbl.comment && (
                            <span className="text-[11px] text-fg-subtle font-sans font-normal truncate max-w-xs" title={tbl.comment}>
                              {tbl.comment}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-[11px] px-2 py-0.5 rounded bg-raised text-fg-muted border border-line">
                          {tbl.engine || (isView ? "VIEW" : "N/A")}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right text-fg font-mono">
                        {tbl.rows_count.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-4 text-right text-fg font-mono">
                        {formatBytes(tbl.data_bytes)}
                      </td>
                      <td className="py-2.5 px-4 text-right text-accent-text font-mono">
                        {formatBytes(tbl.index_bytes)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-bold text-fg font-mono">
                        {formatBytes(tbl.total_bytes)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono">
                        {tbl.data_free_bytes > 0 ? (
                          <span className="text-warning" title={t("tablesOverview.freeSpaceTooltip")}>
                            {formatBytes(tbl.data_free_bytes)}
                          </span>
                        ) : (
                          <span className="text-fg-subtle">0 B</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <div
                          className="flex items-center justify-center space-x-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => handleOpenTable(tbl.name)}
                            title={t("tablesOverview.openDataTooltip")}
                            className="p-1 rounded bg-raised hover:bg-hover text-fg hover:text-accent-text border border-line transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          {onOpenOperations && (
                            <button
                              type="button"
                              onClick={() => onOpenOperations(database)}
                              title={t("tablesOverview.maintenanceTooltip")}
                              className="p-1 rounded bg-raised hover:bg-hover text-fg hover:text-fg-muted border border-line transition-colors"
                            >
                              <Wrench className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {onOpenImportExcel && (
                            <button
                              type="button"
                              onClick={() => onOpenImportExcel(database, tbl.name)}
                              title={t("tablesOverview.importExcelTooltip")}
                              className="p-1 rounded bg-raised hover:bg-hover text-fg hover:text-success border border-line transition-colors"
                            >
                              <FileSpreadsheet className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {onOpenSqlExport && (
                            <button
                              type="button"
                              onClick={() => onOpenSqlExport(database, tbl.name)}
                              title={t("tablesOverview.exportTableSqlTooltip")}
                              className="p-1 rounded bg-raised hover:bg-hover text-fg hover:text-danger border border-line transition-colors"
                            >
                              <FileCode2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
