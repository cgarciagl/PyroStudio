import { describe, it, expect, beforeEach, vi } from "vitest";

const executeTransaction = vi.fn();
vi.mock("../../services/tauriDb", () => ({
  dbService: { executeTransaction: (...args: unknown[]) => executeTransaction(...args) },
}));

import { applyStagedChanges, usePendingChangesStore } from "../pendingChangesStore";
import { useStagedChangesStore } from "../stagedChangesStore";

describe("applyStagedChanges", () => {
  beforeEach(() => {
    executeTransaction.mockReset();
    usePendingChangesStore.setState({ stagedByTab: {} });
    useStagedChangesStore.getState().clearTableChanges("db", "t");
    useStagedChangesStore.getState().stageRowInsert({ tempId: "n1", database: "db", table: "t", values: { a: 1 } });
    usePendingChangesStore.getState().setStaged("tab", { count: 1, database: "db", table: "t" });
  });

  it("runs the staged SQL in one transaction and clears the edits", async () => {
    executeTransaction.mockResolvedValue(1);
    await applyStagedChanges("tab");
    expect(executeTransaction).toHaveBeenCalledTimes(1);
    const [database, statements] = executeTransaction.mock.calls[0];
    expect(database).toBe("db");
    expect(statements[0]).toContain("INSERT");
    expect(usePendingChangesStore.getState().stagedByTab).toEqual({});
    expect(useStagedChangesStore.getState().generateSqlForTable("db", "t")).toEqual([]);
  });

  it("keeps the edits when the transaction fails", async () => {
    executeTransaction.mockRejectedValue("boom");
    await expect(applyStagedChanges("tab")).rejects.toBe("boom");
    expect(usePendingChangesStore.getState().stagedByTab.tab?.count).toBe(1);
    expect(useStagedChangesStore.getState().generateSqlForTable("db", "t")).toHaveLength(1);
  });
});
