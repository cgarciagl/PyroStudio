import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("diagnostics");
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
        notes: t("plan.fallbackNotes"),
      },
    };
  }, [jsonPlan, rows, t]);

  // Color encodes the access cost (data): applied to the icon and type text only.
  const getScanBadge = (type: string) => {
    switch (type) {
      case "SYSTEM":
      case "CONST":
        return { color: "text-success", label: t("plan.scan.const"), icon: Zap };
      case "EQ_REF":
        return { color: "text-success", label: t("plan.scan.eqRef"), icon: CheckCircle2 };
      case "REF":
        return { color: "text-success", label: t("plan.scan.ref"), icon: CheckCircle2 };
      case "RANGE":
        return { color: "text-info", label: t("plan.scan.range"), icon: Activity };
      case "INDEX":
        return { color: "text-warning", label: t("plan.scan.index"), icon: Activity };
      case "ALL":
      default:
        return { color: "text-danger", label: t("plan.scan.all"), icon: AlertTriangle };
    }
  };

  const viewBtn = (active: boolean) =>
    `px-2 py-0.5 rounded text-xs flex items-center gap-1.5 transition-colors ${
      active ? "bg-surface text-fg font-medium" : "text-fg-muted hover:text-fg"
    }`;

  return (
    <div className="pyro-query-plan flex-1 flex flex-col h-full overflow-hidden bg-canvas text-fg">
      {/* Top Bar with Metrics & View Selector */}
      <div className="px-3 py-2 border-b space-y-2 shrink-0 bg-surface border-line" data-plan-toolbar>
        {/* Metrics Summary Row */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-fg-muted">
          <span className="flex items-center gap-1.5">
            {hasFullTableScan ? (
              <AlertTriangle className="w-3.5 h-3.5 text-danger" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 text-success" />
            )}
            {t("plan.metrics.access")}
            <span className="font-mono text-fg">
              {hasFullTableScan ? t("plan.metrics.fullTableScan") : t("plan.metrics.optimizedIndex")}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5" />
            {t("plan.metrics.estimatedRows")}
            <span className="font-mono text-fg">~{totalEstimatedRows.toLocaleString()}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5" />
            {t("plan.metrics.steps")}
            <span className="font-mono text-fg">{rows.length}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5" />
            {t("plan.metrics.indexes")}
            <span className="font-mono text-fg">
              {usesIndexes ? t("plan.metrics.indexActive") : t("plan.metrics.noIndex")}
            </span>
          </span>
        </div>

        {/* View Mode Segmented Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center p-0.5 rounded-md border bg-raised border-line">
            <button onClick={() => setActiveView("table")} className={viewBtn(activeView === "table")}>
              <TableIcon className="w-3.5 h-3.5" />
              <span>{t("plan.views.table")}</span>
            </button>
            <button onClick={() => setActiveView("tree")} className={viewBtn(activeView === "tree")}>
              <GitFork className="w-3.5 h-3.5" />
              <span>{t("plan.views.tree")}</span>
            </button>
            {!isSqliteExplain && (
              <button onClick={() => setActiveView("json")} className={viewBtn(activeView === "json")}>
                <FileJson className="w-3.5 h-3.5" />
                <span>{t("plan.views.json")}</span>
              </button>
            )}
          </div>

          {/* Quick Alerts */}
          <div className="flex items-center gap-3 text-[11px] text-fg-muted">
            {hasFullTableScan && (
              <span className="flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-danger" />
                {t("plan.alerts.fullTableScan")}
              </span>
            )}
            {hasFilesort && (
              <span className="flex items-center gap-1">
                <ArrowUpDown className="w-3 h-3 text-warning" />
                {t("plan.alerts.filesort")}
              </span>
            )}
            {hasTemporary && (
              <span className="flex items-center gap-1">
                <Layers className="w-3 h-3 text-warning" />
                {t("plan.alerts.temporary")}
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
                <span>{t("plan.sqlite.title")}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="font-medium border-b font-mono text-[11px] bg-raised text-fg-muted border-line">
                      <th className="py-1.5 px-3 w-16 text-center">{t("plan.sqlite.colId")}</th>
                      <th className="py-1.5 px-3 w-16 text-center">{t("plan.sqlite.colParent")}</th>
                      <th className="py-1.5 px-3">{t("plan.sqlite.colDetail")}</th>
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
                <span>{t("plan.diagnostic.title")}</span>
              </div>

              {hasFullTableScan && (
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-danger" />
                  <div>
                    <span className="font-medium text-fg">{t("plan.diagnostic.fullScanTitle")}</span>
                    <p className="text-[11px] mt-0.5 text-fg-muted">
                      {t("plan.diagnostic.fullScanDesc", { where: "WHERE", join: "JOIN" })}
                    </p>
                  </div>
                </div>
              )}

              {hasFilesort && (
                <div className="flex items-start gap-2">
                  <ArrowUpDown className="w-3.5 h-3.5 mt-0.5 shrink-0 text-warning" />
                  <div>
                    <span className="font-medium text-fg">{t("plan.diagnostic.filesortTitle")}</span>
                    <p className="text-[11px] mt-0.5 text-fg-muted">
                      {t("plan.diagnostic.filesortDesc", { orderBy: "ORDER BY" })}
                    </p>
                  </div>
                </div>
              )}

              {hasTemporary && (
                <div className="flex items-start gap-2">
                  <Layers className="w-3.5 h-3.5 mt-0.5 shrink-0 text-warning" />
                  <div>
                    <span className="font-medium text-fg">{t("plan.diagnostic.temporaryTitle")}</span>
                    <p className="text-[11px] mt-0.5 text-fg-muted">
                      {t("plan.diagnostic.temporaryDesc", { groupBy: "GROUP BY", distinct: "DISTINCT" })}
                    </p>
                  </div>
                </div>
              )}

              {!hasFullTableScan && !hasFilesort && !hasTemporary && (
                <div className="flex items-start gap-2 text-fg-muted">
                  <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-success" />
                  <span>
                    {t("plan.diagnostic.clean")}
                  </span>
                </div>
              )}

              {/* Additional Optimizer Bottlenecks / Optimizations if passed */}
              {bottlenecks && bottlenecks.length > 0 && (
                <div className="pt-2 border-t space-y-1 border-line">
                  <span className="font-medium text-fg block text-[11px]">{t("plan.diagnostic.bottlenecks")}</span>
                  <ul className="list-disc list-inside space-y-0.5 text-[11px] text-fg-muted">
                    {bottlenecks.map((b, idx) => (
                      <li key={idx}>{b}</li>
                    ))}
                  </ul>
                </div>
              )}

              {potentialOptimizations && potentialOptimizations.length > 0 && (
                <div className="pt-2 border-t space-y-1 border-line">
                  <span className="font-medium text-fg block text-[11px]">{t("plan.diagnostic.suggestions")}</span>
                  <ul className="list-disc list-inside space-y-0.5 text-[11px] text-fg-muted">
                    {potentialOptimizations.map((opt, idx) => (
                      <li key={idx}>{opt}</li>
                    ))}
                  </ul>
                </div>
              )}

              {baselinePlanRows && baselinePlanRows.length > 0 && (
                <div className="pt-1.5 border-t text-[11px] border-line text-fg-muted">
                  {t("plan.diagnostic.baseline", { count: baselinePlanRows.length })}
                </div>
              )}
            </div>

            {/* Structured Table */}
            <div className="border rounded-lg overflow-hidden bg-surface border-line">
              <div className="px-3 py-1.5 border-b flex items-center gap-2 text-xs font-medium bg-raised border-line text-fg">
                <Activity className="w-3.5 h-3.5 text-fg-muted" />
                <span>{t("plan.table.title")}</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="font-medium border-b font-mono text-[11px] bg-raised text-fg-muted border-line">
                      <th className="py-1.5 px-3 w-10 text-center">{t("plan.table.colId")}</th>
                      <th className="py-1.5 px-3">{t("plan.table.colSelectType")}</th>
                      <th className="py-1.5 px-3">{t("plan.table.colTable")}</th>
                      <th className="py-1.5 px-3">{t("plan.table.colAccessType")}</th>
                      <th className="py-1.5 px-3">{t("plan.table.colPossibleKeys")}</th>
                      <th className="py-1.5 px-3">{t("plan.table.colKeyUsed")}</th>
                      <th className="py-1.5 px-3">{t("plan.table.colKeyLen")}</th>
                      <th className="py-1.5 px-3">{t("plan.table.colRef")}</th>
                      <th className="py-1.5 px-3 text-right">{t("plan.table.colRows")}</th>
                      <th className="py-1.5 px-3 text-right">{t("plan.table.colFiltered")}</th>
                      <th className="py-1.5 px-3">{t("plan.table.colExtra")}</th>
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
