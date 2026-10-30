import React, { useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Code2,
  Copy,
  Flame,
  History,
  Info,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  XOctagon,
} from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { sql as sqlLang } from "@codemirror/lang-sql";
import { dbService } from "../services/tauriDb";
import { useUIStore } from "../stores/uiStore";
import { useIsLightTheme } from "../stores/preferenceStore";
import type {
  ServerSlowQueriesReport,
  SlowQueryAnalysis,
} from "../types/database";
import { QueryPlanViewer } from "./QueryPlanViewer";
import { ConfirmModal } from "./ConfirmModal";

interface SlowQueryAnalyzerTabProps {
  database: string;
  initialQuery?: string;
  initialSql?: string;
  initialView?: "custom" | "server_log";
}

export const SlowQueryAnalyzerTab: React.FC<SlowQueryAnalyzerTabProps> = ({
  database,
  initialQuery,
  initialSql,
  initialView,
}) => {
  const isLight = useIsLightTheme();
  const [mainView, setMainView] = useState<"custom" | "server_log">(
    initialView || "custom",
  );
  const [query, setQuery] = useState(
    initialSql ||
      initialQuery ||
      "SELECT * FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'test' ORDER BY DATA_LENGTH DESC LIMIT 50;",
  );
  const [analysis, setAnalysis] = useState<SlowQueryAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Server slow queries state
  const [serverReport, setServerReport] = useState<ServerSlowQueriesReport | null>(null);
  const [isServerLoading, setIsServerLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverSubTab, setServerSubTab] = useState<"slow_log" | "digest" | "processlist">("digest");
  const [serverFilter, setServerFilter] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pendingKill, setPendingKill] = useState<{
    id: number;
    type: "QUERY" | "CONNECTION";
    info: string;
    user: string;
  } | null>(null);

  const handleAnalyzeQuery = async (queryToAnalyze?: string) => {
    const targetQuery = queryToAnalyze || query;
    if (!targetQuery.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await dbService.analyzeSlowQuery(targetQuery, database);
      setAnalysis(res);
      setMainView("custom");
    } catch (err: unknown) {
      console.error("Slow query analysis failed:", err);
      setError(
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Error al analizar el plan de ejecución de la consulta",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const loadServerSlowQueries = async () => {
    setIsServerLoading(true);
    setServerError(null);
    try {
      const res = await dbService.getServerSlowQueries(database);
      setServerReport(res);
      // If slow_log entries exist, default to slow_log, otherwise digest
      if (res.slow_log_entries.length > 0) {
        setServerSubTab("slow_log");
      } else if (res.performance_digest_entries.length > 0) {
        setServerSubTab("digest");
      } else if (res.running_queries.length > 0) {
        setServerSubTab("processlist");
      }
    } catch (err: unknown) {
      console.error("Failed to load server slow queries:", err);
      setServerError(
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Error al consultar el registro de slow queries del servidor",
      );
    } finally {
      setIsServerLoading(false);
    }
  };

  useEffect(() => {
    if (mainView === "server_log" && !serverReport) {
      loadServerSlowQueries();
    }
  }, [mainView, database]);

  const handleSelectQueryForExplain = (sqlText: string) => {
    setQuery(sqlText);
    setMainView("custom");
    handleAnalyzeQuery(sqlText);
  };

  const handleCopySql = (sql: string, id: string) => {
    navigator.clipboard.writeText(sql);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleConfirmKillProcess = async () => {
    if (!pendingKill) return;
    try {
      const msg = await dbService.executeKillProcess(pendingKill.id, pendingKill.type);
      useUIStore.getState().showAlert({
        title: "Operación de Servidor Ejecutada",
        message: msg,
        variant: "info",
        icon: "info",
      });
      setPendingKill(null);
      await loadServerSlowQueries();
    } catch (err: unknown) {
      useUIStore.getState().showAlert({
        title: "Error al Terminar Proceso",
        message: typeof err === "string" ? err : (err as Error)?.message || "No se pudo terminar el proceso en el motor.",
        variant: "danger",
        icon: "alert",
      });
    }
  };

  return (
    <div className="flex-1 flex flex-col p-5 bg-canvas overflow-y-auto space-y-4 select-none min-h-0">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-line shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-lg bg-accent-soft border border-accent/30 flex items-center justify-center text-accent-text">
            <Flame className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-fg flex items-center space-x-2">
              <span>Consultas Lentas & Analizador EXPLAIN</span>
              <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-accent-soft text-accent-text border border-accent/30">
                {database}
              </span>
            </h2>
            <p className="text-xs text-fg-muted">
              Inspección visual del optimizador, registro de consultas lentas y rendimiento
            </p>
          </div>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center space-x-1.5 bg-raised p-1 rounded-lg border border-line shrink-0">
          <button
            onClick={() => setMainView("custom")}
            className={`flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              mainView === "custom"
                ? "bg-accent text-accent-fg shadow-sm"
                : "text-fg-muted hover:text-fg"
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Analizador EXPLAIN</span>
          </button>
          <button
            onClick={() => {
              setMainView("server_log");
              if (!serverReport) loadServerSlowQueries();
            }}
            className={`flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              mainView === "server_log"
                ? "bg-accent text-accent-fg shadow-sm"
                : "text-fg-muted hover:text-fg"
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Registro del Servidor</span>
          </button>
        </div>
      </div>

      {/* VIEW 1: CUSTOM EXPLAIN ANALYZER */}
      {mainView === "custom" && (
        <div className="space-y-4">
          {/* SQL Input Code Editor */}
          <div className="rounded-xl bg-raised border border-line overflow-hidden shadow-lg">
            <div className="px-4 py-2.5 bg-raised border-b border-line flex items-center justify-between text-xs font-semibold text-fg-muted">
              <div className="flex items-center space-x-2">
                <Code2 className="w-4 h-4 text-accent-text" />
                <span>Consulta SQL a Analizar</span>
              </div>
              <button
                onClick={() => handleAnalyzeQuery()}
                disabled={isLoading || !query.trim()}
                className="flex items-center space-x-2 px-3.5 py-1.5 text-xs font-bold text-accent-fg bg-accent hover:bg-accent-hover disabled:opacity-50 border border-accent/40 rounded-md shadow transition-all"
              >
                {isLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5 fill-white" />
                )}
                <span>Ejecutar EXPLAIN</span>
              </button>
            </div>
            <div className="p-2 bg-canvas">
              <CodeMirror
                value={query}
                height="120px"
                theme={isLight ? "light" : "dark"}
                extensions={[sqlLang()]}
                onChange={(val) => setQuery(val)}
                className="text-xs font-mono rounded overflow-hidden"
              />
            </div>
          </div>

          {error && (
            <div className="p-4 rounded-xl border border-line text-danger text-xs flex items-start space-x-2.5">
              <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
              <div>
                <strong className="text-rose-200">Error al ejecutar EXPLAIN: </strong>
                <span>{error}</span>
              </div>
            </div>
          )}

          {/* Analysis Results View */}
          {analysis && (
            <div className="space-y-4">
              {/* Summary KPIs */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-xl bg-raised border border-line">
                  <span className="text-[11px] font-medium text-fg-muted block">
                    Filas Totales Estimadas
                  </span>
                  <div className="text-xl font-bold font-mono text-fg mt-1">
                    ~{analysis.estimated_total_rows.toLocaleString()}
                  </div>
                  <span className="text-[11px] text-fg-subtle">Por todos los pasos del plan</span>
                </div>

                <div className="p-3.5 rounded-xl bg-raised border border-line">
                  <span className="text-[11px] font-medium text-fg-muted block">
                    Estrategia de Join
                  </span>
                  <div className="text-xs font-bold font-mono text-accent-text mt-1 truncate">
                    {analysis.join_strategy || "Acceso a Tabla Única"}
                  </div>
                  <span className="text-[11px] text-fg-subtle">Algoritmo del optimizador</span>
                </div>

                <div className="p-3.5 rounded-xl bg-raised border border-line">
                  <span className="text-[11px] font-medium text-fg-muted block">
                    Índices Involucrados
                  </span>
                  <div className="text-xl font-bold font-mono text-success mt-1">
                    {analysis.indexes_involved.length}
                  </div>
                  <span className="text-[11px] text-fg-subtle truncate block">
                    {analysis.indexes_involved.join(", ") || "Ningún índice utilizado"}
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-raised border border-line">
                  <span className="text-[11px] font-medium text-fg-muted block">
                    Cuellos de Botella
                  </span>
                  <div
                    className={`text-xl font-bold font-mono mt-1 ${
                      analysis.bottlenecks.length > 0 ? "text-danger" : "text-success"
                    }`}
                  >
                    {analysis.bottlenecks.length}
                  </div>
                  <span className="text-[11px] text-fg-subtle">
                    {analysis.bottlenecks.length > 0 ? "Requiere optimización" : "Plan eficiente"}
                  </span>
                </div>
              </div>

              {/* Recommendations & Bottlenecks Banner */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Bottlenecks Card */}
                <div className="p-4 rounded-xl bg-raised border border-line space-y-2">
                  <div className="flex items-center space-x-2 text-xs font-bold text-danger">
                    <AlertCircle className="w-4 h-4" />
                    <span>Cuellos de Botella Detectados</span>
                  </div>
                  <div className="space-y-1.5 text-xs text-fg">
                    {analysis.bottlenecks.length === 0 ? (
                      <div className="text-success flex items-center space-x-1.5">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>No se encontraron anomalías críticas de rendimiento.</span>
                      </div>
                    ) : (
                      analysis.bottlenecks.map((b, idx) => (
                        <div key={idx} className="flex items-start space-x-2 text-danger">
                          <span className="font-bold text-danger">•</span>
                          <span>{b}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Potential Optimizations Card */}
                <div className="p-4 rounded-xl bg-raised border border-line space-y-2">
                  <div className="flex items-center space-x-2 text-xs font-bold text-accent-text">
                    <Sparkles className="w-4 h-4" />
                    <span>Recomendaciones del Optimizador</span>
                  </div>
                  <div className="space-y-1.5 text-xs text-fg">
                    {analysis.potential_optimizations.map((opt, idx) => (
                      <div key={idx} className="flex items-start space-x-2 text-accent-text">
                        <span className="font-bold text-accent-text">•</span>
                        <span>{opt}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Unified Execution Plan Viewer (Table, Hierarchical Tree, JSON) */}
              <div className="border border-line rounded-xl overflow-hidden bg-surface min-h-[400px] flex flex-col">
                <QueryPlanViewer
                  planRows={analysis.execution_plan}
                  jsonPlan={analysis.json_plan}
                  treePlan={analysis.tree_plan}
                  visualNodes={analysis.visual_nodes}
                  bottlenecks={analysis.bottlenecks}
                  potentialOptimizations={analysis.potential_optimizations}
                  querySql={query}
                  initialTab="tree"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* VIEW 2: SERVER SLOW QUERIES LOG & DIGEST */}
      {mainView === "server_log" && (
        <div className="space-y-4">
          {/* Server Config & Status Cards */}
          {serverReport && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-xl bg-raised border border-line flex flex-col justify-between">
                <span className="text-[11px] font-medium text-fg-muted block">
                  Registro de Consultas Lentas
                </span>
                <div className="my-1">
                  <span
                    className={`inline-block px-2.5 py-0.5 rounded text-xs font-bold border ${
                      serverReport.is_slow_log_enabled
                        ? "text-success border-line"
                        : "text-danger border-line"
                    }`}
                  >
                    {serverReport.is_slow_log_enabled ? "ACTIVADO" : "DESACTIVADO"}
                  </span>
                </div>
                <span className="text-[11px] text-fg-subtle">
                  Destino: {serverReport.log_output}
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-raised border border-line flex flex-col justify-between">
                <span className="text-[11px] font-medium text-fg-muted block">
                  Umbral (long_query_time)
                </span>
                <div className="text-xl font-bold font-mono text-accent-text mt-1">
                  {serverReport.long_query_time}s
                </div>
                <span className="text-[11px] text-fg-subtle">Consultas que superan este tiempo</span>
              </div>

              <div className="p-3.5 rounded-xl bg-raised border border-line flex flex-col justify-between">
                <span className="text-[11px] font-medium text-fg-muted block">
                  Contador Global Servidor
                </span>
                <div className="text-xl font-bold font-mono text-fg mt-1">
                  {serverReport.total_server_slow_queries_count.toLocaleString()}
                </div>
                <span className="text-[11px] text-fg-subtle">Total desde el inicio del motor</span>
              </div>

              <div className="p-3.5 rounded-xl bg-raised border border-line flex flex-col justify-between">
                <span className="text-[11px] font-medium text-fg-muted block">
                  Queries Sin Índice
                </span>
                <div className="text-xl font-bold font-mono text-info mt-1">
                  {serverReport.log_queries_not_using_indexes ? "Registrando" : "No registradas"}
                </div>
                <span className="text-[11px] text-fg-subtle">log_queries_not_using_indexes</span>
              </div>
            </div>
          )}

          {serverError && (
            <div className="p-4 rounded-xl border border-line text-danger text-xs flex items-start space-x-2.5">
              <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
              <div>
                <strong className="text-rose-200">Error al consultar el registro del servidor: </strong>
                <span>{serverError}</span>
              </div>
            </div>
          )}

          {/* Configuration Hint Banner if slow_log is off */}
          {serverReport && (!serverReport.is_slow_log_enabled || !serverReport.log_output.includes("TABLE")) && (
            <div className="p-4 rounded-xl bg-raised border border-line-strong text-fg text-xs flex items-start space-x-3">
              <Info className="w-5 h-5 text-info shrink-0 mt-0.5" />
              <div className="space-y-1.5">
                <div className="font-bold text-fg">
                  ¿Cómo registrar y capturar consultas lentas en MariaDB/MySQL?
                </div>
                <p className="text-fg-muted">
                  Para que el servidor almacene cada consulta lenta individual en la tabla interna <code className="text-info font-mono">mysql.slow_log</code>, puedes ejecutar (con privilegios de administrador):
                </p>
                <div className="p-2.5 rounded-md bg-canvas border border-line font-mono text-[11px] text-warning select-text">
                  SET GLOBAL slow_query_log = 'ON';<br />
                  SET GLOBAL log_output = 'TABLE';<br />
                  SET GLOBAL long_query_time = 1.0; -- Registra cualquier consulta que tarde &gt; 1s
                </div>
                <p className="text-fg-muted">
                  Mientras tanto, PyroStudio analiza automáticamente el <strong className="text-fg">Performance Schema</strong> y los <strong className="text-fg">Procesos Activos</strong> en tiempo real.
                </p>
              </div>
            </div>
          )}

          {/* Subtabs for Server Inspector */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-raised p-3 rounded-xl border border-line">
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setServerSubTab("digest")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  serverSubTab === "digest"
                    ? "bg-accent text-accent-fg"
                    : "text-fg-muted hover:text-fg bg-canvas"
                }`}
              >
                Performance Schema Digest ({serverReport?.performance_digest_entries.length || 0})
              </button>
              <button
                onClick={() => setServerSubTab("slow_log")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  serverSubTab === "slow_log"
                    ? "bg-accent text-accent-fg"
                    : "text-fg-muted hover:text-fg bg-canvas"
                }`}
              >
                mysql.slow_log ({serverReport?.slow_log_entries.length || 0})
              </button>
              <button
                onClick={() => setServerSubTab("processlist")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  serverSubTab === "processlist"
                    ? "bg-accent text-accent-fg"
                    : "text-fg-muted hover:text-fg bg-canvas"
                }`}
              >
                Procesos Activos ({serverReport?.running_queries.length || 0})
              </button>
            </div>

            <div className="flex items-center space-x-2">
              <div className="relative">
                <Search className="w-3 h-3 text-fg-subtle absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="Filtrar SQL o usuario..."
                  value={serverFilter}
                  onChange={(e) => setServerFilter(e.target.value)}
                  className="pl-7 pr-3 py-1 text-xs bg-canvas border border-line rounded-md text-fg placeholder-neutral-500 focus:outline-none focus:border-accent transition-colors w-48"
                />
              </div>

              <button
                onClick={loadServerSlowQueries}
                disabled={isServerLoading}
                title="Refrescar registro"
                className="p-1.5 text-fg-muted hover:text-fg bg-canvas hover:bg-hover border border-line rounded-md transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-accent-text ${isServerLoading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {isServerLoading && !serverReport ? (
            <div className="flex flex-col items-center justify-center p-12 text-fg-muted">
              <Loader2 className="w-8 h-8 animate-spin text-fg-muted mb-3" />
              <span className="text-xs">Consultando registro de slow queries del motor...</span>
            </div>
          ) : (
            <div className="rounded-xl bg-surface border border-line overflow-hidden shadow-pop">
              {/* SUBTAB 1: Performance Schema Statements Digest */}
              {serverSubTab === "digest" && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse font-mono">
                    <thead>
                      <tr className="bg-raised text-fg-muted font-semibold border-b border-line text-[11px]">
                        <th className="py-2.5 px-4">Patrón SQL / Digest</th>
                        <th className="py-2.5 px-3 text-right">Ejecuciones</th>
                        <th className="py-2.5 px-3 text-right">Tiempo Total</th>
                        <th className="py-2.5 px-3 text-right">Tiempo Medio</th>
                        <th className="py-2.5 px-3 text-right">Tiempo Máx</th>
                        <th className="py-2.5 px-3 text-right">Filas Exam.</th>
                        <th className="py-2.5 px-3 text-center">Sin Índice</th>
                        <th className="py-2.5 px-4 text-center">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line text-fg">
                      {(!serverReport || serverReport.performance_digest_entries.length === 0) ? (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-fg-subtle italic">
                            No se registran eventos en Performance Schema o el módulo está desactivado en el servidor.
                          </td>
                        </tr>
                      ) : (
                        serverReport.performance_digest_entries
                          .filter((e) =>
                            !serverFilter.trim() ||
                            e.digest_text.toLowerCase().includes(serverFilter.toLowerCase()) ||
                            (e.schema_name && e.schema_name.toLowerCase().includes(serverFilter.toLowerCase())),
                          )
                          .map((entry, idx) => (
                            <tr key={idx} className="hover:bg-hover transition-colors">
                              <td className="py-2.5 px-4 max-w-md">
                                <div className="font-semibold text-fg truncate" title={entry.digest_text}>
                                  {entry.digest_text}
                                </div>
                                {entry.schema_name && (
                                  <div className="text-[11px] text-fg-subtle mt-0.5">
                                    BD: {entry.schema_name}
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-right text-fg">
                                {entry.exec_count.toLocaleString()}
                              </td>
                              <td className="py-2.5 px-3 text-right text-accent-text font-bold">
                                {entry.sum_timer_wait_sec.toFixed(4)}s
                              </td>
                              <td className="py-2.5 px-3 text-right text-warning">
                                {entry.avg_timer_wait_sec.toFixed(4)}s
                              </td>
                              <td className="py-2.5 px-3 text-right text-danger font-bold">
                                {entry.max_timer_wait_sec.toFixed(4)}s
                              </td>
                              <td className="py-2.5 px-3 text-right text-fg-muted">
                                {entry.sum_rows_examined.toLocaleString()}
                              </td>
                              <td className="py-2.5 px-3 text-center">
                                {entry.sum_no_index_used > 0 ? (
                                  <span className="px-2 py-0.5 rounded text-danger border border-line text-[11px]">
                                    {entry.sum_no_index_used}
                                  </span>
                                ) : (
                                  <span className="text-fg-subtle">0</span>
                                )}
                              </td>
                              <td className="py-2.5 px-4 text-center">
                                <div className="flex items-center justify-center space-x-1.5">
                                  <button
                                    onClick={() => handleSelectQueryForExplain(entry.digest_text)}
                                    title="Analizar plan de ejecución con EXPLAIN"
                                    className="flex items-center space-x-1 px-2 py-1 rounded bg-accent-soft hover:bg-hover text-accent-text text-[11px] font-bold border border-accent/30 transition-colors"
                                  >
                                    <Activity className="w-3 h-3" />
                                    <span>EXPLAIN</span>
                                  </button>
                                  <button
                                    onClick={() => handleCopySql(entry.digest_text, `digest-${idx}`)}
                                    title="Copiar SQL"
                                    className="p-1 rounded bg-raised hover:bg-hover text-fg-muted hover:text-fg border border-line transition-colors"
                                  >
                                    {copiedId === `digest-${idx}` ? (
                                      <CheckCircle2 className="w-3 h-3 text-success" />
                                    ) : (
                                      <Copy className="w-3 h-3" />
                                    )}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* SUBTAB 2: mysql.slow_log */}
              {serverSubTab === "slow_log" && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse font-mono">
                    <thead>
                      <tr className="bg-raised text-fg-muted font-semibold border-b border-line text-[11px]">
                        <th className="py-2.5 px-3">Fecha y Hora</th>
                        <th className="py-2.5 px-3">Usuario @ Host</th>
                        <th className="py-2.5 px-3 text-right">Tiempo Ejec.</th>
                        <th className="py-2.5 px-3 text-right">Tiempo de bloqueo</th>
                        <th className="py-2.5 px-3 text-right">Filas Exam.</th>
                        <th className="py-2.5 px-4">Consulta SQL</th>
                        <th className="py-2.5 px-3 text-center">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line text-fg">
                      {(!serverReport || serverReport.slow_log_entries.length === 0) ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-fg-subtle italic">
                            No hay registros en la tabla mysql.slow_log. Verifica que log_output esté configurado en 'TABLE'.
                          </td>
                        </tr>
                      ) : (
                        serverReport.slow_log_entries
                          .filter((e) =>
                            !serverFilter.trim() ||
                            e.sql_text.toLowerCase().includes(serverFilter.toLowerCase()) ||
                            e.user_host.toLowerCase().includes(serverFilter.toLowerCase()),
                          )
                          .map((entry, idx) => (
                            <tr key={idx} className="hover:bg-hover transition-colors">
                              <td className="py-2.5 px-3 text-fg-muted text-[11px] whitespace-nowrap">
                                {entry.start_time}
                              </td>
                              <td className="py-2.5 px-3 text-fg text-[11px] truncate max-w-xs" title={entry.user_host}>
                                {entry.user_host}
                              </td>
                              <td className="py-2.5 px-3 text-right font-bold text-danger">
                                {entry.query_time_seconds.toFixed(2)}s
                              </td>
                              <td className="py-2.5 px-3 text-right text-warning">
                                {entry.lock_time_seconds.toFixed(2)}s
                              </td>
                              <td className="py-2.5 px-3 text-right text-fg">
                                {entry.rows_examined.toLocaleString()}
                              </td>
                              <td className="py-2.5 px-4 max-w-sm">
                                <div className="truncate font-mono text-fg text-[11px]" title={entry.sql_text}>
                                  {entry.sql_text}
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-center">
                                <div className="flex items-center justify-center space-x-1.5">
                                  <button
                                    onClick={() => handleSelectQueryForExplain(entry.sql_text)}
                                    title="Analizar en EXPLAIN"
                                    className="flex items-center space-x-1 px-2 py-1 rounded bg-accent-soft hover:bg-hover text-accent-text text-[11px] font-bold border border-accent/30 transition-colors"
                                  >
                                    <Activity className="w-3 h-3" />
                                    <span>EXPLAIN</span>
                                  </button>
                                  <button
                                    onClick={() => handleCopySql(entry.sql_text, `slow-${idx}`)}
                                    title="Copiar SQL"
                                    className="p-1 rounded bg-raised hover:bg-hover text-fg-muted hover:text-fg border border-line transition-colors"
                                  >
                                    {copiedId === `slow-${idx}` ? (
                                      <CheckCircle2 className="w-3 h-3 text-success" />
                                    ) : (
                                      <Copy className="w-3 h-3" />
                                    )}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* SUBTAB 3: Running Processlist */}
              {serverSubTab === "processlist" && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse font-mono">
                    <thead>
                      <tr className="bg-raised text-fg-muted font-semibold border-b border-line text-[11px]">
                        <th className="py-2.5 px-3">ID Proceso</th>
                        <th className="py-2.5 px-3">Usuario @ Host</th>
                        <th className="py-2.5 px-3">Base de Datos</th>
                        <th className="py-2.5 px-3 text-right">Tiempo Corriendo</th>
                        <th className="py-2.5 px-3">Estado</th>
                        <th className="py-2.5 px-4">Consulta SQL Activa</th>
                        <th className="py-2.5 px-3 text-center">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line text-fg">
                      {(!serverReport || serverReport.running_queries.length === 0) ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-fg-subtle italic">
                            No hay consultas lentas activas ejecutándose en este instante en el motor.
                          </td>
                        </tr>
                      ) : (
                        serverReport.running_queries
                          .filter((p) =>
                            !serverFilter.trim() ||
                            p.info.toLowerCase().includes(serverFilter.toLowerCase()) ||
                            p.user.toLowerCase().includes(serverFilter.toLowerCase()),
                          )
                          .map((proc) => (
                            <tr key={proc.id} className="hover:bg-hover transition-colors">
                              <td className="py-2.5 px-3 text-fg-muted font-bold">
                                {proc.id}
                              </td>
                              <td className="py-2.5 px-3 text-fg text-[11px]">
                                {proc.user}@{proc.host}
                              </td>
                              <td className="py-2.5 px-3 text-info text-[11px]">
                                {proc.db || "—"}
                              </td>
                              <td className="py-2.5 px-3 text-right font-bold text-warning">
                                {proc.time_seconds}s
                              </td>
                              <td className="py-2.5 px-3 text-fg-muted text-[11px]">
                                {proc.state || "Executing"}
                              </td>
                              <td className="py-2.5 px-4 max-w-sm">
                                <div className="truncate font-mono text-fg text-[11px]" title={proc.info}>
                                  {proc.info}
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-center">
                                <div className="flex items-center justify-center space-x-1.5">
                                  <button
                                    onClick={() => handleSelectQueryForExplain(proc.info)}
                                    title="Analizar en EXPLAIN"
                                    className="flex items-center space-x-1 px-2 py-1 rounded bg-accent-soft hover:bg-hover text-accent-text text-[11px] font-bold border border-accent/30 transition-colors"
                                  >
                                    <Activity className="w-3 h-3" />
                                    <span>EXPLAIN</span>
                                  </button>
                                  <button
                                    onClick={() => handleCopySql(proc.info, `proc-${proc.id}`)}
                                    title="Copiar SQL"
                                    className="p-1 rounded bg-raised hover:bg-hover text-fg-muted hover:text-fg border border-line transition-colors"
                                  >
                                    {copiedId === `proc-${proc.id}` ? (
                                      <CheckCircle2 className="w-3 h-3 text-success" />
                                    ) : (
                                      <Copy className="w-3 h-3" />
                                    )}
                                  </button>
                                  <button
                                    onClick={() =>
                                      setPendingKill({
                                        id: Number(proc.id),
                                        type: "QUERY",
                                        info: proc.info,
                                        user: `${proc.user}@${proc.host}`,
                                      })
                                    }
                                    title="Interrumpir consulta activa (KILL QUERY)"
                                    className="p-1 rounded hover:bg-hover text-warning hover:text-amber-200 border border-line transition-colors"
                                  >
                                    <XOctagon className="w-3 h-3" />
                                  </button>
                                  <button
                                    onClick={() =>
                                      setPendingKill({
                                        id: Number(proc.id),
                                        type: "CONNECTION",
                                        info: proc.info,
                                        user: `${proc.user}@${proc.host}`,
                                      })
                                    }
                                    title="Terminar sesión completa (KILL CONNECTION)"
                                    className="p-1 rounded hover:bg-hover text-danger hover:text-rose-200 border border-line transition-colors"
                                  >
                                    <AlertTriangle className="w-3 h-3" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Confirm Kill Process / Query Modal */}
      {pendingKill && (
        <ConfirmModal
          isOpen={!!pendingKill}
          title={
            pendingKill.type === "QUERY"
              ? `Interrumpir Consulta (KILL QUERY ${pendingKill.id})`
              : `Terminar Sesión Completa (KILL CONNECTION ${pendingKill.id})`
          }
          message={
            pendingKill.type === "QUERY"
              ? `¿Deseas interrumpir la ejecución de la consulta del proceso #${pendingKill.id} (${pendingKill.user})? La conexión del cliente se mantendrá abierta.`
              : `¿Deseas desconectar y terminar por completo la sesión #${pendingKill.id} (${pendingKill.user})? Todas sus transacciones activas se revertirán.`
          }
          details={
            pendingKill.info
              ? `SQL: ${pendingKill.info}\n\nRequisito: Requiere privilegio PROCESS o SUPER en MySQL/MariaDB.`
              : "Requisito: Requiere privilegio PROCESS o SUPER en MySQL/MariaDB."
          }
          confirmText={pendingKill.type === "QUERY" ? "Interrumpir Consulta" : "Terminar Sesión"}
          variant="danger"
          onConfirm={handleConfirmKillProcess}
          onClose={() => setPendingKill(null)}
        />
      )}
    </div>
  );
};
