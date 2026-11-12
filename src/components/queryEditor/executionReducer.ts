import type {
  QueryExecutionResult,
  ScriptExecutionResult,
  ScriptStatementResult,
} from "../../types/database";
import type { ExecutionState } from "./ExecutionStatus";

export type ResultsSubTab = "results" | "chart" | "plan" | "messages";

/**
 * Everything the results area shows about the last run. It used to be seven separate
 * useState calls updated together from many places, which allowed inconsistent mixes
 * (e.g. "success" with an old error). Every transition is now one pure, testable action.
 */
export interface ExecutionView {
  status: ExecutionState;
  error: string | null;
  /** Result set on screen (one statement of the script). */
  result: QueryExecutionResult | null;
  /** SQL of the statement on screen (decides the editable target table). */
  resultSql: string | null;
  scriptResults: ScriptStatementResult[] | null;
  activeResultSetIndex: number;
  activeSubTab: ResultsSubTab;
}

export const initialExecutionView: ExecutionView = {
  status: "idle",
  error: null,
  result: null,
  resultSql: null,
  scriptResults: null,
  activeResultSetIndex: 0,
  activeSubTab: "results",
};

export type ExecutionAction =
  | { type: "start" }
  | { type: "scriptDone"; script: ScriptExecutionResult }
  | { type: "failed"; message: string }
  | { type: "timedOut"; seconds: number }
  | { type: "cancelled" }
  | { type: "showResultSet"; resultSet: ScriptStatementResult }
  | { type: "setSubTab"; tab: ResultsSubTab }
  | { type: "setError"; message: string | null };

const returnsRows = (s: ScriptStatementResult) => s.is_result_set || s.columns.length > 0;

/** Outcome of a script run, shared by the reducer and the history entry. */
export function summarizeScript(script: ScriptExecutionResult) {
  const failedIndex =
    !script.success && script.failed_statement_index !== undefined ? script.failed_statement_index : null;
  if (failedIndex !== null) {
    const failed = script.statements[failedIndex];
    return {
      ok: false as const,
      failedIndex,
      error: script.error || failed?.error || "Error al ejecutar el script",
      // The first result set before the failure is still worth showing.
      shown: script.statements.find((s, i) => i < failedIndex && returnsRows(s)) ?? null,
    };
  }
  const firstWithRows = script.statements.find(returnsRows);
  return {
    ok: true as const,
    failedIndex: null,
    error: null,
    shown: firstWithRows ?? script.statements[0] ?? null,
    affectedRows: script.statements.reduce(
      (sum, s) => sum + (s.rows.length || (s.affected_rows as number) || 0),
      0,
    ),
    warning: script.statements.find((s) => s.warning)?.warning,
  };
}

const show = (state: ExecutionView, rs: ScriptStatementResult | null, tab?: ResultsSubTab): ExecutionView =>
  rs
    ? { ...state, activeResultSetIndex: rs.statement_index, result: rs, resultSql: rs.sql, activeSubTab: tab ?? state.activeSubTab }
    : { ...state, activeResultSetIndex: 0, result: null, resultSql: null, activeSubTab: tab ?? state.activeSubTab };

export function executionReducer(state: ExecutionView, action: ExecutionAction): ExecutionView {
  switch (action.type) {
    case "start":
      return { ...state, status: "executing", error: null, result: null, resultSql: null, scriptResults: null, activeResultSetIndex: 0 };
    case "scriptDone": {
      const summary = summarizeScript(action.script);
      const next = { ...state, scriptResults: action.script.statements };
      if (!summary.ok) {
        const withError = { ...next, status: "error" as const, error: summary.error };
        return summary.shown ? show(withError, summary.shown, "results") : show(withError, null);
      }
      const tab: ResultsSubTab = summary.shown && returnsRows(summary.shown) ? "results" : "messages";
      return show({ ...next, status: "success", error: null }, summary.shown, tab);
    }
    case "failed":
      return { ...state, status: "error", error: action.message, result: null, resultSql: null };
    case "timedOut":
      return {
        ...state,
        status: "error",
        error: `Tiempo de espera excedido: La consulta superó el límite configurado de ${action.seconds}s. Se envió la señal de cancelación al motor.`,
      };
    case "cancelled":
      return { ...state, status: "cancelled" };
    case "showResultSet":
      return show(state, action.resultSet, "results");
    case "setSubTab":
      return { ...state, activeSubTab: action.tab };
    case "setError":
      return { ...state, error: action.message };
  }
}
