import { describe, it, expect, beforeEach } from "vitest";
import { getStoredLayout, saveStoredLayout, type TableGridLayout } from "../DataGridCanvas";

describe("TableGridLayout persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns empty object when no layout is stored", () => {
    const layout = getStoredLayout("test_db", "users");
    expect(layout).toEqual({});
  });

  it("persists and retrieves column order, widths, and freeze count", () => {
    const sampleLayout: TableGridLayout = {
      columnOrder: ["username", "id", "email"],
      customWidths: { username: 250, id: 80, email: 300 },
      freezeColumns: 2,
    };

    saveStoredLayout("test_db", "users", sampleLayout);

    const retrieved = getStoredLayout("test_db", "users");
    expect(retrieved).toEqual(sampleLayout);
    expect(retrieved.freezeColumns).toBe(2);
    expect(retrieved.columnOrder).toEqual(["username", "id", "email"]);
    expect(retrieved.customWidths?.username).toBe(250);
  });

  it("isolates layout across different tables and databases", () => {
    saveStoredLayout("db1", "table_a", { freezeColumns: 1 });
    saveStoredLayout("db2", "table_a", { freezeColumns: 3 });

    expect(getStoredLayout("db1", "table_a").freezeColumns).toBe(1);
    expect(getStoredLayout("db2", "table_a").freezeColumns).toBe(3);
    expect(getStoredLayout("db1", "table_b")).toEqual({});
  });
});

