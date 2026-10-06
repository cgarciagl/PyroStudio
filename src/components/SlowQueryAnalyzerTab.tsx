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
} from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { sql as sqlLang } from "@codemirror/lang-sql";
import { dbService } from "../services/tauriDb";
import type {
  ServerSlowQueriesReport,
  SlowQueryAnalysis,
} from "../types/database";
import { QueryPlanViewer } from "./QueryPlanViewer";

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
  const [activeSubTab, setActiveSubTab] = useState<"visual" | "table" | "json">("visual");

  // Server slow queries state
  const [serverReport, setServerReport] = useState<ServerSlowQueriesReport | null>(null);
  const [isServerLoading, setIsServerLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverSubTab, setServerSubTab] = useState<"slow_log" | "digest" | "processlist">("digest");
  const [serverFilter, setServerFilter] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

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

  return (
    <div className="flex-1 flex flex-col p-5 bg-[#0a0c10] overflow-y-auto space-y-4 select-none min-h-0">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#1c2233] shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-lg bg-orange-950/40 border border-orange-500/30 flex items-center justify-center text-orange-400">
            <Flame className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white flex items-center space-x-2">
              <span>Slow Query & EXPLAIN Analyzer</span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-orange-950/50 text-orange-400 border border-orange-800/40">
                {database}
              </span>
            </h2>
            <p className="text-xs text-neutral-400">
              Inspección visual del optimizador, registro de consultas lentas y rendimiento
            </p>
          </div>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center space-x-1.5 bg-[#121520] p-1 rounded-lg border border-[#1f2638] shrink-0">
          <button
            onClick={() => setMainView("custom")}
            className={`flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              mainView === "custom"
                ? "bg-orange-600 text-white shadow-sm"
                : "text-neutral-400 hover:text-white"
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
                ? "bg-orange-600 text-white shadow-sm"
                : "text-neutral-400 hover:text-white"
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
          <div className="rounded-xl bg-[#11141e] border border-[#1f2638] overflow-hidden shadow-lg">
            <div className="px-4 py-2.5 bg-[#151926] border-b border-[#212739] flex items-center justify-between text-xs font-semibold text-neutral-400">
              <div className="flex items-center space-x-2">
                <Code2 className="w-4 h-4 text-orange-400" />
                <span>Consulta SQL a Analizar</span>
              </div>
              <button
                onClick={() => handleAnalyzeQuery()}
                disabled={isLoading || !query.trim()}
                className="flex items-center space-x-2 px-3.5 py-1.5 text-xs font-bold text-white bg-orange-600 hover:bg-orange-500 disabled:opacity-50 border border-orange-500/40 rounded-md shadow transition-all active:scale-95"
              >
                {isLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5 fill-white" />
                )}
                <span>Ejecutar EXPLAIN</span>
              </button>
            </div>
            <div className="p-2 bg-[#0c0e14]">
              <CodeMirror
                value={query}
                height="120px"
                theme="dark"
                extensions={[sqlLang()]}
                onChange={(val) => setQuery(val)}
                className="text-xs font-mono rounded overflow-hidden"
              />
            </div>
          </div>

          {error && (
            <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-800/50 text-rose-300 text-xs flex items-start space-x-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
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
                <div className="p-3.5 rounded-xl bg-[#11141e] border border-[#1f2638]">
                  <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider block">
                    Filas Totales Estimadas
                  </span>
                  <div className="text-xl font-bold font-mono text-white mt-1">
                    ~{analysis.estimated_total_rows.toLocaleString()}
                  </div>
                  <span className="text-[10px] text-neutral-500">Por todos los pasos del plan</span>
                </div>

                <div className="p-3.5 rounded-xl bg-[#11141e] border border-[#1f2638]">
                  <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider block">
                    Estrategia de Join
                  </span>
                  <div className="text-xs font-bold font-mono text-orange-400 mt-1 truncate">
                    {analysis.join_strategy || "Acceso a Tabla Única"}
                  </div>
                  <span className="text-[10px] text-neutral-500">Algoritmo del optimizador</span>
                </div>

                <div className="p-3.5 rounded-xl bg-[#11141e] border border-[#1f2638]">
                  <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider block">
                    Índices Involucrados
                  </span>
                  <div className="text-xl font-bold font-mono text-emerald-400 mt-1">
                    {analysis.indexes_involved.length}
                  </div>
                  <span className="text-[10px] text-neutral-500 truncate block">
                    {analysis.indexes_involved.join(", ") || "Ningún índice utilizado"}
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-[#11141e] border border-[#1f2638]">
                  <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider block">
                    Cuellos de Botella
                  </span>
                  <div
                    className={`text-xl font-bold font-mono mt-1 ${
                      analysis.bottlenecks.length > 0 ? "text-rose-400" : "text-emerald-400"
                    }`}
                  >
                    {analysis.bottlenecks.length}
                  </div>
                  <span className="text-[10px] text-neutral-500">
                    {analysis.bottlenecks.length > 0 ? "Requiere optimización" : "Plan eficiente"}
                  </span>
                </div>
              </div>

              {/* Recommendations & Bottlenecks Banner */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Bottlenecks Card */}
                <div className="p-4 rounded-xl bg-[#131622] border border-[#22283a] space-y-2">
                  <div className="flex items-center space-x-2 text-xs font-bold text-rose-400">
                    <AlertCircle className="w-4 h-4" />
                    <span>Cuellos de Botella Detectados</span>
                  </div>
                  <div className="space-y-1.5 text-xs text-neutral-300">
                    {analysis.bottlenecks.length === 0 ? (
                      <div className="text-emerald-400 flex items-center space-x-1.5">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>No se encontraron anomalías críticas de rendimiento.</span>
                      </div>
                    ) : (
                      analysis.bottlenecks.map((b, idx) => (
                        <div key={idx} className="flex items-start space-x-2 text-rose-300">
                          <span className="font-bold text-rose-500">•</span>
                          <span>{b}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Potential Optimizations Card */}
                <div className="p-4 rounded-xl bg-[#131622] border border-[#22283a] space-y-2">
                  <div className="flex items-center space-x-2 text-xs font-bold text-orange-400">
                    <Sparkles className="w-4 h-4" />
                    <span>Recomendaciones del Optimizador</span>
                  </div>
                  <div className="space-y-1.5 text-xs text-neutral-300">
                    {analysis.potential_optimizations.map((opt, idx) => (
                      <div key={idx} className="flex items-start space-x-2 text-orange-200">
                        <span className="font-bold text-orange-400">•</span>
                        <span>{opt}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Subtabs for Visual Tree vs Table vs JSON Plan */}
              <div className="border border-[#1f2638] rounded-xl overflow-hidden bg-[#10131d]">
                <div className="px-4 py-2.5 bg-[#141824] border-b border-[#20273a] flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => setActiveSubTab("visual")}
                      className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                        activeSubTab === "visual"
                          ? "bg-orange-600 text-white"
                          : "text-neutral-400 hover:text-white"
                      }`}
                    >
                      Árbol Visual de Ejecución
                    </button>
                    <button
                      onClick={() => setActiveSubTab("table")}
                      className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                        activeSubTab === "table"
                          ? "bg-orange-600 text-white"
                          : "text-neutral-400 hover:text-white"
                      }`}
                    >
                      Tabla EXPLAIN
                    </button>
                    {analysis.json_plan && (
                      <button
                        onClick={() => setActiveSubTab("json")}
                        className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                          activeSubTab === "json"
                            ? "bg-orange-600 text-white"
                            : "text-neutral-400 hover:text-white"
                        }`}
                      >
                        JSON Plan del Optimizador
                      </button>
                    )}
                  </div>

                  {analysis.is_analyze_supported && (
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-2 py-0.5 rounded">
                      EXPLAIN ANALYZE Compatible
                    </span>
                  )}
                </div>

                <div className="p-4">
                  {activeSubTab === "visual" && (
                    <div className="space-y-3">
                      <div className="text-xs text-neutral-400 mb-2">
                        Visualización estructurada del orden de joins y métodos de acceso:
                      </div>
                      <div className="flex flex-col space-y-2">
                        {analysis.visual_nodes.map((node, idx) => {
                          const isScan = node.access_type === "ALL";
                          const isRef = node.access_type === "REF" || node.access_type === "EQ_REF";

                          return (
                            <div
                              key={idx}
                              className="p-3.5 rounded-xl bg-[#0c0e14] border border-[#1d2334] flex flex-col sm:flex-row sm:items-center justify-between gap-3 font-mono text-xs"
                            >
                              <div className="flex items-center space-x-3">
                                <div className="w-7 h-7 rounded-lg bg-[#181e2c] border border-[#262f44] flex items-center justify-center font-bold text-white">
                                  {node.id}
                                </div>
                                <div>
                                  <div className="flex items-center space-x-2">
                                    <span className="font-bold text-white text-sm">
                                      {node.table_name}
                                    </span>
                                    <span className="text-[10px] text-neutral-500">
                                      ({node.select_type})
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-neutral-400 mt-0.5">
                                    Llave:{" "}
                                    <span className="text-orange-400 font-semibold">
                                      {node.key || "NULL (Sin índice)"}
                                    </span>{" "}
                                    | Ref: {node.ref_columns.join(", ") || "—"}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center space-x-3">
                                {node.flags.map((flag, fIdx) => (
                                  <span
                                    key={fIdx}
                                    className="text-[10px] px-2 py-0.5 rounded bg-amber-950/40 text-amber-300 border border-amber-800/40"
                                  >
                                    {flag}
                                  </span>
                                ))}
                                <div className="text-right">
                                  <span
                                    className={`inline-block px-2.5 py-0.5 rounded text-[11px] font-bold border ${
                                      isScan
                                        ? "bg-rose-950/60 border-rose-800 text-rose-300"
                                        : isRef
                                        ? "bg-emerald-950/60 border-emerald-800 text-emerald-300"
                                        : "bg-sky-950/60 border-sky-800 text-sky-300"
                                    }`}
                                  >
                                    {node.access_type}
                                  </span>
                                  <div className="text-[10px] text-neutral-400 mt-0.5">
                                    ~{node.estimated_rows.toLocaleString()} filas
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {activeSubTab === "table" && (
                    <QueryPlanViewer planRows={analysis.execution_plan} />
                  )}

                  {activeSubTab === "json" && analysis.json_plan && (
                    <pre className="p-4 bg-[#0a0c10] border border-[#1c2233] rounded-lg text-xs font-mono text-sky-300 overflow-x-auto max-h-96">
                      {JSON.stringify(analysis.json_plan, null, 2)}
                    </pre>
                  )}
                </div>
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
              <div className="p-3.5 rounded-xl bg-[#11141e] border border-[#1f2638] flex flex-col justify-between">
                <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider block">
                  Slow Query Log
                </span>
                <div className="my-1">
                  <span
                    className={`inline-block px-2.5 py-0.5 rounded text-xs font-bold border ${
                      serverReport.is_slow_log_enabled
                        ? "bg-emerald-950/60 text-emerald-400 border-emerald-800/40"
                        : "bg-rose-950/60 text-rose-400 border-rose-800/40"
                    }`}
                  >
                    {serverReport.is_slow_log_enabled ? "ACTIVADO" : "DESACTIVADO"}
                  </span>
                </div>
                <span className="text-[10px] text-neutral-500">
                  Destino: {serverReport.log_output}
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-[#11141e] border border-[#1f2638] flex flex-col justify-between">
                <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider block">
                  Umbral (long_query_time)
                </span>
                <div className="text-xl font-bold font-mono text-orange-400 mt-1">
                  {serverReport.long_query_time}s
                </div>
                <span className="text-[10px] text-neutral-500">Consultas que superan este tiempo</span>
              </div>

              <div className="p-3.5 rounded-xl bg-[#11141e] border border-[#1f2638] flex flex-col justify-between">
                <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider block">
                  Contador Global Servidor
                </span>
                <div className="text-xl font-bold font-mono text-white mt-1">
                  {serverReport.total_server_slow_queries_count.toLocaleString()}
                </div>
                <span className="text-[10px] text-neutral-500">Total desde el inicio del motor</span>
              </div>

              <div className="p-3.5 rounded-xl bg-[#11141e] border border-[#1f2638] flex flex-col justify-between">
                <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider block">
                  Queries Sin Índice
                </span>
                <div className="text-xl font-bold font-mono text-sky-400 mt-1">
                  {serverReport.log_queries_not_using_indexes ? "Registrando" : "No registradas"}
                </div>
                <span className="text-[10px] text-neutral-500">log_queries_not_using_indexes</span>
              </div>
            </div>
          )}

          {serverError && (
            <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-800/50 text-rose-300 text-xs flex items-start space-x-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-rose-200">Error al consultar el registro del servidor: </strong>
                <span>{serverError}</span>
              </div>
            </div>
          )}

          {/* Configuration Hint Banner if slow_log is off */}
          {serverReport && (!serverReport.is_slow_log_enabled || !serverReport.log_output.includes("TABLE")) && (
            <div className="p-4 rounded-xl bg-[#131726] border border-[#232d4a] text-neutral-300 text-xs flex items-start space-x-3">
              <Info className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
              <div className="space-y-1.5">
                <div className="font-bold text-white">
                  ¿Cómo registrar y capturar consultas lentas en MariaDB/MySQL?
                </div>
                <p className="text-neutral-400">
                  Para que el servidor almacene cada consulta lenta individual en la tabla interna <code className="text-sky-300 font-mono">mysql.slow_log</code>, puedes ejecutar (con privilegios de administrador):
                </p>
                <div className="p-2.5 rounded-md bg-[#090b10] border border-[#1b2234] font-mono text-[11px] text-amber-300 select-text">
                  SET GLOBAL slow_query_log = 'ON';<br />
                  SET GLOBAL log_output = 'TABLE';<br />
                  SET GLOBAL long_query_time = 1.0; -- Registra cualquier consulta que tarde &gt; 1s
                </div>
                <p className="text-neutral-400">
                  Mientras tanto, PyroStudio analiza automáticamente el <strong className="text-neutral-200">Performance Schema</strong> y los <strong className="text-neutral-200">Procesos Activos</strong> en tiempo real.
                </p>
              </div>
            </div>
          )}

          {/* Subtabs for Server Inspector */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#11141e] p-3 rounded-xl border border-[#1f2638]">
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setServerSubTab("digest")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  serverSubTab === "digest"
                    ? "bg-orange-600 text-white"
                    : "text-neutral-400 hover:text-white bg-[#0c0e14]"
                }`}
              >
                Performance Schema Digest ({serverReport?.performance_digest_entries.length || 0})
              </button>
              <button
                onClick={() => setServerSubTab("slow_log")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  serverSubTab === "slow_log"
                    ? "bg-orange-600 text-white"
                    : "text-neutral-400 hover:text-white bg-[#0c0e14]"
                }`}
              >
                mysql.slow_log ({serverReport?.slow_log_entries.length || 0})
              </button>
              <button
                onClick={() => setServerSubTab("processlist")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  serverSubTab === "processlist"
                    ? "bg-orange-600 text-white"
                    : "text-neutral-400 hover:text-white bg-[#0c0e14]"
                }`}
              >
                Procesos Activos ({serverReport?.running_queries.length || 0})
              </button>
            </div>

            <div className="flex items-center space-x-2">
              <div className="relative">
                <Search className="w-3 h-3 text-neutral-500 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="Filtrar SQL o usuario..."
                  value={serverFilter}
                  onChange={(e) => setServerFilter(e.target.value)}
                  className="pl-7 pr-3 py-1 text-xs bg-[#0c0e14] border border-[#202636] rounded-md text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-orange-500 transition-colors w-48"
                />
              </div>

              <button
                onClick={loadServerSlowQueries}
                disabled={isServerLoading}
                title="Refrescar registro"
                className="p-1.5 text-neutral-400 hover:text-white bg-[#0c0e14] hover:bg-[#1a2030] border border-[#202636] rounded-md transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-orange-400 ${isServerLoading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {isServerLoading && !serverReport ? (
            <div className="flex flex-col items-center justify-center p-12 text-neutral-400">
              <Loader2 className="w-8 h-8 animate-spin text-orange-500 mb-3" />
              <span className="text-xs">Consultando registro de slow queries del motor...</span>
            </div>
          ) : (
            <div className="rounded-xl bg-[#10131d] border border-[#1f2538] overflow-hidden shadow-xl">
              {/* SUBTAB 1: Performance Schema Statements Digest */}
              {serverSubTab === "digest" && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse font-mono">
                    <thead>
                      <tr className="bg-[#151926] text-neutral-400 font-semibold border-b border-[#212739] text-[11px]">
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
                    <tbody className="divide-y divide-[#1b2131] text-neutral-300">
                      {(!serverReport || serverReport.performance_digest_entries.length === 0) ? (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-neutral-500 italic">
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
                            <tr key={idx} className="hover:bg-[#161a28] transition-colors">
                              <td className="py-2.5 px-4 max-w-md">
                                <div className="font-semibold text-white truncate" title={entry.digest_text}>
                                  {entry.digest_text}
                                </div>
                                {entry.schema_name && (
                                  <div className="text-[10px] text-neutral-500 mt-0.5">
                                    BD: {entry.schema_name}
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-right text-neutral-300">
                                {entry.exec_count.toLocaleString()}
                              </td>
                              <td className="py-2.5 px-3 text-right text-orange-400 font-bold">
                                {entry.sum_timer_wait_sec.toFixed(4)}s
                              </td>
                              <td className="py-2.5 px-3 text-right text-amber-300">
                                {entry.avg_timer_wait_sec.toFixed(4)}s
                              </td>
                              <td className="py-2.5 px-3 text-right text-rose-400 font-bold">
                                {entry.max_timer_wait_sec.toFixed(4)}s
                              </td>
                              <td className="py-2.5 px-3 text-right text-neutral-400">
                                {entry.sum_rows_examined.toLocaleString()}
                              </td>
                              <td className="py-2.5 px-3 text-center">
                                {entry.sum_no_index_used > 0 ? (
                                  <span className="px-2 py-0.5 rounded bg-rose-950/60 text-rose-400 border border-rose-800/40 text-[10px]">
                                    {entry.sum_no_index_used}
                                  </span>
                                ) : (
                                  <span className="text-neutral-600">0</span>
                                )}
                              </td>
                              <td className="py-2.5 px-4 text-center">
                                <div className="flex items-center justify-center space-x-1.5">
                                  <button
                                    onClick={() => handleSelectQueryForExplain(entry.digest_text)}
                                    title="Analizar plan de ejecución con EXPLAIN"
                                    className="flex items-center space-x-1 px-2 py-1 rounded bg-orange-600/20 hover:bg-orange-600/40 text-orange-300 text-[10px] font-bold border border-orange-500/30 transition-colors"
                                  >
                                    <Activity className="w-3 h-3" />
                                    <span>EXPLAIN</span>
                                  </button>
                                  <button
                                    onClick={() => handleCopySql(entry.digest_text, `digest-${idx}`)}
                                    title="Copiar SQL"
                                    className="p-1 rounded bg-[#161a28] hover:bg-[#20273a] text-neutral-400 hover:text-white border border-[#242c40] transition-colors"
                                  >
                                    {copiedId === `digest-${idx}` ? (
                                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
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
                      <tr className="bg-[#151926] text-neutral-400 font-semibold border-b border-[#212739] text-[11px]">
                        <th className="py-2.5 px-3">Fecha y Hora</th>
                        <th className="py-2.5 px-3">Usuario @ Host</th>
                        <th className="py-2.5 px-3 text-right">Tiempo Ejec.</th>
                        <th className="py-2.5 px-3 text-right">Tiempo Lock</th>
                        <th className="py-2.5 px-3 text-right">Filas Exam.</th>
                        <th className="py-2.5 px-4">Consulta SQL</th>
                        <th className="py-2.5 px-3 text-center">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1b2131] text-neutral-300">
                      {(!serverReport || serverReport.slow_log_entries.length === 0) ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-neutral-500 italic">
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
                            <tr key={idx} className="hover:bg-[#161a28] transition-colors">
                              <td className="py-2.5 px-3 text-neutral-400 text-[11px] whitespace-nowrap">
                                {entry.start_time}
                              </td>
                              <td className="py-2.5 px-3 text-neutral-300 text-[11px] truncate max-w-xs" title={entry.user_host}>
                                {entry.user_host}
                              </td>
                              <td className="py-2.5 px-3 text-right font-bold text-rose-400">
                                {entry.query_time_seconds.toFixed(2)}s
                              </td>
                              <td className="py-2.5 px-3 text-right text-amber-300">
                                {entry.lock_time_seconds.toFixed(2)}s
                              </td>
                              <td className="py-2.5 px-3 text-right text-neutral-300">
                                {entry.rows_examined.toLocaleString()}
                              </td>
                              <td className="py-2.5 px-4 max-w-sm">
                                <div className="truncate font-mono text-white text-[11px]" title={entry.sql_text}>
                                  {entry.sql_text}
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-center">
                                <div className="flex items-center justify-center space-x-1.5">
                                  <button
                                    onClick={() => handleSelectQueryForExplain(entry.sql_text)}
                                    title="Analizar en EXPLAIN"
                                    className="flex items-center space-x-1 px-2 py-1 rounded bg-orange-600/20 hover:bg-orange-600/40 text-orange-300 text-[10px] font-bold border border-orange-500/30 transition-colors"
                                  >
                                    <Activity className="w-3 h-3" />
                                    <span>EXPLAIN</span>
                                  </button>
                                  <button
                                    onClick={() => handleCopySql(entry.sql_text, `slow-${idx}`)}
                                    title="Copiar SQL"
                                    className="p-1 rounded bg-[#161a28] hover:bg-[#20273a] text-neutral-400 hover:text-white border border-[#242c40] transition-colors"
                                  >
                                    {copiedId === `slow-${idx}` ? (
                                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
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
                      <tr className="bg-[#151926] text-neutral-400 font-semibold border-b border-[#212739] text-[11px]">
                        <th className="py-2.5 px-3">ID Proceso</th>
                        <th className="py-2.5 px-3">Usuario @ Host</th>
                        <th className="py-2.5 px-3">Base de Datos</th>
                        <th className="py-2.5 px-3 text-right">Tiempo Corriendo</th>
                        <th className="py-2.5 px-3">Estado</th>
                        <th className="py-2.5 px-4">Consulta SQL Activa</th>
                        <th className="py-2.5 px-3 text-center">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1b2131] text-neutral-300">
                      {(!serverReport || serverReport.running_queries.length === 0) ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-neutral-500 italic">
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
                            <tr key={proc.id} className="hover:bg-[#161a28] transition-colors">
                              <td className="py-2.5 px-3 text-neutral-400 font-bold">
                                {proc.id}
                              </td>
                              <td className="py-2.5 px-3 text-neutral-300 text-[11px]">
                                {proc.user}@{proc.host}
                              </td>
                              <td className="py-2.5 px-3 text-sky-400 text-[11px]">
                                {proc.db || "—"}
                              </td>
                              <td className="py-2.5 px-3 text-right font-bold text-amber-400">
                                {proc.time_seconds}s
                              </td>
                              <td className="py-2.5 px-3 text-neutral-400 text-[10px]">
                                {proc.state || "Executing"}
                              </td>
                              <td className="py-2.5 px-4 max-w-sm">
                                <div className="truncate font-mono text-white text-[11px]" title={proc.info}>
                                  {proc.info}
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-center">
                                <div className="flex items-center justify-center space-x-1.5">
                                  <button
                                    onClick={() => handleSelectQueryForExplain(proc.info)}
                                    title="Analizar en EXPLAIN"
                                    className="flex items-center space-x-1 px-2 py-1 rounded bg-orange-600/20 hover:bg-orange-600/40 text-orange-300 text-[10px] font-bold border border-orange-500/30 transition-colors"
                                  >
                                    <Activity className="w-3 h-3" />
                                    <span>EXPLAIN</span>
                                  </button>
                                  <button
                                    onClick={() => handleCopySql(proc.info, `proc-${proc.id}`)}
                                    title="Copiar SQL"
                                    className="p-1 rounded bg-[#161a28] hover:bg-[#20273a] text-neutral-400 hover:text-white border border-[#242c40] transition-colors"
                                  >
                                    {copiedId === `proc-${proc.id}` ? (
                                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
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
            </div>
          )}
        </div>
      )}
    </div>
  );
};
