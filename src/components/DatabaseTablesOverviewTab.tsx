import React, { useEffect, useState } from "react";
import {
  ArrowUpDown,
  Download,
  Eye,
  FileSpreadsheet,
  HardDrive,
  Loader2,
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
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Error al cargar la lista de tablas y estadísticas",
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
    const i = Math.floor(Math.log(bytes) / Math.log(k));
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
      "Tabla",
      "Tipo",
      "Motor",
      "Filas",
      "Tam_Datos_Bytes",
      "Tam_Indices_Bytes",
      "Tam_Total_Bytes",
      "Espacio_Libre_Bytes",
      "Cotejamiento",
      "Comentario",
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
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-neutral-400 bg-[#0a0c10]">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500 mb-3" />
        <span className="text-sm font-medium">Analizando tablas y almacenamiento de '{database}'...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[#0a0c10] text-center">
        <HardDrive className="w-10 h-10 text-rose-500 mb-3" />
        <h3 className="text-base font-semibold text-white mb-1">Error al Obtener Lista de Tablas</h3>
        <p className="text-sm text-neutral-400 max-w-md mb-4">{error || "No se pudieron obtener las estadísticas."}</p>
        <button
          onClick={loadTablesOverview}
          className="px-4 py-2 text-xs font-semibold text-white bg-orange-600 hover:bg-orange-500 rounded-md transition-colors"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 h-full p-6 bg-[#0a0c10] overflow-y-auto space-y-6 select-none">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#1c2233]">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-amber-950/40 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <TableIcon className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-lg font-bold text-white font-mono">{database}</h2>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-amber-950/50 text-amber-400 border border-amber-800/40">
                Lista de Tablas y Almacenamiento
              </span>
            </div>
            <p className="text-xs text-neutral-400">
              Estadísticas detalladas de tablas, registros, espacio de datos e índices
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {onOpenCreateTable && (
            <button
              onClick={() => onOpenCreateTable(database)}
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-orange-600 hover:bg-orange-500 border border-orange-500/40 rounded-md transition-colors shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Nueva Tabla</span>
            </button>
          )}
          {onOpenImportExcel && (
            <button
              onClick={() => onOpenImportExcel(database)}
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-300 bg-emerald-950/40 hover:bg-emerald-900/40 border border-emerald-700/40 rounded-md transition-colors"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Importar Excel</span>
            </button>
          )}
          {onOpenSqlExport && (
            <button
              onClick={() => onOpenSqlExport(database)}
              title="Exportar base de datos a SQL (.sql Dump)"
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-rose-300 bg-rose-950/40 hover:bg-rose-900/40 border border-rose-700/40 rounded-md transition-colors"
            >
              <FileCode2 className="w-3.5 h-3.5" />
              <span>Exportar SQL</span>
            </button>
          )}
          <button
            onClick={handleExportCsv}
            title="Exportar resumen a CSV"
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-neutral-300 bg-[#141824] hover:bg-[#1f2535] border border-[#232a3e] rounded-md transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Exportar CSV</span>
          </button>
          <button
            onClick={loadTablesOverview}
            title="Refrescar lista"
            className="p-1.5 text-neutral-400 hover:text-white bg-[#141824] hover:bg-[#1f2535] border border-[#232a3e] rounded-md transition-colors"
          >
            <RefreshCw className="w-4 h-4 text-orange-400" />
          </button>
        </div>
      </div>

      {/* Primary Database KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="p-3.5 rounded-xl bg-[#10131d] border border-[#1f2538] flex flex-col justify-between">
          <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider block">
            Total Tablas
          </span>
          <div className="text-xl font-extrabold text-white font-mono mt-1">
            {data.tables_count}
          </div>
          <span className="text-[10px] text-neutral-500 mt-0.5">{data.views_count} vistas</span>
        </div>

        <div className="p-3.5 rounded-xl bg-[#10131d] border border-[#1f2538] flex flex-col justify-between">
          <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider block">
            Filas Estimadas
          </span>
          <div className="text-xl font-extrabold text-emerald-400 font-mono mt-1">
            ~{data.total_rows.toLocaleString()}
          </div>
          <span className="text-[10px] text-neutral-500 mt-0.5">En toda la base de datos</span>
        </div>

        <div className="p-3.5 rounded-xl bg-[#10131d] border border-[#1f2538] flex flex-col justify-between">
          <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider block">
            Espacio Total Disco
          </span>
          <div className="text-xl font-extrabold text-sky-400 font-mono mt-1">
            {formatBytes(data.total_bytes)}
          </div>
          <span className="text-[10px] text-neutral-500 mt-0.5">Datos + Índices</span>
        </div>

        <div className="p-3.5 rounded-xl bg-[#10131d] border border-[#1f2538] flex flex-col justify-between">
          <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider block">
            Tamaño de Índices
          </span>
          <div className="text-xl font-extrabold text-orange-400 font-mono mt-1">
            {formatBytes(data.total_index_bytes)}
          </div>
          <span className="text-[10px] text-neutral-500 mt-0.5">
            {data.total_bytes > 0
              ? `${Math.round((data.total_index_bytes / data.total_bytes) * 100)}% del total`
              : "0%"}
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-[#10131d] border border-[#1f2538] flex flex-col justify-between">
          <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider block">
            Espacio Libre / Frag.
          </span>
          <div className="text-xl font-extrabold text-neutral-300 font-mono mt-1">
            {formatBytes(data.total_free_bytes)}
          </div>
          <span className="text-[10px] text-neutral-500 mt-0.5">Recuperable con OPTIMIZE</span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#11141e] p-3 rounded-xl border border-[#1f2638]">
        <div className="relative flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Buscar tabla o comentario..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-[#0c0e14] border border-[#202636] rounded-md text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-orange-500 transition-colors"
          />
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-xs text-neutral-400 font-medium">Motor:</span>
          <select
            value={engineFilter}
            onChange={(e) => setEngineFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-[#0c0e14] border border-[#202636] rounded-md text-neutral-200 focus:outline-none focus:border-orange-500 font-mono"
          >
            <option value="ALL">Todos los motores</option>
            {availableEngines.map((eng) => (
              <option key={eng} value={eng.toUpperCase()}>
                {eng}
              </option>
            ))}
          </select>

          <span className="text-xs text-neutral-500 font-mono px-2">
            Mostrando {filteredTables.length} de {data.tables.length}
          </span>
        </div>
      </div>

      {/* Tables List Data Grid */}
      <div className="rounded-xl bg-[#10131d] border border-[#1f2538] overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse font-mono">
            <thead>
              <tr className="bg-[#151926] text-neutral-400 font-semibold border-b border-[#212739] text-[11px]">
                <th
                  onClick={() => handleSort("name")}
                  className="py-3 px-4 cursor-pointer hover:text-white transition-colors"
                >
                  <div className="flex items-center space-x-1.5">
                    <span>Tabla</span>
                    <ArrowUpDown className="w-3 h-3 text-neutral-500" />
                  </div>
                </th>
                <th className="py-3 px-3">Motor</th>
                <th
                  onClick={() => handleSort("rows_count")}
                  className="py-3 px-4 text-right cursor-pointer hover:text-white transition-colors"
                >
                  <div className="flex items-center justify-end space-x-1.5">
                    <span>Filas Estimadas</span>
                    <ArrowUpDown className="w-3 h-3 text-neutral-500" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort("data_bytes")}
                  className="py-3 px-4 text-right cursor-pointer hover:text-white transition-colors"
                >
                  <div className="flex items-center justify-end space-x-1.5">
                    <span>Tamaño Datos</span>
                    <ArrowUpDown className="w-3 h-3 text-neutral-500" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort("index_bytes")}
                  className="py-3 px-4 text-right cursor-pointer hover:text-white transition-colors"
                >
                  <div className="flex items-center justify-end space-x-1.5">
                    <span>Tamaño Índices</span>
                    <ArrowUpDown className="w-3 h-3 text-neutral-500" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort("total_bytes")}
                  className="py-3 px-4 text-right cursor-pointer hover:text-white transition-colors"
                >
                  <div className="flex items-center justify-end space-x-1.5">
                    <span>Espacio Total</span>
                    <ArrowUpDown className="w-3 h-3 text-neutral-500" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort("data_free_bytes")}
                  className="py-3 px-4 text-right cursor-pointer hover:text-white transition-colors"
                >
                  <div className="flex items-center justify-end space-x-1.5">
                    <span>Frag. / Libre</span>
                    <ArrowUpDown className="w-3 h-3 text-neutral-500" />
                  </div>
                </th>
                <th className="py-3 px-4 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1b2131] text-neutral-300">
              {filteredTables.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-neutral-500 italic">
                    No se encontraron tablas que coincidan con el filtro.
                  </td>
                </tr>
              ) : (
                filteredTables.map((tbl) => {
                  const isView = tbl.table_type === "VIEW";

                  return (
                    <tr
                      key={tbl.name}
                      className="hover:bg-[#161a28] transition-colors group cursor-pointer"
                      onClick={() => handleOpenTable(tbl.name)}
                    >
                      <td className="py-2.5 px-4 font-bold text-white">
                        <div className="flex items-center space-x-2">
                          <TableIcon className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                          <span className="group-hover:text-orange-400 transition-colors">
                            {tbl.name}
                          </span>
                          {isView && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-purple-950/70 text-purple-300 border border-purple-800/40">
                              VISTA
                            </span>
                          )}
                          {tbl.comment && (
                            <span className="text-[10px] text-neutral-500 font-sans font-normal truncate max-w-xs" title={tbl.comment}>
                              {tbl.comment}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-[10px] px-2 py-0.5 rounded bg-[#151926] text-neutral-400 border border-[#22293b]">
                          {tbl.engine || (isView ? "VIEW" : "N/A")}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right text-neutral-300 font-mono">
                        {tbl.rows_count.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-4 text-right text-neutral-300 font-mono">
                        {formatBytes(tbl.data_bytes)}
                      </td>
                      <td className="py-2.5 px-4 text-right text-orange-400 font-mono">
                        {formatBytes(tbl.index_bytes)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-bold text-white font-mono">
                        {formatBytes(tbl.total_bytes)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono">
                        {tbl.data_free_bytes > 0 ? (
                          <span className="text-amber-400" title="Espacio libre en disco desasignado">
                            {formatBytes(tbl.data_free_bytes)}
                          </span>
                        ) : (
                          <span className="text-neutral-600">0 B</span>
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
                            title="Abrir vista de datos e inspector"
                            className="p-1 rounded bg-[#161a28] hover:bg-orange-600/20 text-neutral-300 hover:text-orange-400 border border-[#242c40] transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          {onOpenOperations && (
                            <button
                              type="button"
                              onClick={() => onOpenOperations(database)}
                              title="Operaciones de mantenimiento (OPTIMIZE / CHECK)"
                              className="p-1 rounded bg-[#161a28] hover:bg-cyan-600/20 text-neutral-300 hover:text-cyan-400 border border-[#242c40] transition-colors"
                            >
                              <Wrench className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {onOpenImportExcel && (
                            <button
                              type="button"
                              onClick={() => onOpenImportExcel(database, tbl.name)}
                              title="Importar datos de Excel a esta tabla"
                              className="p-1 rounded bg-[#161a28] hover:bg-emerald-600/20 text-neutral-300 hover:text-emerald-400 border border-[#242c40] transition-colors"
                            >
                              <FileSpreadsheet className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {onOpenSqlExport && (
                            <button
                              type="button"
                              onClick={() => onOpenSqlExport(database, tbl.name)}
                              title="Exportar esta tabla a SQL (.sql Dump)"
                              className="p-1 rounded bg-[#161a28] hover:bg-rose-600/20 text-neutral-300 hover:text-rose-400 border border-[#242c40] transition-colors"
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
