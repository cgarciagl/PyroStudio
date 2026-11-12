import { describe, it, expect } from "vitest";
import { executionReducer, initialExecutionView, summarizeScript, type ExecutionView } from "../executionReducer";
import type { ScriptExecutionResult, ScriptStatementResult } from "../../../types/database";

const stmt = (i: number, over: Partial<ScriptStatementResult> = {}): ScriptStatementResult =>
  ({
    statement_index: i,
    sql: `S${i}`,
    columns: [],
    rows: [],
    affected_rows: 0,
    is_result_set: false,
    execution_time_ms: 1,
    ...over,
  }) as ScriptStatementResult;
const rows = (i: number) => stmt(i, { columns: ["a"], rows: [[1], [2]], is_result_set: true });
const script = (statements: ScriptStatementResult[], over: Partial<ScriptExecutionResult> = {}): ScriptExecutionResult => ({
  statements,
  total_time_ms: 5,
  success: true,
  ...over,
});
const run = (...actions: Parameters<typeof executionReducer>[1][]): ExecutionView =>
  actions.reduce(executionReducer, initialExecutionView);

describe("executionReducer", () => {
  it("start clears the previous run", () => {
    const before = run({ type: "start" }, { type: "scriptDone", script: script([rows(0)]) });
    const s = executionReducer(before, { type: "start" });
    expect(s).toMatchObject({ status: "executing", error: null, result: null, scriptResults: null });
  });

  it("success shows the first result set", () => {
    const s = run({ type: "start" }, { type: "scriptDone", script: script([stmt(0), rows(1)]) });
    expect(s.status).toBe("success");
    expect((s.result as ScriptStatementResult | null)?.statement_index).toBe(1);
    expect(s.resultSql).toBe("S1");
    expect(s.activeSubTab).toBe("results");
  });

  it("success without result sets opens the messages", () => {
    const s = run({ type: "start" }, { type: "scriptDone", script: script([stmt(0, { affected_rows: 3 })]) });
    expect(s.activeSubTab).toBe("messages");
  });

  it("a failed statement keeps the result set that came before it", () => {
    const failed = script([rows(0), stmt(1, { error: "boom" })], { success: false, failed_statement_index: 1 });
    const s = run({ type: "start" }, { type: "scriptDone", script: failed });
    expect(s).toMatchObject({ status: "error", error: "boom" });
    expect((s.result as ScriptStatementResult | null)?.statement_index).toBe(0);
  });

  it("timeout and cancel set their status; a thrown error drops the result", () => {
    expect(run({ type: "start" }, { type: "timedOut", seconds: 30 }).error).toContain("30s");
    expect(run({ type: "start" }, { type: "cancelled" }).status).toBe("cancelled");
    const f = run({ type: "scriptDone", script: script([rows(0)]) }, { type: "failed", message: "x" });
    expect(f).toMatchObject({ status: "error", error: "x", result: null });
  });

  it("summarizeScript counts affected rows and the first warning", () => {
    const sum = summarizeScript(script([rows(0), stmt(1, { affected_rows: 4, warning: "w" })]));
    expect(sum).toMatchObject({ ok: true, affectedRows: 6, warning: "w" });
  });
});
