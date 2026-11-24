import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { ScriptStatementResult } from "../../types/database";

interface ScriptMessagesPanelProps {
  scriptResults: ScriptStatementResult[];
  elapsedMs: number;
  /** Show the result set of a statement that returned rows. */
  onOpenResult: (stmt: ScriptStatementResult) => void;
}

/** Per-statement outcome of a multi-statement script. */
export function ScriptMessagesPanel({ scriptResults, elapsedMs, onOpenResult }: ScriptMessagesPanelProps) {
  const { t } = useTranslation("queryEditor");

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-auto p-4 space-y-4 select-text">
      <div className="flex items-center justify-between pb-2 border-b border-line">
        <div className="flex items-center gap-2">
          {scriptResults.some((s) => s.error) ? (
            <AlertCircle className="w-4 h-4 text-danger shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
          )}
          <span className="text-xs font-semibold text-fg">
            {scriptResults.some((s) => s.error)
              ? t("scriptMessages.stoppedError", {
                  index: (scriptResults.find((s) => s.error)?.statement_index ?? 0) + 1,
                  total: scriptResults.length,
                })
              : t("scriptMessages.successSummary", { count: scriptResults.length, ms: elapsedMs })}
          </span>
        </div>
        <span className="text-[11px] text-fg-muted font-mono">
          {t("scriptMessages.rowsSummary", {
            returned: scriptResults.reduce((acc, s) => acc + s.rows.length, 0),
            affected: scriptResults.reduce((acc, s) => acc + s.affected_rows, 0),
          })}
        </span>
      </div>

      <div className="rounded-md border border-line overflow-hidden bg-surface">
        <table className="w-full text-left text-xs font-mono border-collapse">
          <thead>
            <tr className="bg-raised text-fg-muted border-b border-line text-[11px]">
              <th className="py-1.5 px-3 w-10">#</th>
              <th className="py-1.5 px-3">{t("scriptMessages.colSql")}</th>
              <th className="py-1.5 px-3 w-24">{t("scriptMessages.colStatus")}</th>
              <th className="py-1.5 px-3 w-28 text-right">{t("scriptMessages.colRows")}</th>
              <th className="py-1.5 px-3 w-20 text-right">{t("scriptMessages.colTime")}</th>
              <th className="py-1.5 px-3">{t("scriptMessages.colDetail")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {scriptResults.map((stmt, idx) => {
              const hasData = stmt.is_result_set || stmt.columns.length > 0;
              return (
                <tr
                  key={idx}
                  onClick={() => {
                    if (hasData) onOpenResult(stmt);
                  }}
                  className={`hover:bg-hover transition-colors ${
                    stmt.error ? "bg-danger/5" : ""
                  } ${hasData ? "cursor-pointer" : ""}`}
                  title={
                    hasData
                      ? t("scriptMessages.openResultTooltip")
                      : undefined
                  }
                >
                  <td className="py-2 px-3 text-fg-muted">{idx + 1}</td>
                  <td className="py-2 px-3 max-w-xs truncate text-fg" title={stmt.sql}>
                    {stmt.sql}
                  </td>
                  <td className="py-2 px-3">
                    {stmt.error ? (
                      <span className="inline-flex items-center gap-1 text-danger font-medium">
                        <AlertCircle className="w-3 h-3" /> {t("scriptMessages.statusError")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-success font-medium">
                        <CheckCircle2 className="w-3 h-3" /> {t("scriptMessages.statusSuccess")}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right text-fg-muted">
                    {stmt.columns.length > 0
                      ? t("scriptMessages.rows", { count: stmt.rows.length })
                      : t("scriptMessages.affected", { count: stmt.affected_rows })}
                  </td>
                  <td className="py-2 px-3 text-right text-fg-muted">
                    {stmt.execution_time_ms} ms
                  </td>
                  <td className="py-2 px-3 text-fg-subtle truncate max-w-sm" title={stmt.error || stmt.message}>
                    {stmt.error ? (
                      <span className="text-danger font-medium">{stmt.error}</span>
                    ) : (
                      stmt.message
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
