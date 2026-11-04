import { describe, expect, it } from "vitest";
import { coercePasteValue, parseClipboardMatrix, standardizeNumericString } from "./pasteParser";

const base = {
  targetCol: 1, targetRow: 0, matrix: [["2,450.75"]],
  columns: ["id", "amount", "label"], columnTypes: ["INT", "DECIMAL(10,2)", "VARCHAR(40)"],
  displayRows: [[1, 100, "old"]], activePkColumns: ["id"], hasPrimaryKey: true, isEditingAllowed: true,
};

describe("data grid paste regression", () => {
  it("coerces explicit NULL markers and preserves quoted NULL as text", () => {
    expect(coercePasteValue("NULL")).toBeNull();
    expect(coercePasteValue("\\N")).toBeNull();
    expect(coercePasteValue('"NULL"')).toBe("NULL");
    expect(coercePasteValue('""')).toBe("");
  });
  it("normalizes supported decimal formats", () => {
    expect(standardizeNumericString("1234,56")).toBe("1234.56");
    expect(standardizeNumericString("1,234,567.89")).toBe("1234567.89");
    expect(standardizeNumericString("1.234.567,89")).toBe("1234567.89");
  });
  it("validates changes and retains the original primary key", () => {
    const result = parseClipboardMatrix(base);
    expect(result.errors).toEqual([]);
    expect(result.totalCells).toBe(1);
    expect(result.affectedRowsCount).toBe(1);
    expect(result.changes[0]).toMatchObject({ columnName: "amount", originalValue: 100, proposedValue: "2450.75", primaryKeys: [{ column: "id", value: 1 }] });
  });
  it("blocks edits in strict no-primary-key mode", () => {
    const result = parseClipboardMatrix({ ...base, hasPrimaryKey: false, isEditingAllowed: false });
    expect(result.totalCells).toBe(0);
    expect(result.changes).toEqual([]);
    expect(result.errors[0]).toContain("modo estricto");
  });
  it("rejects invalid coordinates and warns when paste exceeds loaded rows", () => {
    expect(parseClipboardMatrix({ ...base, targetRow: -1 }).errors[0]).toContain("Coordenadas");
    const result = parseClipboardMatrix({ ...base, matrix: [["10"], ["20"]] });
    expect(result.affectedRowsCount).toBe(1);
    expect(result.warnings.join(" ")).toContain("superan el límite");
  });
});
