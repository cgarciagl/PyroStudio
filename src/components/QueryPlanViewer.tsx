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
} from "lucide-react";
import type {
  ExplainNode,
  ExplainRow,
} from "../types/database";
import { buildExplainTree, type SqliteExplainRow } from "../utils/explainTreeParser";
import { ExplainPlanTree } from "./ExplainPlanTree";
import { ExplainJsonViewer } from "./ExplainJsonViewer";
import { useIsLightTheme } from "../stores/preferenceStore";

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
  initialTab?: "table" | "tree" | "json";
  analyzeTelemetry?: any;
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
}) => {
  const isLight = useIsLightTheme();
  const [activeView, setActiveView] = useState<"table" | "tree" | "json">(
    initialTab === "table" || initialTab === "tree" || initialTab === "json"
      ? initialTab
      : "table"
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

  const isSqliteExplain = useMemo(() => {
    if (!rawResult || !rawResult.columns) return false;
    const cols = rawResult.columns.map((c) => c.toLowerCase());
    return cols.includes("id") && cols.includes("parent") && cols.includes("detail");
  }, [rawResult]);

  const sqliteRows = useMemo<SqliteExplainRow[]>(() => {
    if (!isSqliteExplain || !rawResult) return [];
    const cols = rawResult.columns.map((c) => c.toLowerCase());
    const idIdx = cols.indexOf("id");
    const parentIdx = cols.indexOf("parent");
    const detailIdx = cols.indexOf("detail");
    return rawResult.rows.map((r) => ({
      id: Number(r[idIdx]) || 0,
      parent: Number(r[parentIdx]) || 0,
      detail: String(r[detailIdx] || ""),
    }));
  }, [isSqliteExplain, rawResult]);

  // Build hierarchical tree
  const treeRoot = useMemo(() => {
    return buildExplainTree({
      jsonPlan,
      visualNodes,
      executionPlan: rows,
      sqliteRows: isSqliteExplain ? sqliteRows : undefined,
    });
  }, [jsonPlan, visualNodes, rows, isSqliteExplain, sqliteRows]);

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
          bg: isLight
            ? "bg-purple-100 border-purple-200 text-purple-700"
            : "bg-purple-950/40 border-purple-800/60 text-purple-300",
          label: "CONST (Máxima Velocidad)",
          icon: Zap,
        };
      case "EQ_REF":
        return {
          bg: isLight
            ? "bg-emerald-100 border-emerald-200 text-emerald-700"
            : "bg-emerald-950/40 border-emerald-800/60 text-success",
          label: "EQ_REF (Índice Único)",
          icon: CheckCircle2,
        };
      case "REF":
        return {
          bg: isLight
            ? "bg-teal-100 border-teal-200 text-teal-700"
            : "bg-teal-950/40 border-teal-800/60 text-teal-300",
          label: "REF (Índice No Único)",
          icon: CheckCircle2,
        };
      case "RANGE":
        return {
          bg: isLight
            ? "bg-sky-100 border-sky-200 text-sky-700"
            : "bg-sky-950/40 border-sky-800/60 text-info",
          label: "RANGE (Rango Indexado)",
          icon: Activity,
        };
      case "INDEX":
        return {
          bg: isLight
            ? "bg-amber-100 border-amber-200 text-amber-700"
            : "bg-amber-950/40 border-amber-800/60 text-warning",
          label: "INDEX (Escaneo de Todo el Índice)",
          icon: Activity,
        };
      case "ALL":
      default:
        return {
          bg: isLight
            ? "bg-rose-100 border-rose-200 text-rose-700 font-bold"
            : "bg-rose-950/50 border-rose-800/70 text-danger font-bold",
          label: "ALL (Full Table Scan)",
          icon: AlertTriangle,
        };
    }
  };

  return (
    <div className={`flex-1 flex flex-col h-full overflow-hidden select-none bg-canvas text-fg`}>
      {/* Top Bar with Metrics & View Selector */}
      <div className={`p-4 border-b space-y-3 shrink-0 bg-surface border-line`}>
        {/* Metrics Summary Row */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
          <div className={`p-2.5 rounded-lg border flex items-center space-x-2.5 bg-surface border-line`}>
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${
                hasFullTableScan
                  ? isLight
                    ? "bg-rose-100 border-rose-200 text-rose-600"
                    : "bg-rose-950/40 border-rose-800/50 text-danger"
                  : isLight
                  ? "bg-emerald-100 border-emerald-200 text-emerald-600"
                  : "bg-emerald-950/40 border-emerald-800/50 text-success"
              }`}
            >
              {hasFullTableScan ? (
                <AlertTriangle className="w-4 h-4" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
            </div>
            <div className="truncate">
              <span className={`text-[11px] block font-medium text-fg-subtle`}>
                Tipo de Acceso
              </span>
              <span className={`text-xs font-bold font-mono text-fg`}>
                {hasFullTableScan ? "Full Table Scan (ALL)" : "Índice Optimizado"}
              </span>
            </div>
          </div>

          <div className={`p-2.5 rounded-lg border flex items-center space-x-2.5 bg-surface border-line`}>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border bg-accent-soft border-accent/20 text-accent-text`}>
              <Layers className="w-4 h-4" />
            </div>
            <div className="truncate">
              <span className={`text-[11px] block font-medium text-fg-subtle`}>
                Filas Estimadas
              </span>
              <span className={`text-xs font-bold font-mono text-fg`}>
                ~{totalEstimatedRows.toLocaleString()} filas
              </span>
            </div>
          </div>

          <div className={`p-2.5 rounded-lg border flex items-center space-x-2.5 bg-surface border-line`}>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border bg-sky-600/10 border-sky-500/20 text-info`}>
              <Database className="w-4 h-4" />
            </div>
            <div className="truncate">
              <span className={`text-[11px] block font-medium text-fg-subtle`}>
                Tablas en Plan
              </span>
              <span className={`text-xs font-bold font-mono text-fg`}>
                {rows.length} paso(s) de ejecución
              </span>
            </div>
          </div>

          <div className={`p-2.5 rounded-lg border flex items-center space-x-2.5 bg-surface border-line`}>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border bg-emerald-600/10 border-emerald-500/20 text-success`}>
              <Zap className="w-4 h-4" />
            </div>
            <div className="truncate">
              <span className={`text-[11px] block font-medium text-fg-subtle`}>
                Uso de Índices
              </span>
              <span className={`text-xs font-bold font-mono text-fg`}>
                {usesIndexes ? "Activo (Llave asignada)" : "Sin índice utilizado"}
              </span>
            </div>
          </div>
        </div>

        {/* View Mode Segmented Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className={`flex items-center p-1 rounded-lg border bg-raised border-line`}>
            <button
              onClick={() => setActiveView("table")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center space-x-1.5 transition-all ${
                activeView === "table"
                ? "bg-accent text-accent-fg shadow-xs"
                : "text-fg-muted hover:text-fg"
              }`}
            >
              <TableIcon className="w-3.5 h-3.5" />
              <span>Tabla Relacional</span>
            </button>

            <button
              onClick={() => setActiveView("tree")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center space-x-1.5 transition-all ${
                activeView === "tree"
                ? "bg-accent text-accent-fg shadow-xs"
                : "text-fg-muted hover:text-fg"
              }`}
            >
              <GitFork className="w-3.5 h-3.5" />
              <span>Árbol Jerárquico</span>
            </button>

            {!isSqliteExplain && (
              <button
                onClick={() => setActiveView("json")}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center space-x-1.5 transition-all ${
                  activeView === "json"
                  ? "bg-accent text-accent-fg shadow-xs"
                  : "text-fg-muted hover:text-fg"
                }`}
              >
                <FileJson className="w-3.5 h-3.5" />
                <span>Formato JSON</span>
              </button>
            )}
          </div>

          {/* Quick Badges Alert */}
          <div className="flex items-center space-x-2">
            {hasFullTableScan && (
              <span className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase font-mono border bg-rose-600/25 border-rose-500/50 text-danger`}>
                ⚠️ Full Table Scan
              </span>
            )}
            {hasFilesort && (
              <span className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase font-mono border ${
                isLight
                  ? "bg-amber-50 border-amber-200 text-amber-700"
                  : "bg-amber-950/60 border-amber-800/60 text-warning"
              }`}>
                ⚡ Filesort
              </span>
            )}
            {hasTemporary && (
              <span className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase font-mono border ${
                isLight
                  ? "bg-purple-50 border-purple-200 text-purple-700"
                  : "bg-purple-950/60 border-purple-800/60 text-purple-300"
              }`}>
                📦 Temporary Table
              </span>
            )}
            {rawResult && (
              <span className={`text-[11px] font-mono text-fg-subtle`}>
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
        {activeView === "table" && isSqliteExplain && rawResult && (
          <div className="p-4 space-y-4">
            <div className={`border rounded-xl overflow-hidden shadow-sm bg-surface border-line`}>
              <div className={`px-4 py-2.5 border-b flex items-center justify-between text-xs font-semibold bg-raised border-line text-fg`}>
                <div className="flex items-center space-x-2">
                  <Activity className="w-4 h-4 text-accent-text" />
                  <span>Detalle de Pasos SQLite (EXPLAIN QUERY PLAN)</span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className={`font-semibold border-b font-mono text-[11px] bg-raised text-fg-muted border-line`}>
                      <th className="py-2.5 px-3 w-16 text-center">ID</th>
                      <th className="py-2.5 px-3 w-16 text-center">Parent</th>
                      <th className="py-2.5 px-3">Detail</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y text-xs divide-line`}>
                    {sqliteRows.map((sr, idx) => (
                      <tr key={idx} className="transition-colors font-mono hover:bg-hover">
                        <td className="py-2.5 px-3 text-center text-fg-subtle">{sr.id}</td>
                        <td className="py-2.5 px-3 text-center text-fg-subtle">{sr.parent}</td>
                        <td className="py-2.5 px-3 text-fg">{sr.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 3. TABLE VIEW */}
        {activeView === "table" && !isSqliteExplain && (
          <div className="p-4 space-y-4">
            {/* Optimization Diagnostic Banner */}
            <div className={`p-3.5 rounded-xl border space-y-3 bg-raised border-line`}>
              <div className="flex items-center space-x-2 text-xs font-semibold text-accent-text">
                <Sparkles className="w-4 h-4" />
                <span>Diagnóstico del Optimizador MariaDB / MySQL</span>
              </div>

              <div className="space-y-2 text-xs">
                {hasFullTableScan && (
                  <div className={`p-2.5 rounded-lg border flex items-start space-x-2.5 ${
                    isLight
                      ? "bg-rose-50 border-rose-200 text-rose-800"
                      : "bg-rose-950/30 border-rose-800/50 text-danger"
                  }`}>
                    <span className="text-base leading-none">⚠️</span>
                    <div>
                      <strong className={"text-rose-200"}>Alerta: Full Table Scan (ALL).</strong>
                      <p className={`text-[11px] mt-0.5 text-danger/90`}>
                        La consulta examina todas las filas de la tabla sin aprovechar índices. Si la tabla crece causará bloqueos y latencias críticas. Crea un índice sobre las columnas de <code className={`px-1 py-0.2 rounded font-mono ${isLight ? "bg-rose-100 text-rose-900" : "bg-rose-900/40 text-rose-200"}`}>WHERE</code> o <code className={`px-1 py-0.2 rounded font-mono ${isLight ? "bg-rose-100 text-rose-900" : "bg-rose-900/40 text-rose-200"}`}>JOIN</code>.
                      </p>
                    </div>
                  </div>
                )}

                {hasFilesort && (
                  <div className={`p-2.5 rounded-lg border flex items-start space-x-2.5 ${
                    isLight
                      ? "bg-amber-50 border-amber-200 text-amber-800"
                      : "bg-amber-950/20 border-amber-800/40 text-warning"
                  }`}>
                    <span className="text-base leading-none">⚡</span>
                    <div>
                      <strong className={"text-amber-200"}>Alerta de Rendimiento: Using filesort.</strong>
                      <p className={`text-[11px] mt-0.5 text-warning/90`}>
                        El motor debe ordenar los registros en un búfer temporal de memoria o disco al no coincidir el orden con ningún índice. Considera agregar un índice compuesto que incluya las columnas del <code className={`px-1 py-0.2 rounded font-mono ${isLight ? "bg-amber-100 text-amber-900" : "bg-amber-900/40 text-amber-200"}`}>ORDER BY</code>.
                      </p>
                    </div>
                  </div>
                )}

                {hasTemporary && (
                  <div className={`p-2.5 rounded-lg border flex items-start space-x-2.5 ${
                    isLight
                      ? "bg-purple-50 border-purple-200 text-purple-800"
                      : "bg-purple-950/20 border-purple-800/40 text-purple-300"
                  }`}>
                    <span className="text-base leading-none">📦</span>
                    <div>
                      <strong className={"text-purple-200"}>Alerta de Memoria: Using temporary.</strong>
                      <p className={`text-[11px] mt-0.5 text-purple-300/90`}>
                        Se crea una tabla temporal en disco/RAM para resolver la consulta (común en <code className={`px-1 py-0.2 rounded font-mono ${isLight ? "bg-purple-100 text-purple-900" : "bg-purple-900/40 text-purple-200"}`}>GROUP BY</code> o <code className={`px-1 py-0.2 rounded font-mono ${isLight ? "bg-purple-100 text-purple-900" : "bg-purple-900/40 text-purple-200"}`}>DISTINCT</code> sin índice de cobertura).
                      </p>
                    </div>
                  </div>
                )}

                {!hasFullTableScan && !hasFilesort && !hasTemporary && (
                  <div className="flex items-start space-x-2 text-emerald-700 dark:text-success">
                    <span className="font-bold">•</span>
                    <span>
                      <strong className="text-emerald-800 dark:text-emerald-200">Excelente:</strong> La consulta utiliza índices eficientes y no genera operaciones pesadas de ordenamiento o tablas temporales no indexadas.
                    </span>
                  </div>
                )}

                {/* Additional Optimizer Bottlenecks / Optimizations if passed */}
                {bottlenecks && bottlenecks.length > 0 && (
                  <div className={`pt-2 border-t space-y-1 border-line`}>
                    <span className="font-semibold text-rose-700 dark:text-danger block text-[11px]">Cuellos de botella detectados:</span>
                    <ul className="list-disc list-inside space-y-0.5 text-[11px] text-rose-800 dark:text-danger/80 font-medium">
                      {bottlenecks.map((b, idx) => (
                        <li key={idx}>{b}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {potentialOptimizations && potentialOptimizations.length > 0 && (
                  <div className={`pt-2 border-t space-y-1 border-line`}>
                    <span className="font-semibold text-sky-700 dark:text-info block text-[11px]">Sugerencias de optimización:</span>
                    <ul className="list-disc list-inside space-y-0.5 text-[11px] text-fg dark:text-sky-200/80 font-medium">
                      {potentialOptimizations.map((opt, idx) => (
                        <li key={idx}>{opt}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {baselinePlanRows && baselinePlanRows.length > 0 && (
                  <div className={`pt-1.5 border-t text-[11px] border-line text-fg-muted`}>
                    Comparando con línea base: {baselinePlanRows.length} pasos previos guardados.
                  </div>
                )}
              </div>
            </div>

            {/* Structured Table */}
            <div className={`border rounded-xl overflow-hidden shadow-sm bg-surface border-line`}>
              <div className={`px-4 py-2.5 border-b flex items-center justify-between text-xs font-semibold bg-raised border-line text-fg`}>
                <div className="flex items-center space-x-2">
                  <Activity className="w-4 h-4 text-accent-text" />
                  <span>Detalle de Pasos del Plan (EXPLAIN Tabular)</span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className={`font-semibold border-b font-mono text-[11px] bg-raised text-fg-muted border-line`}>
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
                  <tbody className={`divide-y text-xs divide-line`}>
                    {rows.map((row, idx) => {
                      const badge = getScanBadge(row.type);
                      const BadgeIcon = badge.icon;
                      return (
                        <tr
                          key={idx}
                          className={`transition-colors font-mono hover:bg-hover`}
                        >
                          <td className={`py-2.5 px-3 text-center text-fg-subtle`}>
                            {row.id}
                          </td>
                          <td className={`py-2.5 px-3 text-fg`}>
                            {row.select_type}
                          </td>
                          <td className={`py-2.5 px-3 font-bold text-fg`}>
                            {row.table}
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-semibold border ${badge.bg}`}
                            >
                              <BadgeIcon className="w-3 h-3" />
                              <span>{row.type}</span>
                            </span>
                          </td>
                          <td className={`py-2.5 px-3 text-[11px] text-fg-muted`}>
                            {row.possible_keys || "—"}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-accent-text">
                            {row.key || <span className={"text-fg-subtle font-normal"}>NULL</span>}
                          </td>
                          <td className={`py-2.5 px-3 text-[11px] text-fg-muted`}>
                            {row.key_len || "—"}
                          </td>
                          <td className={`py-2.5 px-3 text-[11px] text-fg-muted`}>
                            {row.ref || "—"}
                          </td>
                          <td className={`py-2.5 px-3 text-right font-bold text-fg`}>
                            {row.rows.toLocaleString()}
                          </td>
                          <td className={`py-2.5 px-3 text-right text-fg`}>
                            {row.filtered !== undefined ? `${row.filtered}%` : "—"}
                          </td>
                          <td className={`py-2.5 px-3 text-[11px] text-fg-muted`}>
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
      </div>
    </div>
  );
};
