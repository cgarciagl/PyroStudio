import { useTranslation } from "react-i18next";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import i18n from "../../i18n";
import type { QueryExecutionResult, ScriptProgress, ScriptStatementResult } from "../../types/database";

export type ExecutionState = "idle" | "executing" | "success" | "error" | "cancelled";

interface ExecutionStatusProps {
  executionState: ExecutionState;
  elapsedMs: number;
  error: string | null;
  result: QueryExecutionResult | null;
  scriptResults: ScriptStatementResult[] | null;
  /** Running script: statements finished so far. */
  scriptProgress?: ScriptProgress | null;
}

/** "Sentencia 3 de 37" while a multi-statement script runs. */
export function formatScriptProgress(progress: ScriptProgress | null | undefined): string | null {
  if (!progress || progress.total < 2) return null;
  const current = Math.min(progress.completed + 1, progress.total);
  return i18n.t("queryEditor:executionStatus.stepProgress", { current, total: progress.total });
}

/** One-line state of the last run (running, cancelled, error, rows · ms). */
export function ExecutionStatus({ executionState, elapsedMs, error, result, scriptResults, scriptProgress }: ExecutionStatusProps) {
  const { t } = useTranslation("queryEditor");
  const step = formatScriptProgress(scriptProgress);
  return (
    <>
    {executionState === "executing" && (
      <span className="flex items-center gap-1.5">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
        {step ? `${step} · ` : t("executionStatus.executing")}
        {elapsedMs} ms
      </span>
    )}
    {executionState === "cancelled" && <span>{t("executionStatus.cancelled")}</span>}
    {executionState === "error" && error && (
      <span className="flex items-center gap-1.5 text-danger">
        <AlertCircle className="w-3.5 h-3.5" />
        {t("executionStatus.errorPrefix", { ms: elapsedMs })}
      </span>
    )}
    {executionState === "success" && (
      <span className="flex items-center gap-1.5">
        {scriptResults && scriptResults.some((s) => s.warning) ? (
          <AlertCircle className="w-3.5 h-3.5 text-warning" />
        ) : (
          <CheckCircle2 className="w-3.5 h-3.5 text-success" />
        )}
        {scriptResults && scriptResults.length > 1
          ? t("executionStatus.queriesCount", { count: scriptResults.length, ms: elapsedMs })
          : result
          ? t("executionStatus.rowsCount", { count: result.rows.length, ms: result.execution_time_ms || elapsedMs })
          : `${elapsedMs} ms`}
      </span>
    )}
    </>
  );
}
