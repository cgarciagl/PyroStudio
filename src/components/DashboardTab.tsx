import React, { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Cpu,
  Database,
  Download,
  FileCode2,
  HardDrive,
  Layers,
  Loader2,
  RefreshCw,
  Server,
  Sparkles,
  Table,
  Archive,
} from "lucide-react";
import { dbService } from "../services/tauriDb";
import { downloadFile } from "../services/diagnosticExport";
import type { DatabaseDashboardInfo } from "../types/database";
import { useUIStore } from "../stores/uiStore";

interface DashboardTabProps {
  database: string;
  onOpenHealth?: () => void;
  onOpenSlowQuery?: (view?: "server_log") => void;
  onOpenAdvisor?: () => void;
  onOpenDiff?: () => void;
  onOpenOperations?: () => void;
  onOpenTablesOverview?: () => void;
  onOpenSqlExport?: () => void;
  onOpenBackupRestore?: () => void;
}

export const DashboardTab: React.FC<DashboardTabProps> = ({
  database,
  onOpenHealth,
  onOpenSlowQuery,
  onOpenAdvisor,
  onOpenDiff,
  onOpenOperations,
  onOpenTablesOverview,
  onOpenSqlExport,
  onOpenBackupRestore,
}) => {
  const [data, setData] = useState<DatabaseDashboardInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { openTab } = useUIStore();

  const loadDashboard = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await dbService.getDatabaseDashboard(database);
      setData(res);
    } catch (err: unknown) {
      console.error("Failed to load dashboard:", err);
      setError(
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Error al cargar las métricas de la base de datos",
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, [database]);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const handleExportJson = () => {
    if (!data) return;
    downloadFile(
      JSON.stringify(data, null, 2),
      `dashboard_${database}_${Date.now()}.json`,
      "application/json",
    );
  };

  const handleOpenHealth = () => {
    if (onOpenHealth) {
      onOpenHealth();
    } else {
      openTab({
        id: `health-${database}`,
        title: `Salud: ${database}`,
        type: "health",
        database,
      });
    }
  };

  const handleOpenSlowQuery = (view?: "server_log") => {
    if (onOpenSlowQuery) {
      onOpenSlowQuery(view);
    } else {
      openTab({
        id: `slow-query-${database}`,
        title: `Slow Query: ${database}`,
        type: "slow_query",
        database,
        initialView: view,
      });
    }
  };

  const handleOpenAdvisor = () => {
    if (onOpenAdvisor) {
      onOpenAdvisor();
    } else {
      openTab({
        id: `advisor-${database}`,
        title: `Advisor: ${database}`,
        type: "advisor",
        database,
      });
    }
  };

  const handleOpenOperations = () => {
    if (onOpenOperations) {
      onOpenOperations();
    } else {
      openTab({
        id: `operations-${database}`,
        title: `Operaciones: ${database}`,
        type: "operations",
        database,
      });
    }
  };

  const handleOpenDiff = () => {
    if (onOpenDiff) {
      onOpenDiff();
    } else {
      openTab({
        id: `diff-${database}`,
        title: `Diff: ${database}`,
        type: "diff",
        database,
      });
    }
  };

  const handleOpenTablesOverview = () => {
    if (onOpenTablesOverview) {
      onOpenTablesOverview();
    } else {
      openTab({
        id: `tables-overview-${database}`,
        title: `Tablas (${database})`,
        type: "tables_overview",
        database,
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-neutral-400 bg-[#0a0c10]">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500 mb-3" />
        <span className="text-sm font-medium">Analizando métricas de '{database}'...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[#0a0c10] text-center">
        <AlertTriangle className="w-10 h-10 text-rose-500 mb-3" />
        <h3 className="text-base font-semibold text-white mb-1">Error de Diagnóstico</h3>
        <p className="text-sm text-neutral-400 max-w-md mb-4">{error || "No se pudieron obtener métricas."}</p>
        <button
          onClick={loadDashboard}
          className="px-4 py-2 text-xs font-semibold text-white bg-orange-600 hover:bg-orange-500 rounded-md transition-colors"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const srv = data.server_summary;
  const connPct = srv ? Math.round((srv.threads_connected / srv.max_connections) * 100) : 0;
  const uptimeDays = srv ? Math.floor(srv.uptime_seconds / 86400) : 0;
  const uptimeHours = srv ? Math.floor((srv.uptime_seconds % 86400) / 3600) : 0;

  return (
    <div className="flex-1 flex flex-col p-6 bg-[#0a0c10] overflow-y-auto space-y-6 select-none min-h-0">
      {/* Header Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#1c2233] shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-orange-950/40 border border-orange-500/30 flex items-center justify-center text-orange-400">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-lg font-bold text-white font-mono">{data.database_name}</h2>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-950/50 text-emerald-400 border border-emerald-800/40">
                Activa
              </span>
            </div>
            <p className="text-xs text-neutral-400">
              Dashboard de Inteligencia Operacional y Recursos de Almacenamiento
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={handleOpenHealth}
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600/90 hover:bg-emerald-500 border border-emerald-500/40 rounded-md transition-colors"
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Salud de BD</span>
          </button>
          <button
            onClick={() => handleOpenSlowQuery()}
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-neutral-200 bg-[#141824] hover:bg-[#1f2535] border border-[#232a3e] rounded-md transition-colors"
          >
            <Activity className="w-3.5 h-3.5 text-orange-400" />
            <span>Slow Query</span>
          </button>
          <button
            onClick={handleOpenAdvisor}
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-orange-600/90 hover:bg-orange-500 border border-orange-500/40 rounded-md transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Index Advisor</span>
          </button>
          <button
            onClick={handleOpenDiff}
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-neutral-300 bg-[#141824] hover:bg-[#1f2535] border border-[#232a3e] rounded-md transition-colors"
          >
            <Layers className="w-3.5 h-3.5 text-sky-400" />
            <span>Schema Diff</span>
          </button>
          <button
            onClick={handleOpenOperations}
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-neutral-300 bg-[#141824] hover:bg-[#1f2535] border border-[#232a3e] rounded-md transition-colors"
          >
            <Cpu className="w-3.5 h-3.5 text-amber-400" />
            <span>Operaciones</span>
          </button>
          {onOpenSqlExport && (
            <button
              onClick={onOpenSqlExport}
              title="Exportar base de datos a SQL (.sql Dump)"
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-rose-300 bg-rose-950/40 hover:bg-rose-900/40 border border-rose-700/40 rounded-md transition-colors"
            >
              <FileCode2 className="w-3.5 h-3.5" />
              <span>Exportar SQL</span>
            </button>
          )}
          {onOpenBackupRestore && (
            <button
              onClick={onOpenBackupRestore}
              title="Respaldar y Restaurar base de datos"
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-orange-300 bg-orange-950/40 hover:bg-orange-900/40 border border-orange-700/40 rounded-md transition-colors"
            >
              <Archive className="w-3.5 h-3.5" />
              <span>Respaldar / Restaurar</span>
            </button>
          )}
          <button
            onClick={handleExportJson}
            title="Exportar Métricas en JSON"
            className="p-1.5 text-neutral-400 hover:text-white bg-[#141824] hover:bg-[#1f2535] border border-[#232a3e] rounded-md transition-colors"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={loadDashboard}
            title="Refrescar Métricas"
            className="p-1.5 text-neutral-400 hover:text-white bg-[#141824] hover:bg-[#1f2535] border border-[#232a3e] rounded-md transition-colors"
          >
            <RefreshCw className="w-4 h-4 text-orange-400" />
          </button>
        </div>
      </div>

      {/* Primary Schema Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
        <div
          onClick={handleOpenTablesOverview}
          className="p-4 rounded-xl bg-[#10131d] hover:bg-[#151928] border border-[#1f2538] hover:border-amber-500/40 flex flex-col justify-between cursor-pointer transition-all group"
        >
          <div className="flex items-center justify-between text-neutral-400 group-hover:text-amber-400 mb-2 transition-colors">
            <span className="text-xs font-semibold">Tablas y Vistas</span>
            <Table className="w-4 h-4 text-orange-400" />
          </div>
          <div>
            <div className="text-2xl font-extrabold text-white font-mono group-hover:text-amber-300 transition-colors">
              {data.tables_count}
            </div>
            <div className="text-[11px] text-neutral-500 mt-0.5 flex items-center justify-between">
              <span>{data.views_count} vistas</span>
              <span className="text-amber-400 text-[10px] font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                Ver todas ➔
              </span>
            </div>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#10131d] border border-[#1f2538] flex flex-col justify-between">
          <div className="flex items-center justify-between text-neutral-400 mb-2">
            <span className="text-xs font-semibold">Espacio en Disco</span>
            <HardDrive className="w-4 h-4 text-sky-400" />
          </div>
          <div>
            <div className="text-2xl font-extrabold text-white font-mono">
              {formatBytes(data.total_data_bytes + data.total_index_bytes)}
            </div>
            <div className="text-[11px] text-neutral-500 mt-0.5">
              Datos: {formatBytes(data.total_data_bytes)} | Índices: {formatBytes(data.total_index_bytes)}
            </div>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#10131d] border border-[#1f2538] flex flex-col justify-between">
          <div className="flex items-center justify-between text-neutral-400 mb-2">
            <span className="text-xs font-semibold">Filas Estimadas</span>
            <Layers className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <div className="text-2xl font-extrabold text-white font-mono">
              ~{data.estimated_total_rows.toLocaleString()}
            </div>
            <div className="text-[11px] text-neutral-500 mt-0.5">Suma de registros en tablas</div>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#10131d] border border-[#1f2538] flex flex-col justify-between">
          <div className="flex items-center justify-between text-neutral-400 mb-2">
            <span className="text-xs font-semibold">Rutinas y Triggers</span>
            <FileCode2 className="w-4 h-4 text-purple-400" />
          </div>
          <div>
            <div className="text-2xl font-extrabold text-white font-mono">
              {data.routines_count + data.triggers_count}
            </div>
            <div className="text-[11px] text-neutral-500 mt-0.5">
              {data.routines_count} SP/Funciones | {data.triggers_count} Triggers
            </div>
          </div>
        </div>
      </div>

      {/* Server Performance Banner (When available) */}
      {srv && (
        <div className="p-4 rounded-xl bg-[#121622] border border-[#22293d] space-y-4">
          <div className="flex items-center justify-between border-b border-[#1f2638] pb-3">
            <div className="flex items-center space-x-2 text-sm font-bold text-white">
              <Server className="w-4 h-4 text-orange-400" />
              <span>Rendimiento del Motor MariaDB/MySQL</span>
            </div>
            <div className="text-xs text-neutral-400 font-mono">
              Versión: <span className="text-white font-semibold">{srv.version}</span> | Uptime:{" "}
              <span className="text-emerald-400 font-semibold">{uptimeDays}d {uptimeHours}h</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            {/* Buffer Cache Hit Rate */}
            <div className="p-3 rounded-lg bg-[#0e111a] border border-[#1a2030] flex flex-col justify-between">
              <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                InnoDB Buffer Pool Hit Rate
              </span>
              <div className="my-2 flex items-baseline space-x-2">
                <span className="text-2xl font-extrabold font-mono text-emerald-400">
                  {srv.innodb_buffer_pool_hit_rate}%
                </span>
                <span className="text-[10px] text-neutral-500">
                  ({formatBytes(srv.innodb_buffer_pool_bytes)})
                </span>
              </div>
              <div className="w-full h-1.5 bg-[#181d2c] rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full"
                  style={{ width: `${Math.min(100, srv.innodb_buffer_pool_hit_rate)}%` }}
                />
              </div>
            </div>

            {/* QPS */}
            <div className="p-3 rounded-lg bg-[#0e111a] border border-[#1a2030] flex flex-col justify-between">
              <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                Throughput (QPS)
              </span>
              <div className="my-2 flex items-baseline space-x-2">
                <span className="text-2xl font-extrabold font-mono text-sky-400">{srv.qps}</span>
                <span className="text-[10px] text-neutral-500">consultas/seg</span>
              </div>
              <span className="text-[10px] text-neutral-500">
                Total: {srv.queries_total.toLocaleString()} consultas
              </span>
            </div>

            {/* Slow Queries (Clickable) */}
            <div
              onClick={() => handleOpenSlowQuery("server_log")}
              className="p-3 rounded-lg bg-[#0e111a] hover:bg-[#161a28] border border-[#1a2030] hover:border-orange-500/40 flex flex-col justify-between cursor-pointer transition-all group"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider group-hover:text-orange-400 transition-colors">
                  Consultas Lentas
                </span>
                <span className="text-[10px] text-orange-400 opacity-0 group-hover:opacity-100 transition-opacity">
                  Ver detalle ➔
                </span>
              </div>
              <div className="my-2 flex items-baseline space-x-2">
                <span
                  className={`text-2xl font-extrabold font-mono ${
                    srv.slow_queries > 0 ? "text-amber-400" : "text-emerald-400"
                  }`}
                >
                  {srv.slow_queries}
                </span>
              </div>
              <span className="text-[10px] text-neutral-500 group-hover:text-neutral-400 transition-colors">
                Explorar registro y performance schema
              </span>
            </div>

            {/* Connections Pool */}
            <div className="p-3 rounded-lg bg-[#0e111a] border border-[#1a2030] flex flex-col justify-between">
              <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                Conexiones Activas
              </span>
              <div className="my-2 flex items-baseline space-x-2">
                <span className="text-2xl font-extrabold font-mono text-white">
                  {srv.threads_connected}
                </span>
                <span className="text-[10px] text-neutral-500">/ {srv.max_connections} máx ({connPct}%)</span>
              </div>
              <div className="w-full h-1.5 bg-[#181d2c] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    connPct > 80 ? "bg-rose-500" : connPct > 60 ? "bg-amber-500" : "bg-sky-500"
                  }`}
                  style={{ width: `${Math.min(100, connPct)}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top Tables by Storage Size */}
      <div className="rounded-xl bg-[#10131d] border border-[#1f2538] overflow-hidden shadow-xl">
        <div className="px-5 py-3.5 bg-[#141724] border-b border-[#20273a] flex items-center justify-between">
          <div className="flex items-center space-x-2 text-xs font-bold text-neutral-200">
            <BarChart3 className="w-4 h-4 text-orange-400" />
            <span>Top Tablas por Consumo de Almacenamiento (Datos + Índices)</span>
          </div>
          <button
            onClick={handleOpenTablesOverview}
            className="text-[11px] text-amber-400 hover:text-amber-300 font-medium flex items-center space-x-1 hover:underline transition-all"
          >
            <span>Ver lista completa ({data.tables_count} tablas) ➔</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse font-mono">
            <thead>
              <tr className="bg-[#151926] text-neutral-400 font-semibold border-b border-[#212739] text-[11px]">
                <th className="py-2.5 px-4">Tabla</th>
                <th className="py-2.5 px-4 text-right">Filas Estimadas</th>
                <th className="py-2.5 px-4 text-right">Tamaño Datos</th>
                <th className="py-2.5 px-4 text-right">Tamaño Índices</th>
                <th className="py-2.5 px-4 text-right">Espacio Total</th>
                <th className="py-2.5 px-4 w-40">Proporción Datos / Índice</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1b2131] text-neutral-300">
              {data.top_tables_by_size.map((tbl, idx) => {
                const total = tbl.total_bytes > 0 ? tbl.total_bytes : 1;
                const dataPct = Math.round((tbl.data_bytes / total) * 100);
                const idxPct = 100 - dataPct;

                return (
                  <tr key={idx} className="hover:bg-[#161a28] transition-colors">
                    <td className="py-2.5 px-4 font-bold text-white flex items-center space-x-2">
                      <Table className="w-3.5 h-3.5 text-neutral-500" />
                      <span>{tbl.name}</span>
                    </td>
                    <td className="py-2.5 px-4 text-right text-neutral-400">
                      {tbl.rows_count.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4 text-right text-neutral-300">
                      {formatBytes(tbl.data_bytes)}
                    </td>
                    <td className="py-2.5 px-4 text-right text-orange-400">
                      {formatBytes(tbl.index_bytes)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-bold text-white">
                      {formatBytes(tbl.total_bytes)}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="flex h-2 rounded-full overflow-hidden bg-[#1f2535]" title={`Datos: ${dataPct}% | Índices: ${idxPct}%`}>
                        <div className="bg-sky-500" style={{ width: `${dataPct}%` }} />
                        <div className="bg-orange-500" style={{ width: `${idxPct}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
