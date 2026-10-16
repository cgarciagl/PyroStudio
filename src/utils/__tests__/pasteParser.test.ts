import { describe, it, expect } from "vitest";
import {
  coercePasteValue,
  checkTypeCompatibility,
  parseClipboardMatrix,
  standardizeNumericString,
} from "../pasteParser";

describe("pasteParser", () => {
  describe("standardizeNumericString", () => {
    it("converts comma decimal separator to dot", () => {
      expect(standardizeNumericString("1234,56")).toBe("1234.56");
      expect(standardizeNumericString("-99,95")).toBe("-99.95");
      expect(standardizeNumericString("0,5")).toBe("0.5");
    });

    it("removes thousands commas with dot decimal or multiple commas", () => {
      expect(standardizeNumericString("1,234,567.89")).toBe("1234567.89");
      expect(standardizeNumericString("1,234,567")).toBe("1234567");
      expect(standardizeNumericString("1,234")).toBe("1.234");
    });

    it("removes thousands dots with comma decimal", () => {
      expect(standardizeNumericString("1.234.567,89")).toBe("1234567.89");
      expect(standardizeNumericString("1.234,50")).toBe("1234.50");
    });

    it("leaves regular numbers and plain text untouched", () => {
      expect(standardizeNumericString("1234.56")).toBe("1234.56");
      expect(standardizeNumericString("42")).toBe("42");
      expect(standardizeNumericString("hello")).toBe("hello");
      expect(standardizeNumericString("")).toBe("");
    });
  });

  describe("coercePasteValue", () => {
    it("coerces \\N to null", () => {
      expect(coercePasteValue("\\N")).toBeNull();
    });

    it("coerces NULL (case insensitive) to null", () => {
      expect(coercePasteValue("NULL")).toBeNull();
      expect(coercePasteValue("null")).toBeNull();
      expect(coercePasteValue("  NuLL  ")).toBeNull();
    });

    it("unwraps quoted string '\"NULL\"' into literal 'NULL'", () => {
      expect(coercePasteValue('"NULL"')).toBe("NULL");
      expect(coercePasteValue("'NULL'")).toBe("NULL");
    });

    it("preserves empty string", () => {
      expect(coercePasteValue("")).toBe("");
    });

    it("preserves regular unquoted strings", () => {
      expect(coercePasteValue("Hello World")).toBe("Hello World");
      expect(coercePasteValue("12345")).toBe("12345");
    });
  });

  describe("checkTypeCompatibility", () => {
    it("validates integer types", () => {
      expect(checkTypeCompatibility(42, "INT")).toBeUndefined();
      expect(checkTypeCompatibility("100", "BIGINT")).toBeUndefined();
      expect(checkTypeCompatibility("1,000", "INT")).toBeUndefined();
      expect(checkTypeCompatibility("abc", "INT")).toBeDefined();
      expect(checkTypeCompatibility("12.34", "INT")).toBeDefined();
    });

    it("validates float / decimal types with dot or comma", () => {
      expect(checkTypeCompatibility("12.34", "DECIMAL(10,2)")).toBeUndefined();
      expect(checkTypeCompatibility("12,34", "DECIMAL(10,2)")).toBeUndefined();
      expect(checkTypeCompatibility("1.234,50", "DECIMAL(10,2)")).toBeUndefined();
      expect(checkTypeCompatibility("99.9", "FLOAT")).toBeUndefined();
      expect(checkTypeCompatibility("invalid", "DOUBLE")).toBeDefined();
    });

    it("ignores null or missing colType", () => {
      expect(checkTypeCompatibility(null, "INT")).toBeUndefined();
      expect(checkTypeCompatibility("any", undefined)).toBeUndefined();
    });
  });

  describe("parseClipboardMatrix", () => {
    const columns = ["id", "username", "age", "bio"];
    const columnTypes = ["INT", "VARCHAR", "INT", "TEXT"];
    const displayRows = [
      [1, "alice", 25, "Software dev"],
      [2, "bob", 30, "Designer"],
      [3, "carol", 28, "Manager"],
    ];

    it("parses 2D block paste and detects PK modifications", () => {
      const matrix = [
        ["10", "alice_new", "26"],
        ["20", "bob_new", "31"],
      ];

      const res = parseClipboardMatrix({
        targetCol: 0,
        targetRow: 0,
        matrix,
        columns,
        columnTypes,
        displayRows,
        activePkColumns: ["id"],
        hasPrimaryKey: true,
        isEditingAllowed: true,
      });

      expect(res.errors).toHaveLength(0);
      expect(res.totalCells).toBe(6);
      expect(res.affectedRowsCount).toBe(2);
      expect(res.pkColumnsAffected).toContain("id");
      expect(res.warnings.length).toBeGreaterThan(0);
      expect(res.warnings[0]).toContain("Clave Primaria: [id]");
      expect(res.changes[0].primaryKeys[0].value).toBe(1); // Original PK preserved!
      expect(res.changes[3].primaryKeys[0].value).toBe(2); // Original PK preserved!
    });

    it("blocks paste when editing is not allowed", () => {
      const res = parseClipboardMatrix({
        targetCol: 0,
        targetRow: 0,
        matrix: [["foo"]],
        columns,
        columnTypes,
        displayRows,
        activePkColumns: [],
        hasPrimaryKey: false,
        isEditingAllowed: false,
      });

      expect(res.errors.length).toBeGreaterThan(0);
      expect(res.totalCells).toBe(0);
    });

    it("handles out of bounds rows gracefully with warnings", () => {
      const matrix = [
        ["val1"],
        ["val2"],
        ["val3"],
        ["val4"], // beyond 3 rows in displayRows
      ];

      const res = parseClipboardMatrix({
        targetCol: 1,
        targetRow: 1, // start at row 1 (bob), row 2 (carol), then out of bounds
        matrix,
        columns,
        columnTypes,
        displayRows,
        activePkColumns: ["id"],
        hasPrimaryKey: true,
        isEditingAllowed: true,
      });

      expect(res.errors).toHaveLength(0);
      expect(res.affectedRowsCount).toBe(2);
      expect(res.warnings.some((w) => w.includes("truncaron"))).toBe(true);
    });

    it("correctly maps original values and PK when visual columns are reordered", () => {
      // Visual columns have 'username' before 'id'
      const visualCols = ["username", "id", "age", "bio"];
      const rawCols = ["id", "username", "age", "bio"];
      const visualColTypes = ["VARCHAR", "INT", "INT", "TEXT"];

      const matrix = [["alice_updated", "100"]];

      const res = parseClipboardMatrix({
        targetCol: 0,
        targetRow: 0,
        matrix,
        columns: visualCols,
        columnTypes: visualColTypes,
        rawColumns: rawCols,
        displayRows,
        activePkColumns: ["id"],
        hasPrimaryKey: true,
        isEditingAllowed: true,
      });

      expect(res.errors).toHaveLength(0);
      expect(res.changes).toHaveLength(2);
      // First change is username
      expect(res.changes[0].columnName).toBe("username");
      expect(res.changes[0].originalValue).toBe("alice");
      expect(res.changes[0].proposedValue).toBe("alice_updated");
      // Second change is id (PK)
      expect(res.changes[1].columnName).toBe("id");
      expect(res.changes[1].originalValue).toBe(1);
      expect(res.changes[1].proposedValue).toBe("100");
      expect(res.changes[1].primaryKeys[0].value).toBe(1); // Original PK is intact!
    });
  });
});

