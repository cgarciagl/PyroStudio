import { beforeEach, describe, expect, it } from "vitest";
import { useStagedChangesStore } from "../stagedChangesStore";

const state = () => useStagedChangesStore.getState();

describe("staged changes regression", () => {
  beforeEach(() => {
    state().clearTableChanges("test_db", "users");
    state().clearTableChanges("other_db", "users");
  });

  const update = (stagedValue: unknown, originalValue: unknown = "Ana") => ({
    database: "test_db",
    table: "users",
    rowIndex: 0,
    colIndex: 1,
    columnName: "name",
    originalValue,
    stagedValue,
    primaryKeys: [{ column: "id", value: 7 }],
  });

  it("stages a cell update and replaces a previous update for the same cell", () => {
    state().stageCellUpdate(update("Bea"));
    state().stageCellUpdate(update("Carla"));

    const changes = state().getTableChanges("test_db", "users");
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ type: "cell_update", stagedValue: "Carla" });
    expect(state().hasPendingChanges("test_db", "users")).toBe(true);
  });

  it("removes a staged update when the original value is restored", () => {
    state().stageCellUpdate(update("Bea"));
    state().stageCellUpdate(update("Ana"));

    expect(state().getTableChanges("test_db", "users")).toEqual([]);
    expect(state().hasPendingChanges("test_db", "users")).toBe(false);
  });

  it("keeps staged changes isolated by database and table", () => {
    state().stageCellUpdate(update("Bea"));
    state().stageCellUpdate({ ...update("Luis"), database: "other_db" });

    expect(state().getTableChanges("test_db", "users")).toHaveLength(1);
    expect(state().getTableChanges("other_db", "users")).toHaveLength(1);
    expect(state().getTableChanges("test_db", "orders")).toEqual([]);
  });

  it("replaces row updates with a row deletion and generates keyed SQL", () => {
    state().stageCellUpdate(update("Bea"));
    state().stageRowDelete({
      database: "test_db",
      table: "users",
      rowIndex: 0,
      originalRow: [7, "Ana"],
      primaryKeys: [{ column: "id", value: 7 }],
    });

    const changes = state().getTableChanges("test_db", "users");
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe("row_delete");
    const sql = state().generateSqlForTable("test_db", "users");
    expect(sql).toHaveLength(1);
    expect(sql[0]).toContain("DELETE FROM");
    expect(sql[0]).toContain("id");
    expect(sql[0]).toContain("7");
  });

  it("generates update and insert statements and clears pending changes", () => {
    state().stageCellUpdate(update("Bea"));
    state().stageRowInsert({
      tempId: "new-1",
      database: "test_db",
      table: "users",
      values: { name: "Cris", active: true },
    });

    const sql = state().generateSqlForTable("test_db", "users");
    expect(sql).toHaveLength(2);
    expect(sql[0]).toContain("UPDATE");
    expect(sql[1]).toContain("INSERT INTO");
    expect(state().hasPendingChanges("test_db", "users")).toBe(true);

    state().clearTableChanges("test_db", "users");
    expect(state().getTableChanges("test_db", "users")).toEqual([]);
    expect(state().hasPendingChanges("test_db", "users")).toBe(false);
  });
});
