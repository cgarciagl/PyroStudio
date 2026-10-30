import React, { useState, useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpDown,
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

  // Color encodes the access cost (data): applied to the icon and type text only.
  const getScanBadge = (type: string) => {
    switch (type) {
      case "SYSTEM":
      case "CONST":
        return { color: "text-success", label: "CONST (Máxima Velocidad)", icon: Zap };
      case "EQ_REF":
        return { color: "text-success", label: "EQ_REF (Índice Único)", icon: CheckCircle2 };
      case "REF":
        return { color: "text-success", label: "REF (Índice No Único)", icon: CheckCircle2 };
      case "RANGE":
        return { color: "text-info", label: "RANGE (Rango Indexado)", icon: Activity };
      case "INDEX":
        return { color: "text-warning", label: "INDEX (Escaneo de Todo el Índice)", icon: Activity };
      case "ALL":
      default:
        return { color: "text-danger", label: "ALL (Full Table Scan)", icon: AlertTriangle };
    }
  };

  const viewBtn = (active: boolean) =>
    `px-2 py-0.5 rounded text-xs flex items-center gap-1.5 transition-colors ${
      active ? "bg-surface text-fg font-medium" : "text-fg-muted hover:text-fg"
    }`;

  const codeClass = "px-1 rounded font-mono bg-raised text-fg";

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden select-none bg-canvas text-fg">
      {/* Top Bar with Metrics & View Selector */}
      <div className="px-3 py-2 border-b space-y-2 shrink-0 bg-surface border-line">
        {/* Metrics Summary Row */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-fg-muted">
          <span className="flex items-center gap-1.5">
            {hasFullTableScan ? (
              <AlertTriangle className="w-3.5 h-3.5 text-danger" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 text-success" />
            )}
            Acceso:
            <span className="font-mono text-fg">
              {hasFullTableScan ? "Full Table Scan (ALL)" : "Índice optimizado"}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5" />
            Filas estimadas:
            <span className="font-mono text-fg">~{totalEstimatedRows.toLocaleString()}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5" />
            Pasos:
            <span className="font-mono text-fg">{rows.length}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5" />
            Índices:
            <span className="font-mono text-fg">
              {usesIndexes ? "Activo (llave asignada)" : "Sin índice utilizado"}
            </span>
          </span>
        </div>

        {/* View Mode Segmented Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center p-0.5 rounded-md border bg-raised border-line">
            <button onClick={() => setActiveView("table")} className={viewBtn(activeView === "table")}>
              <TableIcon className="w-3.5 h-3.5" />
              <span>Tabla relacional</span>
            </button>
            <button onClick={() => setActiveView("tree")} className={viewBtn(activeView === "tree")}>
              <GitFork className="w-3.5 h-3.5" />
              <span>Árbol jerárquico</span>
            </button>
            {!isSqliteExplain && (
              <button onClick={() => setActiveView("json")} className={viewBtn(activeView === "json")}>
                <FileJson className="w-3.5 h-3.5" />
                <span>Formato JSON</span>
              </button>
            )}
          </div>

          {/* Quick Alerts */}
          <div className="flex items-center gap-3 text-[11px] text-fg-muted">
            {hasFullTableScan && (
              <span className="flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-danger" />
                Full table scan
              </span>
            )}
            {hasFilesort && (
              <span className="flex items-center gap-1">
                <ArrowUpDown className="w-3 h-3 text-warning" />
                Filesort
              </span>
            )}
            {hasTemporary && (
              <span className="flex items-center gap-1">
                <Layers className="w-3 h-3 text-warning" />
                Tabla temporal
              </span>
            )}
            {rawResult && (
              <span className="font-mono text-fg-subtle">{rawResult.execution_time_ms} ms</span>
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
          <div className="p-3">
            <div className="border rounded-lg overflow-hidden bg-surface border-line">
              <div className="px-3 py-1.5 border-b flex items-center gap-2 text-xs font-medium bg-raised border-line text-fg">
                <Activity className="w-3.5 h-3.5 text-fg-muted" />
                <span>Detalle de pasos SQLite (EXPLAIN QUERY PLAN)</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="font-medium border-b font-mono text-[11px] bg-raised text-fg-muted border-line">
                      <th className="py-1.5 px-3 w-16 text-center">ID</th>
                      <th className="py-1.5 px-3 w-16 text-center">Parent</th>
                      <th className="py-1.5 px-3">Detail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y text-xs divide-line">
                    {sqliteRows.map((sr, idx) => (
                      <tr key={idx} className="transition-colors font-mono hover:bg-hover">
                        <td className="py-1.5 px-3 text-center text-fg-subtle">{sr.id}</td>
                        <td className="py-1.5 px-3 text-center text-fg-subtle">{sr.parent}</td>
                        <td className="py-1.5 px-3 text-fg">{sr.detail}</td>
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
          <div className="p-3 space-y-3">
            {/* Optimization Diagnostic */}
            <div className="p-3 rounded-lg border space-y-2 bg-surface border-line text-xs">
              <div className="flex items-center gap-2 font-medium text-fg">
                <Sparkles className="w-3.5 h-3.5 text-fg-muted" />
                <span>Diagnóstico del optimizador</span>
              </div>

              {hasFullTableScan && (
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-danger" />
                  <div>
                    <span className="font-medium text-fg">Full table scan (ALL).</span>
                    <p className="text-[11px] mt-0.5 text-fg-muted">
                      La consulta examina todas las filas de la tabla sin aprovechar índices. Si la tabla crece causará bloqueos y latencias críticas. Crea un índice sobre las columnas de <code className={codeClass}>WHERE</code> o <code className={codeClass}>JOIN</code>.
                    </p>
                  </div>
                </div>
              )}

              {hasFilesort && (
                <div className="flex items-start gap-2">
                  <ArrowUpDown className="w-3.5 h-3.5 mt-0.5 shrink-0 text-warning" />
                  <div>
                    <span className="font-medium text-fg">Using filesort.</span>
                    <p className="text-[11px] mt-0.5 text-fg-muted">
                      El motor debe ordenar los registros en un búfer temporal de memoria o disco al no coincidir el orden con ningún índice. Considera agregar un índice compuesto que incluya las columnas del <code className={codeClass}>ORDER BY</code>.
                    </p>
                  </div>
                </div>
              )}

              {hasTemporary && (
                <div className="flex items-start gap-2">
                  <Layers className="w-3.5 h-3.5 mt-0.5 shrink-0 text-warning" />
                  <div>
                    <span className="font-medium text-fg">Using temporary.</span>
                    <p className="text-[11px] mt-0.5 text-fg-muted">
                      Se crea una tabla temporal en disco/RAM para resolver la consulta (común en <code className={codeClass}>GROUP BY</code> o <code className={codeClass}>DISTINCT</code> sin índice de cobertura).
                    </p>
                  </div>
                </div>
              )}

              {!hasFullTableScan && !hasFilesort && !hasTemporary && (
                <div className="flex items-start gap-2 text-fg-muted">
                  <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-success" />
                  <span>
                    La consulta utiliza índices eficientes y no genera operaciones pesadas de ordenamiento o tablas temporales no indexadas.
                  </span>
                </div>
              )}

              {/* Additional Optimizer Bottlenecks / Optimizations if passed */}
              {bottlenecks && bottlenecks.length > 0 && (
                <div className="pt-2 border-t space-y-1 border-line">
                  <span className="font-medium text-fg block text-[11px]">Cuellos de botella detectados</span>
                  <ul className="list-disc list-inside space-y-0.5 text-[11px] text-fg-muted">
                    {bottlenecks.map((b, idx) => (
                      <li key={idx}>{b}</li>
                    ))}
                  </ul>
                </div>
              )}

              {potentialOptimizations && potentialOptimizations.length > 0 && (
                <div className="pt-2 border-t space-y-1 border-line">
                  <span className="font-medium text-fg block text-[11px]">Sugerencias de optimización</span>
                  <ul className="list-disc list-inside space-y-0.5 text-[11px] text-fg-muted">
                    {potentialOptimizations.map((opt, idx) => (
                      <li key={idx}>{opt}</li>
                    ))}
                  </ul>
                </div>
              )}

              {baselinePlanRows && baselinePlanRows.length > 0 && (
                <div className="pt-1.5 border-t text-[11px] border-line text-fg-muted">
                  Comparando con línea base: {baselinePlanRows.length} pasos previos guardados.
                </div>
              )}
            </div>

            {/* Structured Table */}
            <div className="border rounded-lg overflow-hidden bg-surface border-line">
              <div className="px-3 py-1.5 border-b flex items-center gap-2 text-xs font-medium bg-raised border-line text-fg">
                <Activity className="w-3.5 h-3.5 text-fg-muted" />
                <span>Detalle de pasos del plan (EXPLAIN tabular)</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="font-medium border-b font-mono text-[11px] bg-raised text-fg-muted border-line">
                      <th className="py-1.5 px-3 w-10 text-center">ID</th>
                      <th className="py-1.5 px-3">Select Type</th>
                      <th className="py-1.5 px-3">Tabla</th>
                      <th className="py-1.5 px-3">Tipo Acceso</th>
                      <th className="py-1.5 px-3">Posibles Llaves</th>
                      <th className="py-1.5 px-3">Llave Utilizada</th>
                      <th className="py-1.5 px-3">Long. Llave</th>
                      <th className="py-1.5 px-3">Ref</th>
                      <th className="py-1.5 px-3 text-right">Filas Estim.</th>
                      <th className="py-1.5 px-3 text-right">Filtrado %</th>
                      <th className="py-1.5 px-3">Extra</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y text-xs divide-line">
                    {rows.map((row, idx) => {
                      const badge = getScanBadge(row.type);
                      const BadgeIcon = badge.icon;
                      return (
                        <tr key={idx} className="transition-colors font-mono hover:bg-hover">
                          <td className="py-1.5 px-3 text-center text-fg-subtle">{row.id}</td>
                          <td className="py-1.5 px-3 text-fg">{row.select_type}</td>
                          <td className="py-1.5 px-3 font-medium text-fg">{row.table}</td>
                          <td className="py-1.5 px-3">
                            <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${badge.color}`} title={badge.label}>
                              <BadgeIcon className="w-3 h-3" />
                              <span>{row.type}</span>
                            </span>
                          </td>
                          <td className="py-1.5 px-3 text-[11px] text-fg-muted">{row.possible_keys || "—"}</td>
                          <td className="py-1.5 px-3 text-fg">
                            {row.key || <span className="text-fg-subtle">NULL</span>}
                          </td>
                          <td className="py-1.5 px-3 text-[11px] text-fg-muted">{row.key_len || "—"}</td>
                          <td className="py-1.5 px-3 text-[11px] text-fg-muted">{row.ref || "—"}</td>
                          <td className="py-1.5 px-3 text-right font-medium text-fg">{row.rows.toLocaleString()}</td>
                          <td className="py-1.5 px-3 text-right text-fg">
                            {row.filtered !== undefined ? `${row.filtered}%` : "—"}
                          </td>
                          <td className="py-1.5 px-3 text-[11px] text-fg-muted">{row.extra || "—"}</td>
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
