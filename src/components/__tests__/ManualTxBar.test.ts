import { describe, expect, it } from "vitest";
import { isLongRunning, LONG_TRANSACTION_MS } from "../ManualTxBar";
import { pendingStatements, useManualTxStore } from "../../stores/manualTxStore";

describe("transacción manual", () => {
  it("avisa solo si hay cambios pendientes desde hace mucho", () => {
    const start = 1_000;
    const later = start + LONG_TRANSACTION_MS;
    expect(isLongRunning({ pending_statements: 2, started_at_ms: start }, later)).toBe(true);
    expect(isLongRunning({ pending_statements: 2, started_at_ms: start }, later - 1)).toBe(false);
    expect(isLongRunning({ pending_statements: 0, started_at_ms: start }, later)).toBe(false);
  });

  it("registra las sentencias pendientes por pestaña", () => {
    useManualTxStore.getState().setPending("tab-1", 3);
    expect(pendingStatements("tab-1")).toBe(3);
    useManualTxStore.getState().clear("tab-1");
    expect(pendingStatements("tab-1")).toBe(0);
  });

  it("uses the configured limit when given", () => {
    const start = 1_000_000;
    const twoMinutes = 2 * 60 * 1000;
    expect(isLongRunning({ pending_statements: 1, started_at_ms: start }, start + twoMinutes, twoMinutes)).toBe(true);
    expect(isLongRunning({ pending_statements: 1, started_at_ms: start }, start + twoMinutes - 1, twoMinutes)).toBe(false);
  });
});
