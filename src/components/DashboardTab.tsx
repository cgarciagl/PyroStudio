import React, { useCallback, useEffect, useRef, useState } from "react";

const TopTablesChart = React.lazy(() =>
  import("./charts/StorageCharts").then((m) => ({ default: m.TopTablesChart })),
);
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Database,
  Download,
  FileCode2,
  HardDrive,
  Layers,
  Lock,
  RefreshCw,
  Server,
  Table,
} from "lucide-react";
import { dbService } from "../services/tauriDb";
import { downloadFile } from "../services/diagnosticExport";
import type { DatabaseDashboardInfo, LiveEngineMetrics } from "../types/database";
import { useUIStore } from "../stores/uiStore";
import { secondaryBtn } from "./ui/styles";
import { EmptyState, Spinner } from "./ui/Modal";
import { Sparkline } from "./ui/Sparkline";
import { appendSample, calculateLiveRates, type ComputedLiveRates } from "../utils/liveMetrics";

const REFRESH_OPTIONS = [
  { label: "Pausado", value: 0 },
  { label: "1s", value: 1000 },
  { label: "2s", value: 2000 },
  { label: "5s", value: 5000 },
];

interface DashboardTabProps {
  database: string;
  onOpenSlowQuery?: (view?: "server_log") => void;
  onOpenTablesOverview?: () => void;
}

