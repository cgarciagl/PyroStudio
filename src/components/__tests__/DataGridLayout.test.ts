import { describe, it, expect, beforeEach } from "vitest";
import {
  getStoredLayout,
  saveStoredLayout,
  formatCellDisplay,
  MAX_CANVAS_TEXT_LENGTH,
  type TableGridLayout,
} from "../DataGridCanvas";

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

describe("formatCellDisplay cell truncation & performance formatting", () => {
  it("formats null and undefined as NULL without modifying fullData", () => {
    expect(formatCellDisplay(null)).toEqual({ displayData: "NULL", fullData: "" });
    expect(formatCellDisplay(undefined)).toEqual({ displayData: "NULL", fullData: "" });
  });

  it("preserves standard short strings identically in displayData and fullData", () => {
    const text = "Hello PyroStudio";
    const result = formatCellDisplay(text);
    expect(result.displayData).toBe(text);
    expect(result.fullData).toBe(text);
  });

  it("truncates massive strings exceeding MAX_CANVAS_TEXT_LENGTH while preserving fullData", () => {
    const massive = "X".repeat(5000);
    const result = formatCellDisplay(massive);

    expect(result.fullData).toBe(massive);
    expect(result.displayData.length).toBeLessThan(1100);
    expect(result.displayData).toContain("… (+");
    expect(result.displayData).toContain("KB)");
    expect(result.displayData.startsWith("X".repeat(MAX_CANVAS_TEXT_LENGTH))).toBe(true);
  });

  it("truncates JSON displayData to compact preview while preserving full JSON in fullData", () => {
    const jsonObject = { id: 1, name: "Database test payload with long descriptive properties" };
    const result = formatCellDisplay(jsonObject, true);

    expect(result.fullData).toBe(JSON.stringify(jsonObject));
    expect(result.displayData.endsWith("...")).toBe(true);
    expect(result.displayData.length).toBeLessThanOrEqual(60);
  });
});

