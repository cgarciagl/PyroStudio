import { describe, it, expect } from "vitest";
import { buildGridColumns, filterRowsByRules, searchRows, sortRowsClient } from "../gridRows";
import type { TableDataResult } from "../../../types/database";

const data = {
  columns: ["id", "name", "owner_id"],
  column_types: ["int", "varchar", "int"],
  rows: [
    [2, "Bob", null],
    [10, "ana", 1],
    [1, null, 2],
  ],
  total_rows: 3,
  limit: 100,
  offset: 0,
  execution_time_ms: 1,
} as unknown as TableDataResult;

describe("buildGridColumns", () => {
  it("adds key prefixes, types, sort indicator and custom widths", () => {
    const fk = new Map([["owner_id", { column_name: "owner_id" } as any]]);
    const cols = buildGridColumns({
      dataResult: data,
      effectiveColumnNames: ["name", "id", "owner_id"],
      activePkColumns: ["id"],
      fkByColumn: fk,
      customWidths: { name: 222 },
      sortColumn: "id",
      sortDirection: "DESC",
    });
    expect(cols.map((c) => c.title)).toEqual(["name (varchar)", "🔑 id (int) ▼", "🔗 owner_id (int)"]);
    expect((cols[0] as any).width).toBe(222);
    expect((cols[1] as any).width).toBeGreaterThanOrEqual(140);
  });
  it("returns nothing without data", () => {
    expect(
      buildGridColumns({
        dataResult: null,
        effectiveColumnNames: [],
        activePkColumns: [],
        fkByColumn: new Map(),
        customWidths: {},
        sortColumn: null,
        sortDirection: null,
      }),
    ).toEqual([]);
  });
});

describe("sortRowsClient", () => {
  it("sorts numbers and strings with NULLs always last", () => {
    expect(sortRowsClient(data.rows, 0, "ASC").map((r) => r[0])).toEqual([1, 2, 10]);
    expect(sortRowsClient(data.rows, 1, "ASC").map((r) => r[1])).toEqual(["ana", "Bob", null]);
    expect(sortRowsClient(data.rows, 1, "DESC").map((r) => r[1])).toEqual(["Bob", "ana", null]);
  });
  it("does not mutate the input", () => {
    const copy = data.rows.map((r) => [...r]);
    sortRowsClient(data.rows, 0, "ASC");
    expect(data.rows).toEqual(copy);
  });
});

describe("searchRows", () => {
  it("matches any cell case-insensitively and ignores blank terms", () => {
    expect(searchRows(data.rows, "BOB")).toEqual([data.rows[0]]);
    expect(searchRows(data.rows, "  ")).toBe(data.rows);
  });
});

describe("filterRowsByRules", () => {
  it("ignores disabled rules and unknown columns", () => {
    const rules = [
      { id: "a", enabled: false, column: "id", operator: "=", value: "2", connector: "AND" },
      { id: "b", enabled: true, column: "missing", operator: "=", value: "x", connector: "AND" },
    ] as any;
    expect(filterRowsByRules(data.rows, data.columns, rules)).toEqual(data.rows);
  });
  it("applies enabled rules", () => {
    const rules = [{ id: "a", enabled: true, column: "id", operator: "=", value: "2", connector: "AND" }] as any;
    expect(filterRowsByRules(data.rows, data.columns, rules)).toEqual([data.rows[0]]);
  });
});