export const DashboardTab: React.FC<DashboardTabProps> = ({
  database,
  onOpenSlowQuery,
  onOpenTablesOverview,
}) => {
  const [data, setData] = useState<DatabaseDashboardInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { openTab } = useUIStore();

  // Live Telemetry Monitoring State
  const [refreshInterval, setRefreshInterval] = useState<number>(2000);
  const [liveRates, setLiveRates] = useState<ComputedLiveRates | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [qpsHistory, setQpsHistory] = useState<number[]>([]);
  const [bufferHitHistory, setBufferHitHistory] = useState<number[]>([]);
  const [connHistory, setConnHistory] = useState<number[]>([]);
  const [rowOpsHistory, setRowOpsHistory] = useState<number[]>([]);
  const prevMetricsRef = useRef<LiveEngineMetrics | null>(null);

  const fetchLiveTelemetry = useCallback(async () => {
    try {
      const metrics = await dbService.getLiveEngineMetrics();
      const rates = calculateLiveRates(metrics, prevMetricsRef.current);
      prevMetricsRef.current = metrics;
      setLiveRates(rates);
      setLastUpdated(new Date());
      setQpsHistory((prev) => appendSample(prev, rates.qps));
      setBufferHitHistory((prev) => appendSample(prev, rates.bufferHitRatio));
      setConnHistory((prev) => appendSample(prev, rates.threadsConnected));
      setRowOpsHistory((prev) => appendSample(prev, rates.totalRowOpsSec));
    } catch (err) {
      console.debug("Live telemetry poll failed:", err);
    }
  }, []);

  const loadDashboard = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await dbService.getDatabaseDashboard(database);
      setData(res);
      // Also trigger a live telemetry refresh
      fetchLiveTelemetry();
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
    prevMetricsRef.current = null;
    setLiveRates(null);
    setQpsHistory([]);
    setBufferHitHistory([]);
    setConnHistory([]);
    setRowOpsHistory([]);
    loadDashboard();
  }, [database]);

  // Periodic Telemetry Polling with Visibility & Active Tab Guard
  useEffect(() => {
    if (refreshInterval <= 0) return;

    const isTabVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return false;
      }
      const state = useUIStore.getState();
      const curTab = state.tabs.find((t) => t.id === state.activeTabId);
      return curTab ? curTab.type === "dashboard" && curTab.database === database : true;
    };

    if (isTabVisible()) {
      fetchLiveTelemetry();
    }

    const timer = setInterval(() => {
      if (isTabVisible()) {
        fetchLiveTelemetry();
      }
    }, refreshInterval);

    return () => clearInterval(timer);
  }, [refreshInterval, database, fetchLiveTelemetry]);

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

  const handleOpenSlowQuery = (view?: "server_log") => {
    if (onOpenSlowQuery) {
      onOpenSlowQuery(view);
    } else {
      openTab({
        id: `slow-query-${database}`,
        title: `Consultas Lentas: ${database}`,
        type: "slow_query",
        database,
        initialView: view,
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
      <div className="flex-1 flex bg-canvas">
        <EmptyState icon={<Spinner className="w-6 h-6" />} title={<>Analizando métricas de '{database}'...</>} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-1 flex bg-canvas">
        <EmptyState
          icon={<AlertTriangle className="w-6 h-6 text-danger" />}
          title="Error de Diagnóstico"
          description={error || "No se pudieron obtener métricas."}
          action={
            <button onClick={loadDashboard} className={secondaryBtn}>
              Reintentar
            </button>
          }
        />
      </div>
    );
  }

  const srv = data.server_summary;
  const currentQps = liveRates ? liveRates.qps : srv ? srv.qps : 0;
  const currentHitRate = liveRates
    ? liveRates.bufferHitRatio
    : srv
      ? srv.innodb_buffer_pool_hit_rate
      : 100;
  const currentConn = liveRates ? liveRates.threadsConnected : srv ? srv.threads_connected : 0;
  const maxConn = liveRates ? liveRates.maxConnections : srv ? srv.max_connections : 151;
  const connPct = Math.min(100, Math.round((currentConn / (maxConn || 1)) * 100));
  const currentRunning = liveRates ? liveRates.threadsRunning : srv ? srv.threads_running : 0;
  const currentSlow = liveRates ? liveRates.slowQueries : srv ? srv.slow_queries : 0;
  const currentLockWaits = liveRates ? liveRates.rowLockWaits : 0;
  const currentTableLocks = liveRates ? liveRates.tableLocksWaited : 0;
  const currentRowOps = liveRates ? liveRates.totalRowOpsSec : 0;
  const totalQueries = liveRates ? liveRates.queriesTotal : srv ? srv.queries_total : 0;
  const uptimeSeconds = liveRates ? liveRates.uptimeSeconds : srv ? srv.uptime_seconds : 0;
  const uptimeDays = Math.floor(uptimeSeconds / 86400);
  const uptimeHours = Math.floor((uptimeSeconds % 86400) / 3600);

  return (
    <div className="pyro-view flex-1 flex flex-col p-6 bg-canvas overflow-y-auto space-y-6 select-none min-h-0">
      {/* Header Toolbar - Clean & Focused */}
      <div data-view-toolbar className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-line shrink-0">
        <div className="flex items-center space-x-3.5">
          <div className="w-10 h-10 rounded-xl bg-accent-soft border border-accent/30 flex items-center justify-center text-accent-text shadow-inner">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2.5">
              <h2 className="text-sm font-semibold text-fg font-mono">{data.database_name}</h2>
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full text-success border border-line">
                Activa
              </span>
            </div>
            <p className="text-xs text-fg-muted mt-0.5">
              Resumen ejecutivo de almacenamiento, objetos y rendimiento del motor
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-2">
          <button
            onClick={handleExportJson}
            title="Exportar métricas del panel en formato JSON"
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-fg bg-raised hover:bg-hover hover:text-fg border border-line rounded-lg transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-fg-muted" />
            <span className="hidden sm:inline">Exportar JSON</span>
          </button>
          <button
            onClick={loadDashboard}
            title="Actualizar métricas del dashboard"
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-accent-text bg-accent-soft hover:bg-accent-soft border border-accent/40 rounded-lg transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5 text-accent-text" />
            <span>Actualizar</span>
          </button>
        </div>
      </div>

      {/* Primary Schema Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
        <div
          onClick={handleOpenTablesOverview}
          className="p-4 rounded-xl bg-surface hover:bg-hover border border-line hover:border-line-strong flex flex-col justify-between cursor-pointer transition-all group"
        >
          <div className="flex items-center justify-between text-fg-muted group-hover:text-warning mb-2 transition-colors">
            <span className="text-xs font-semibold">Tablas y Vistas</span>
            <Table className="w-4 h-4 text-accent-text" />
          </div>
          <div>
            <div className="text-lg font-semibold text-fg font-mono">
              {data.tables_count}
            </div>
            <div className="text-[11px] text-fg-subtle mt-0.5 flex items-center justify-between">
              <span>{data.views_count} vistas</span>
              <span className="text-warning text-[11px] font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                Ver todas ➔
              </span>
            </div>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-surface border border-line flex flex-col justify-between">
          <div className="flex items-center justify-between text-fg-muted mb-2">
            <span className="text-xs font-semibold">Espacio en Disco</span>
            <HardDrive className="w-4 h-4 text-info" />
          </div>
          <div>
            <div className="text-lg font-semibold text-fg font-mono">
              {formatBytes(data.total_data_bytes + data.total_index_bytes)}
            </div>
            <div className="text-[11px] text-fg-subtle mt-0.5">
              Datos: {formatBytes(data.total_data_bytes)} | Índices: {formatBytes(data.total_index_bytes)}
            </div>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-surface border border-line flex flex-col justify-between">
          <div className="flex items-center justify-between text-fg-muted mb-2">
            <span className="text-xs font-semibold">Filas Estimadas</span>
            <Layers className="w-4 h-4 text-success" />
          </div>
          <div>
            <div className="text-lg font-semibold text-fg font-mono">
              ~{data.estimated_total_rows.toLocaleString()}
            </div>
            <div className="text-[11px] text-fg-subtle mt-0.5">Suma de registros en tablas</div>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-surface border border-line flex flex-col justify-between">
          <div className="flex items-center justify-between text-fg-muted mb-2">
            <span className="text-xs font-semibold">Rutinas y Triggers</span>
            <FileCode2 className="w-4 h-4 text-fg-muted" />
          </div>
          <div>
            <div className="text-lg font-semibold text-fg font-mono">
              {data.routines_count + data.triggers_count}
            </div>
            <div className="text-[11px] text-fg-subtle mt-0.5">
              {data.routines_count} SP/Funciones | {data.triggers_count} Triggers
            </div>
          </div>
        </div>
      </div>

      {/* Live Server Performance Banner */}
      {srv && (
        <div className="p-4 rounded-xl bg-raised border border-line space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-line pb-3">
            <div className="flex items-center space-x-2">
              <div className="flex items-center space-x-1.5 text-sm font-bold text-fg">
                <Server className="w-4 h-4 text-accent-text" />
                <span>Rendimiento del Motor en Tiempo Real</span>
              </div>
              <div className="flex items-center space-x-1.5 pl-2 border-l border-line text-xs text-fg-muted font-mono">
                <span className={`w-2 h-2 rounded-full ${refreshInterval > 0 ? "bg-success" : "bg-line"}`} />
                <span>{refreshInterval > 0 ? "En vivo" : "Pausado"}</span>
                {lastUpdated && (
                  <span className="text-[11px] text-fg-subtle hidden md:inline">
                    • {lastUpdated.toLocaleTimeString()}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center space-x-3 text-xs text-fg-muted font-mono">
              <div className="hidden lg:inline text-fg-subtle">
                Versión: <span className="text-fg font-semibold">{srv.version}</span> | Activo:{" "}
                <span className="text-success font-semibold">{uptimeDays}d {uptimeHours}h</span>
              </div>

              {/* Interval Selector */}
              <div className="flex items-center space-x-1 bg-surface border border-line p-0.5 rounded-lg">
                {REFRESH_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setRefreshInterval(opt.value)}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                      refreshInterval === opt.value
                        ? "bg-accent text-accent-fg"
                        : "text-fg-muted hover:text-fg hover:bg-hover"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {/* 1. Throughput (QPS) */}
            <div className="p-3 rounded-lg bg-surface border border-line flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-fg-muted">Throughput (QPS)</span>
                <Activity className="w-3.5 h-3.5 text-info" />
              </div>
              <div className="my-1.5 flex items-baseline justify-between">
                <div>
                  <span className="text-lg font-semibold font-mono text-info">{currentQps}</span>
                  <span className="text-[11px] text-fg-subtle ml-1">QPS</span>
                </div>
                <div className="w-24 h-7">
                  <Sparkline
                    data={qpsHistory.length > 0 ? qpsHistory : [currentQps]}
                    strokeColor="var(--info, #38bdf8)"
                    fillColor="rgba(56, 189, 248, 0.12)"
                    height={28}
                    width={96}
                  />
                </div>
              </div>
              <span className="text-[11px] text-fg-subtle truncate">
                Total: {totalQueries.toLocaleString()} consultas
              </span>
            </div>

            {/* 2. Buffer Pool Hit Rate */}
            <div className="p-3 rounded-lg bg-surface border border-line flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-fg-muted">Buffer Pool Hit Rate</span>
                {currentHitRate < 95 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/15 text-warning font-medium">
                    Bajo
                  </span>
                )}
              </div>
              <div className="my-1.5 flex items-baseline justify-between">
                <div>
                  <span
                    className={`text-lg font-semibold font-mono ${
                      currentHitRate < 95 ? "text-warning" : "text-success"
                    }`}
                  >
                    {currentHitRate}%
                  </span>
                </div>
                <div className="w-24 h-7">
                  <Sparkline
                    data={bufferHitHistory.length > 0 ? bufferHitHistory : [currentHitRate]}
                    strokeColor={currentHitRate < 95 ? "var(--warning, #f59e0b)" : "var(--success, #22c55e)"}
                    fillColor={currentHitRate < 95 ? "rgba(245, 158, 11, 0.12)" : "rgba(34, 197, 94, 0.12)"}
                    height={28}
                    width={96}
                    min={90}
                    max={100}
                  />
                </div>
              </div>
              <div className="w-full h-1 bg-elevated rounded-full overflow-hidden mb-1">
                <div
                  className={`h-full rounded-full ${currentHitRate < 95 ? "bg-warning" : "bg-success"}`}
                  style={{ width: `${Math.min(100, currentHitRate)}%` }}
                />
              </div>
              <span className="text-[11px] text-fg-subtle truncate">
                RAM ({formatBytes(srv.innodb_buffer_pool_bytes)})
              </span>
            </div>

            {/* 3. Connections */}
            <div className="p-3 rounded-lg bg-surface border border-line flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-fg-muted">Conexiones Activas</span>
                <span className="text-[10px] font-mono text-fg-subtle">{currentRunning} activos</span>
              </div>
              <div className="my-1.5 flex items-baseline justify-between">
                <div>
                  <span className="text-lg font-semibold font-mono text-fg">{currentConn}</span>
                  <span className="text-[11px] text-fg-subtle ml-1">/ {maxConn} ({connPct}%)</span>
                </div>
                <div className="w-24 h-7">
                  <Sparkline
                    data={connHistory.length > 0 ? connHistory : [currentConn]}
                    strokeColor={connPct > 80 ? "var(--danger, #ef4444)" : "var(--accent, #f97316)"}
                    fillColor={connPct > 80 ? "rgba(239, 68, 68, 0.12)" : "rgba(249, 115, 22, 0.12)"}
                    height={28}
                    width={96}
                    min={0}
                  />
                </div>
              </div>
              <div className="w-full h-1 bg-elevated rounded-full overflow-hidden mb-1">
                <div
                  className={`h-full rounded-full ${
                    connPct > 80 ? "bg-danger" : connPct > 60 ? "bg-warning" : "bg-info"
                  }`}
                  style={{ width: `${Math.min(100, connPct)}%` }}
                />
              </div>
              <span className="text-[11px] text-fg-subtle truncate">
                Pool disponible: {Math.max(0, maxConn - currentConn)}
              </span>
            </div>

            {/* 4. InnoDB Row Operations */}
            <div className="p-3 rounded-lg bg-surface border border-line flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-fg-muted">Operaciones Fila/s</span>
                <span className="text-[10px] font-mono text-accent-text">InnoDB</span>
              </div>
              <div className="my-1.5 flex items-baseline justify-between">
                <div>
                  <span className="text-lg font-semibold font-mono text-fg">{currentRowOps}</span>
                  <span className="text-[11px] text-fg-subtle ml-1">ops/s</span>
                </div>
                <div className="w-24 h-7">
                  <Sparkline
                    data={rowOpsHistory.length > 0 ? rowOpsHistory : [currentRowOps]}
                    strokeColor="var(--accent, #f97316)"
                    fillColor="rgba(249, 115, 22, 0.12)"
                    height={28}
                    width={96}
                    min={0}
                  />
                </div>
              </div>
              <div className="text-[10px] font-mono text-fg-subtle flex items-center justify-between pt-0.5">
                <span>R:{liveRates?.rowsReadSec ?? 0}</span>
                <span>I:{liveRates?.rowsInsertedSec ?? 0}</span>
                <span>U:{liveRates?.rowsUpdatedSec ?? 0}</span>
                <span>D:{liveRates?.rowsDeletedSec ?? 0}</span>
              </div>
            </div>

            {/* 5. Locks & Slow Queries */}
            <div
              onClick={() => handleOpenSlowQuery("server_log")}
              className="p-3 rounded-lg bg-surface hover:bg-hover border border-line hover:border-accent/40 flex flex-col justify-between cursor-pointer transition-all group"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-fg-muted group-hover:text-accent-text transition-colors">
                  Esperas y Lentas
                </span>
                <span className="text-[11px] text-accent-text opacity-0 group-hover:opacity-100 transition-opacity">
                  Ver ➔
                </span>
              </div>
              <div className="my-1.5 flex items-baseline justify-between">
                <div>
                  <span
                    className={`text-lg font-semibold font-mono ${
                      currentLockWaits > 0 ? "text-danger" : "text-fg"
                    }`}
                  >
                    {currentLockWaits}
                  </span>
                  <span className="text-[11px] text-fg-subtle ml-1">row locks</span>
                </div>
                <div className="flex items-center space-x-1">
                  <Lock className={`w-4 h-4 ${currentLockWaits > 0 ? "text-danger" : "text-fg-subtle"}`} />
                </div>
              </div>
              <span className="text-[11px] text-fg-subtle group-hover:text-fg-muted transition-colors truncate">
                Lentas: {currentSlow} | Tbl locks: {currentTableLocks}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Top Tables by Storage Size */}
      <div className="rounded-xl bg-surface border border-line overflow-hidden shadow-pop">
        <div className="px-5 py-3.5 bg-raised border-b border-line flex items-center justify-between">
          <div className="flex items-center space-x-2 text-xs font-bold text-fg">
            <BarChart3 className="w-4 h-4 text-accent-text" />
            <span>Tablas con mayor consumo de Almacenamiento (Datos + Índices)</span>
          </div>
          <button
            onClick={handleOpenTablesOverview}
            className="text-[11px] text-warning hover:text-warning font-medium flex items-center space-x-1 hover:underline transition-all"
          >
            <span>Ver todas las tablas ({data.tables_count}) ➔</span>
          </button>
        </div>

        <div className="px-4 pt-3">
          <React.Suspense fallback={<div className="h-40 flex items-center justify-center text-[11px] text-fg-muted">Cargando gráfica…</div>}>
            <TopTablesChart tables={data.top_tables_by_size} />
          </React.Suspense>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse font-mono">
            <thead>
              <tr className="bg-raised text-fg-muted font-semibold border-b border-line text-[11px]">
                <th className="py-2.5 px-4">Tabla</th>
                <th className="py-2.5 px-4 text-right">Filas Estimadas</th>
                <th className="py-2.5 px-4 text-right">Tamaño Datos</th>
                <th className="py-2.5 px-4 text-right">Tamaño Índices</th>
                <th className="py-2.5 px-4 text-right">Espacio Total</th>
                <th className="py-2.5 px-4 w-40">Proporción Datos / Índice</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line text-fg">
              {data.top_tables_by_size.map((tbl, idx) => {
                const total = tbl.total_bytes > 0 ? tbl.total_bytes : 1;
                const dataPct = Math.round((tbl.data_bytes / total) * 100);
                const idxPct = 100 - dataPct;

                return (
                  <tr
                    key={idx}
                    onClick={() => {
                      openTab({
                        id: `table-${database}-${tbl.name}`,
                        title: tbl.name,
                        type: "table",
                        database,
                        tableName: tbl.name,
                      });
                    }}
                    className="hover:bg-hover cursor-pointer transition-colors group"
                  >
                    <td className="py-2.5 px-4 font-bold text-fg flex items-center space-x-2 group-hover:text-accent-text transition-colors">
                      <Table className="w-3.5 h-3.5 text-fg-subtle group-hover:text-accent-text transition-colors" />
                      <span>{tbl.name}</span>
                    </td>
                    <td className="py-2.5 px-4 text-right text-fg-muted">
                      {tbl.rows_count.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4 text-right text-fg">
                      {formatBytes(tbl.data_bytes)}
                    </td>
                    <td className="py-2.5 px-4 text-right text-accent-text">
                      {formatBytes(tbl.index_bytes)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-bold text-fg">
                      {formatBytes(tbl.total_bytes)}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="flex h-2 rounded-full overflow-hidden bg-elevated" title={`Datos: ${dataPct}% | Índices: ${idxPct}%`}>
                        <div className="bg-info" style={{ width: `${dataPct}%` }} />
                        <div className="bg-accent" style={{ width: `${idxPct}%` }} />
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
