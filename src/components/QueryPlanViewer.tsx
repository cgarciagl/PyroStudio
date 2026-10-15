import React, { useState, useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  FileJson,
  GitFork,
  Layers,
  Sparkles,
  Table as TableIcon,
  Zap,
  Gauge,
  TrendingUp,
  AlertCircle,
  Play,
  Loader2,
} from "lucide-react";
import type {
  AnalyzeExecutionResult,
  ExplainNode,
  ExplainRow,
} from "../types/database";
import { buildExplainTree } from "../utils/explainTreeParser";
import { ExplainPlanTree } from "./ExplainPlanTree";
import { ExplainJsonViewer } from "./ExplainJsonViewer";

interface QueryPlanViewerProps {
  planRows?: ExplainRow[];
  baselinePlanRows?: ExplainRow[];
  rawResult?: {
    columns: string[];
    rows: any[][];
    execution_time_ms: number;
  };
  jsonPlan?: any;
  treePlan?: string;
  visualNodes?: ExplainNode[];
  bottlenecks?: string[];
  potentialOptimizations?: string[];
  querySql?: string;
  initialTab?: "table" | "tree" | "json" | "analyze";
  analyzeTelemetry?: AnalyzeExecutionResult | null;
  onRunAnalyze?: () => void;
  isAnalyzing?: boolean;
}

export const QueryPlanViewer: React.FC<QueryPlanViewerProps> = ({
  planRows = [],
  baselinePlanRows,
  rawResult,
  jsonPlan,
  treePlan,
  visualNodes,
  bottlenecks,
  potentialOptimizations,
  querySql,
  initialTab = "table",
  analyzeTelemetry,
  onRunAnalyze,
  isAnalyzing = false,
}) => {
  const [activeView, setActiveView] = useState<"table" | "tree" | "json" | "analyze">(
    analyzeTelemetry ? "analyze" : initialTab
  );

  // If planRows is empty but rawResult is provided, normalize columns
  const rows: ExplainRow[] = useMemo(() => {
    if (planRows && planRows.length > 0) return planRows;
    if (!rawResult || !rawResult.columns) return [];

    const cols = rawResult.columns.map((c) => c.toLowerCase());
    const idIdx = cols.indexOf("id");
    const selectTypeIdx = cols.indexOf("select_type");
    const tableIdx = cols.indexOf("table");
    const typeIdx = cols.indexOf("type");
    const possibleKeysIdx = cols.indexOf("possible_keys");
    const keyIdx = cols.indexOf("key");
    const keyLenIdx = cols.indexOf("key_len");
    const refIdx = cols.indexOf("ref");
    const rowsIdx = cols.indexOf("rows");
    const filteredIdx = cols.indexOf("filtered");
    const extraIdx = cols.indexOf("extra");

    return rawResult.rows.map((r) => ({
      id: idIdx !== -1 ? r[idIdx] : 1,
      select_type: selectTypeIdx !== -1 ? String(r[selectTypeIdx] || "") : "SIMPLE",
      table: tableIdx !== -1 ? String(r[tableIdx] || "") : "—",
      type: typeIdx !== -1 ? String(r[typeIdx] || "ALL").toUpperCase() : "ALL",
      possible_keys: possibleKeysIdx !== -1 && r[possibleKeysIdx] ? String(r[possibleKeysIdx]) : undefined,
      key: keyIdx !== -1 && r[keyIdx] ? String(r[keyIdx]) : undefined,
      key_len: keyLenIdx !== -1 && r[keyLenIdx] ? String(r[keyLenIdx]) : undefined,
      ref: refIdx !== -1 && r[refIdx] ? String(r[refIdx]) : undefined,
      rows: rowsIdx !== -1 ? Number(r[rowsIdx]) || 0 : 0,
      filtered: filteredIdx !== -1 && r[filteredIdx] !== null ? Number(r[filteredIdx]) : undefined,
      extra: extraIdx !== -1 && r[extraIdx] ? String(r[extraIdx]) : undefined,
    }));
  }, [planRows, rawResult]);

  const totalEstimatedRows = rows.reduce((acc, r) => acc + (r.rows || 0), 0);
  const hasFullTableScan = rows.some((r) => r.type === "ALL");
  const usesIndexes = rows.some((r) => r.key && r.key !== "NULL");
  const hasFilesort = rows.some((r) => r.extra && r.extra.includes("Using filesort"));
  const hasTemporary = rows.some((r) => r.extra && r.extra.includes("Using temporary"));

  // Build hierarchical tree
  const treeRoot = useMemo(() => {
    return buildExplainTree({
      jsonPlan,
      visualNodes,
      executionPlan: rows,
    });
  }, [jsonPlan, visualNodes, rows]);

  // Fallback JSON payload if native jsonPlan is absent
  const effectiveJsonPlan = useMemo(() => {
    if (jsonPlan) return jsonPlan;
    return {
      query_block: {
        select_id: 1,
        table_count: rows.length,
        execution_plan: rows,
        notes: "Plan generado a partir de EXPLAIN tabular estructurado.",
      },
    };
  }, [jsonPlan, rows]);

  const getScanBadge = (type: string) => {
    switch (type) {
      case "SYSTEM":
      case "CONST":
        return {
          bg: "bg-purple-950/40 border-purple-800/60 text-purple-300",
          label: "CONST (Máxima Velocidad)",
          icon: Zap,
        };
      case "EQ_REF":
        return {
          bg: "bg-emerald-950/40 border-emerald-800/60 text-emerald-300",
          label: "EQ_REF (Índice Único)",
          icon: CheckCircle2,
        };
      case "REF":
        return {
          bg: "bg-emerald-950/30 border-emerald-700/50 text-emerald-400",
          label: "REF (Búsqueda por Índice)",
          icon: CheckCircle2,
        };
      case "RANGE":
        return {
          bg: "bg-sky-950/40 border-sky-800/60 text-sky-300",
          label: "RANGE (Rango de Índice)",
          icon: Activity,
        };
      case "INDEX":
        return {
          bg: "bg-amber-950/40 border-amber-800/60 text-amber-300",
          label: "INDEX (Escaneo de Todo el Índice)",
          icon: AlertTriangle,
        };
      case "ALL":
      default:
        return {
          bg: "bg-rose-950/40 border-rose-800/60 text-rose-300",
          label: "ALL (Full Table Scan - Lento)",
          icon: AlertTriangle,
        };
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0a0c10] overflow-hidden select-none">
      {/* Top Bar with Metrics & View Selector */}
      <div className="p-4 bg-[#0d1017] border-b border-[#1b2131] space-y-3 shrink-0">
        {/* Metrics Summary Row */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
          <div className="p-2.5 rounded-lg bg-[#11141c] border border-[#1e2333] flex items-center space-x-2.5">
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${
                hasFullTableScan
                  ? "bg-rose-950/40 border-rose-800/50 text-rose-400"
                  : "bg-emerald-950/40 border-emerald-800/50 text-emerald-400"
              }`}
            >
              {hasFullTableScan ? (
                <AlertTriangle className="w-4 h-4" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
            </div>
            <div className="truncate">
              <span className="text-[10px] text-neutral-500 uppercase tracking-wider block font-semibold">
                Tipo de Acceso
              </span>
              <span className="text-xs font-bold text-white font-mono">
                {hasFullTableScan ? "Full Table Scan (ALL)" : "Índice Optimizado"}
              </span>
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-[#11141c] border border-[#1e2333] flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-orange-600/10 border border-orange-500/20 flex items-center justify-center text-orange-400 shrink-0">
              <Layers className="w-4 h-4" />
            </div>
            <div className="truncate">
              <span className="text-[10px] text-neutral-500 uppercase tracking-wider block font-semibold">
                Filas Estimadas
              </span>
              <span className="text-xs font-bold text-white font-mono">
                ~{totalEstimatedRows.toLocaleString()} filas
              </span>
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-[#11141c] border border-[#1e2333] flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-600/10 border border-sky-500/20 flex items-center justify-center text-sky-400 shrink-0">
              <Database className="w-4 h-4" />
            </div>
            <div className="truncate">
              <span className="text-[10px] text-neutral-500 uppercase tracking-wider block font-semibold">
                Tablas en Plan
              </span>
              <span className="text-xs font-bold text-white font-mono">
                {rows.length} paso(s) de ejecución
              </span>
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-[#11141c] border border-[#1e2333] flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-600/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
              <Zap className="w-4 h-4" />
            </div>
            <div className="truncate">
              <span className="text-[10px] text-neutral-500 uppercase tracking-wider block font-semibold">
                Uso de Índices
              </span>
              <span className="text-xs font-bold text-white font-mono">
                {usesIndexes ? "Activo (Llave asignada)" : "Sin índice utilizado"}
              </span>
            </div>
          </div>
        </div>

        {/* View Mode Segmented Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex items-center bg-[#141824] p-1 rounded-lg border border-[#232a3c]">
            <button
              onClick={() => setActiveView("table")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center space-x-1.5 transition-all ${
                activeView === "table"
                  ? "bg-orange-600 text-white shadow"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              <TableIcon className="w-3.5 h-3.5" />
              <span>Tabla Relacional</span>
            </button>

            <button
              onClick={() => setActiveView("tree")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center space-x-1.5 transition-all ${
                activeView === "tree"
                  ? "bg-orange-600 text-white shadow"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              <GitFork className="w-3.5 h-3.5" />
              <span>Árbol Jerárquico</span>
            </button>

            <button
              onClick={() => setActiveView("json")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center space-x-1.5 transition-all ${
                activeView === "json"
                  ? "bg-orange-600 text-white shadow"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              <FileJson className="w-3.5 h-3.5" />
              <span>Formato JSON</span>
            </button>

            <button
              onClick={() => setActiveView("analyze")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center space-x-1.5 transition-all ${
                activeView === "analyze"
                  ? "bg-purple-600 text-white shadow"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              <Gauge className="w-3.5 h-3.5 text-purple-300" />
              <span>Telemetría ANALYZE</span>
              {analyzeTelemetry?.discrepancies && analyzeTelemetry.discrepancies.length > 0 && (
                <span className="ml-1 px-1.5 py-0.2 text-[9px] rounded-full bg-rose-500 text-white font-bold">
                  {analyzeTelemetry.discrepancies.length}
                </span>
              )}
            </button>
          </div>

          {/* Quick Badges Alert */}
          <div className="flex items-center space-x-2">
            {hasFullTableScan && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono bg-rose-600/25 border border-rose-500/50 text-rose-300">
                ⚠️ Full Table Scan
              </span>
            )}
            {hasFilesort && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono bg-amber-950/60 border border-amber-800/60 text-amber-300">
                ⚡ Filesort
              </span>
            )}
            {hasTemporary && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono bg-purple-950/60 border border-purple-800/60 text-purple-300">
                📦 Temporary Table
              </span>
            )}
            {rawResult && (
              <span className="text-[11px] font-mono text-neutral-500">
                Tiempo: {rawResult.execution_time_ms} ms
              </span>
            )}
          </div>
        </div>
      </div>

      {/* View Content Area */}
      <div className="flex-1 overflow-auto">
        {/* 1. TREE VIEW */}
        {activeView === "tree" && (
          <ExplainPlanTree rootNode={treeRoot} treePlanText={treePlan} />
        )}

        {/* 2. JSON VIEW */}
        {activeView === "json" && (
          <ExplainJsonViewer jsonPlan={effectiveJsonPlan} querySql={querySql} />
        )}

        {/* 3. TABLE VIEW */}
        {activeView === "table" && (
          <div className="p-4 space-y-4">
            {/* Optimization Diagnostic Banner */}
            <div className="p-3.5 rounded-xl bg-[#121520] border border-[#23293c] space-y-3">
              <div className="flex items-center space-x-2 text-xs font-semibold text-orange-400">
                <Sparkles className="w-4 h-4" />
                <span>Diagnóstico del Optimizador MariaDB / MySQL</span>
              </div>

              <div className="space-y-2 text-xs">
                {hasFullTableScan && (
                  <div className="p-2.5 rounded-lg bg-rose-950/30 border border-rose-800/50 flex items-start space-x-2.5 text-rose-300">
                    <span className="text-base leading-none">⚠️</span>
                    <div>
                      <strong className="text-rose-200">Alerta: Full Table Scan (ALL).</strong>
                      <p className="text-[11px] mt-0.5 text-rose-300/90">
                        La consulta examina todas las filas de la tabla sin aprovechar índices. Si la tabla crece causará bloqueos y latencias críticas. Crea un índice sobre las columnas de <code className="px-1 py-0.2 rounded bg-rose-900/40 font-mono">WHERE</code> o <code className="px-1 py-0.2 rounded bg-rose-900/40 font-mono">JOIN</code>.
                      </p>
                    </div>
                  </div>
                )}

                {hasFilesort && (
                  <div className="p-2.5 rounded-lg bg-amber-950/20 border border-amber-800/40 flex items-start space-x-2.5 text-amber-300">
                    <span className="text-base leading-none">⚡</span>
                    <div>
                      <strong className="text-amber-200">Alerta de Rendimiento: Using filesort.</strong>
                      <p className="text-[11px] mt-0.5 text-amber-300/90">
                        El motor debe ordenar los registros en un búfer temporal de memoria o disco al no coincidir el orden con ningún índice. Considera agregar un índice compuesto que incluya las columnas del <code className="px-1 py-0.2 rounded bg-amber-900/40 font-mono">ORDER BY</code>.
                      </p>
                    </div>
                  </div>
                )}

                {hasTemporary && (
                  <div className="p-2.5 rounded-lg bg-purple-950/20 border border-purple-800/40 flex items-start space-x-2.5 text-purple-300">
                    <span className="text-base leading-none">📦</span>
                    <div>
                      <strong className="text-purple-200">Alerta de Memoria: Using temporary.</strong>
                      <p className="text-[11px] mt-0.5 text-purple-300/90">
                        Se crea una tabla temporal en disco/RAM para resolver la consulta (común en <code className="px-1 py-0.2 rounded bg-purple-900/40 font-mono">GROUP BY</code> o <code className="px-1 py-0.2 rounded bg-purple-900/40 font-mono">DISTINCT</code> sin índice de cobertura).
                      </p>
                    </div>
                  </div>
                )}

                {!hasFullTableScan && !hasFilesort && !hasTemporary && (
                  <div className="flex items-start space-x-2 text-emerald-300">
                    <span className="font-bold">•</span>
                    <span>
                      <strong className="text-emerald-200">Excelente:</strong> La consulta utiliza índices eficientes y no genera operaciones pesadas de ordenamiento o tablas temporales no indexadas.
                    </span>
                  </div>
                )}

                {/* Additional Optimizer Bottlenecks / Optimizations if passed */}
                {bottlenecks && bottlenecks.length > 0 && (
                  <div className="pt-2 border-t border-[#1e2333] space-y-1">
                    <span className="font-semibold text-rose-300 block text-[11px]">Cuellos de botella detectados:</span>
                    <ul className="list-disc list-inside space-y-0.5 text-[11px] text-rose-300/80">
                      {bottlenecks.map((b, idx) => (
                        <li key={idx}>{b}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {potentialOptimizations && potentialOptimizations.length > 0 && (
                  <div className="pt-2 border-t border-[#1e2333] space-y-1">
                    <span className="font-semibold text-sky-300 block text-[11px]">Sugerencias de optimización:</span>
                    <ul className="list-disc list-inside space-y-0.5 text-[11px] text-sky-200/80">
                      {potentialOptimizations.map((opt, idx) => (
                        <li key={idx}>{opt}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {baselinePlanRows && baselinePlanRows.length > 0 && (
                  <div className="pt-1.5 border-t border-[#1e2333] text-[10px] text-neutral-400">
                    Comparando con línea base: {baselinePlanRows.length} pasos previos guardados.
                  </div>
                )}
              </div>
            </div>

            {/* Structured Table */}
            <div className="bg-[#11141c] border border-[#1f2535] rounded-xl overflow-hidden shadow-xl">
              <div className="px-4 py-2.5 bg-[#141822] border-b border-[#212739] flex items-center justify-between text-xs font-semibold text-neutral-300">
                <div className="flex items-center space-x-2">
                  <Activity className="w-4 h-4 text-orange-400" />
                  <span>Detalle de Pasos del Plan (EXPLAIN Tabular)</span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#161a26] text-neutral-400 font-semibold border-b border-[#212739] font-mono text-[11px]">
                      <th className="py-2.5 px-3 w-10 text-center">ID</th>
                      <th className="py-2.5 px-3">Select Type</th>
                      <th className="py-2.5 px-3">Tabla</th>
                      <th className="py-2.5 px-3">Tipo Acceso</th>
                      <th className="py-2.5 px-3">Posibles Llaves</th>
                      <th className="py-2.5 px-3">Llave Utilizada</th>
                      <th className="py-2.5 px-3">Long. Llave</th>
                      <th className="py-2.5 px-3">Ref</th>
                      <th className="py-2.5 px-3 text-right">Filas Estim.</th>
                      <th className="py-2.5 px-3 text-right">Filtrado %</th>
                      <th className="py-2.5 px-3">Extra</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1c2232] font-mono text-xs">
                    {rows.map((row, idx) => {
                      const badge = getScanBadge(row.type);
                      const BadgeIcon = badge.icon;

                      return (
                        <tr key={idx} className="hover:bg-[#151926] transition-colors">
                          <td className="py-2.5 px-3 text-center text-neutral-400">
                            {row.id}
                          </td>
                          <td className="py-2.5 px-3 text-neutral-300">
                            {row.select_type}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-white">
                            {row.table}
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-bold border ${badge.bg}`}
                            >
                              <BadgeIcon className="w-3 h-3 shrink-0" />
                              <span>{row.type}</span>
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-neutral-400 text-[11px]">
                            {row.possible_keys || <span className="text-neutral-600">NULL</span>}
                          </td>
                          <td className="py-2.5 px-3 text-orange-300 font-semibold text-[11px]">
                            {row.key || <span className="text-neutral-600 font-normal">NULL</span>}
                          </td>
                          <td className="py-2.5 px-3 text-neutral-400 text-[11px]">
                            {row.key_len || "—"}
                          </td>
                          <td className="py-2.5 px-3 text-neutral-400 text-[11px]">
                            {row.ref || "—"}
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold text-white">
                            {row.rows.toLocaleString()}
                          </td>
                          <td className="py-2.5 px-3 text-right text-neutral-300">
                            {row.filtered !== undefined ? `${row.filtered}%` : "—"}
                          </td>
                          <td className="py-2.5 px-3 text-[11px] text-neutral-400">
                            {row.extra || "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 4. ANALYZE VIEW */}
        {activeView === "analyze" && (
          <div className="p-4 space-y-4">
            {!analyzeTelemetry ? (
              <div className="p-6 rounded-xl bg-[#121522] border border-[#23293e] text-center space-y-3 max-w-xl mx-auto my-8">
                <div className="w-12 h-12 rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-400 mx-auto">
                  <Gauge className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-bold text-white">Telemetría de Ejecución Real (ANALYZE FORMAT=JSON)</h3>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  A diferencia de <code className="text-orange-400 font-mono">EXPLAIN</code> que solo calcula estimaciones teóricas, <code className="text-purple-400 font-mono">ANALYZE</code> ejecuta la consulta en el motor MariaDB y recolecta métricas reales: número exacto de filas examinadas (<code className="text-white font-mono">r_rows</code>), porcentaje filtrado (<code className="text-white font-mono">r_filtered</code>), iteraciones de bucles (<code className="text-white font-mono">r_loops</code>) y tiempos de lectura (<code className="text-white font-mono">r_table_time_ms</code>).
                </p>
                <div className="p-3 rounded-lg bg-amber-950/20 border border-amber-800/40 text-[11px] text-amber-300 text-left flex items-start space-x-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    <strong>Advertencia de Seguridad:</strong> Esta operación ejecuta físicamente la consulta en el servidor. Para consultas de modificación (<code className="font-mono">UPDATE</code>, <code className="font-mono">DELETE</code>), los datos serán alterados.
                  </span>
                </div>
                {onRunAnalyze && (
                  <button
                    onClick={onRunAnalyze}
                    disabled={isAnalyzing}
                    className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold flex items-center space-x-2 mx-auto shadow-lg shadow-purple-600/20 transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Ejecutando y Recolectando Telemetría...</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4" />
                        <span>Ejecutar ANALYZE FORMAT=JSON</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            ) : (
              <>
                {/* Metric Cards Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div className="p-3 rounded-xl bg-[#11141c] border border-[#1f2535]">
                    <span className="text-[10px] text-neutral-500 uppercase tracking-wider block font-semibold">
                      Tiempo Total de Ejecución
                    </span>
                    <span className="text-sm font-bold text-purple-400 font-mono">
                      {analyzeTelemetry.total_execution_time_ms.toFixed(2)} ms
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-[#11141c] border border-[#1f2535]">
                    <span className="text-[10px] text-neutral-500 uppercase tracking-wider block font-semibold">
                      Filas Reales vs Estimadas
                    </span>
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-bold text-white font-mono">
                        {analyzeTelemetry.actual_total_rows.toLocaleString()}
                      </span>
                      <span className="text-[11px] text-neutral-500 font-mono">
                        (est. {analyzeTelemetry.estimated_total_rows.toLocaleString()})
                      </span>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-[#11141c] border border-[#1f2535]">
                    <span className="text-[10px] text-neutral-500 uppercase tracking-wider block font-semibold">
                      Discrepancias del Optimizador
                    </span>
                    <span
                      className={`text-sm font-bold font-mono ${
                        analyzeTelemetry.discrepancies.length > 0
                          ? "text-rose-400"
                          : "text-emerald-400"
                      }`}
                    >
                      {analyzeTelemetry.discrepancies.length > 0
                        ? `${analyzeTelemetry.discrepancies.length} detectada(s)`
                        : "Óptimo (Coincidencia fiel)"}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-[#11141c] border border-[#1f2535]">
                    <span className="text-[10px] text-neutral-500 uppercase tracking-wider block font-semibold">
                      Filas Afectadas
                    </span>
                    <span className="text-sm font-bold text-neutral-300 font-mono">
                      {analyzeTelemetry.rows_affected.toLocaleString()}
                    </span>
                  </div>
                </div>

                {/* Discrepancies Alerts */}
                {analyzeTelemetry.discrepancies.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-rose-300 flex items-center space-x-1.5">
                      <AlertTriangle className="w-4 h-4" />
                      <span>Discrepancias Significativas entre Estimaciones y Telemetría Real</span>
                    </h4>
                    <div className="space-y-2">
                      {analyzeTelemetry.discrepancies.map((disc, idx) => {
                        const isCrit = disc.severity === "Critical";
                        return (
                          <div
                            key={idx}
                            className={`p-3 rounded-xl border flex items-start space-x-3 ${
                              isCrit
                                ? "bg-rose-950/25 border-rose-800/40 text-rose-200"
                                : "bg-amber-950/20 border-amber-800/40 text-amber-200"
                            }`}
                          >
                            <AlertCircle
                              className={`w-4 h-4 shrink-0 mt-0.5 ${
                                isCrit ? "text-rose-400" : "text-amber-400"
                              }`}
                            />
                            <div className="space-y-1 text-xs">
                              <div className="flex items-center space-x-2">
                                <span className="font-bold text-white font-mono">{disc.target}</span>
                                <span className="text-[10px] px-1.5 py-0.2 rounded font-bold uppercase bg-black/40 border border-current">
                                  {disc.metric}
                                </span>
                                <span className="text-[10px] text-neutral-400 font-mono">
                                  Ratio: {disc.ratio.toFixed(1)}x
                                </span>
                              </div>
                              <p className="text-neutral-300">{disc.description}</p>
                              <div className="text-[11px] text-sky-300 bg-sky-950/40 px-2 py-1 rounded border border-sky-800/30">
                                <strong>Acción Recomendada:</strong> {disc.recommendation}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Telemetry Comparison Table */}
                <div className="bg-[#11141c] border border-[#1f2535] rounded-xl overflow-hidden shadow-xl">
                  <div className="px-4 py-2.5 bg-[#141822] border-b border-[#212739] flex items-center justify-between text-xs font-semibold text-neutral-300">
                    <div className="flex items-center space-x-2">
                      <TrendingUp className="w-4 h-4 text-purple-400" />
                      <span>Comparación Nodo a Nodo: Estimado vs Telemetría Real</span>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse font-mono">
                      <thead>
                        <tr className="bg-[#161a26] text-neutral-400 font-semibold border-b border-[#212739] text-[11px]">
                          <th className="py-2.5 px-3">Tabla</th>
                          <th className="py-2.5 px-3">Tipo Acceso</th>
                          <th className="py-2.5 px-3 text-right">Filas Estim.</th>
                          <th className="py-2.5 px-3 text-right text-purple-300">Filas Reales (r_rows)</th>
                          <th className="py-2.5 px-3 text-center">Desviación (Ratio)</th>
                          <th className="py-2.5 px-3 text-right">Filtrado Estim.</th>
                          <th className="py-2.5 px-3 text-right text-purple-300">Filtrado Real (r_filtered)</th>
                          <th className="py-2.5 px-3 text-right">Bucles (r_loops)</th>
                          <th className="py-2.5 px-3 text-right text-purple-300">Tiempo Lectura (ms)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1c2232] text-xs">
                        {analyzeTelemetry.node_telemetry.map((node, idx) => {
                          const ratio = node.discrepancy_ratio;
                          const hasSevereDiscrepancy = ratio !== undefined && ratio >= 5.0;
                          const hasModerateDiscrepancy = ratio !== undefined && ratio >= 2.0 && ratio < 5.0;

                          return (
                            <tr key={idx} className="hover:bg-[#151926] transition-colors">
                              <td className="py-2.5 px-3 font-bold text-white">{node.table_name}</td>
                              <td className="py-2.5 px-3 text-neutral-300">{node.access_type}</td>
                              <td className="py-2.5 px-3 text-right text-neutral-400">
                                {node.estimated_rows.toLocaleString()}
                              </td>
                              <td className="py-2.5 px-3 text-right font-bold text-purple-300">
                                {node.actual_rows !== undefined ? node.actual_rows.toLocaleString() : "—"}
                              </td>
                              <td className="py-2.5 px-3 text-center">
                                {ratio !== undefined ? (
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                      hasSevereDiscrepancy
                                        ? "bg-rose-950/60 text-rose-300 border border-rose-800/60"
                                        : hasModerateDiscrepancy
                                        ? "bg-amber-950/60 text-amber-300 border border-amber-800/60"
                                        : "bg-emerald-950/40 text-emerald-300 border border-emerald-800/40"
                                    }`}
                                  >
                                    {ratio.toFixed(1)}x
                                  </span>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-right text-neutral-400">
                                {node.estimated_filtered !== undefined ? `${node.estimated_filtered}%` : "—"}
                              </td>
                              <td className="py-2.5 px-3 text-right text-purple-300 font-semibold">
                                {node.actual_filtered !== undefined ? `${node.actual_filtered.toFixed(1)}%` : "—"}
                              </td>
                              <td className="py-2.5 px-3 text-right text-neutral-300">
                                {node.loops !== undefined ? node.loops.toLocaleString() : 1}
                              </td>
                              <td className="py-2.5 px-3 text-right text-purple-400 font-semibold">
                                {node.read_time_ms !== undefined ? `${node.read_time_ms.toFixed(2)} ms` : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
