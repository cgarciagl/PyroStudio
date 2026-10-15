import { describe, it, expect } from "vitest";
import {
  exportToCommaSeparated,
  formatValueForCommaSeparated,
  exportToTsv,
} from "../formatCopy";

describe("formatCopy utilities", () => {
  describe("formatValueForCommaSeparated", () => {
    it("handles NULL and undefined as NULL", () => {
      expect(formatValueForCommaSeparated(null)).toBe("NULL");
      expect(formatValueForCommaSeparated(undefined)).toBe("NULL");
      expect(formatValueForCommaSeparated("NULL")).toBe("NULL");
      expect(formatValueForCommaSeparated("null")).toBe("NULL");
    });

    it("formats booleans as 1 and 0", () => {
      expect(formatValueForCommaSeparated(true)).toBe("1");
      expect(formatValueForCommaSeparated(false)).toBe("0");
    });

    it("keeps numbers unquoted", () => {
      expect(formatValueForCommaSeparated(123)).toBe("123");
      expect(formatValueForCommaSeparated(45.67)).toBe("45.67");
      expect(formatValueForCommaSeparated(-99)).toBe("-99");
      expect(formatValueForCommaSeparated("42")).toBe("42");
      expect(formatValueForCommaSeparated("-3.1415")).toBe("-3.1415");
    });

    it("encloses alphanumeric and string values in single quotes with escaping", () => {
      expect(formatValueForCommaSeparated("alice")).toBe("'alice'");
      expect(formatValueForCommaSeparated("user_123")).toBe("'user_123'");
      expect(formatValueForCommaSeparated("O'Connor")).toBe("'O''Connor'");
      expect(formatValueForCommaSeparated("test with spaces")).toBe("'test with spaces'");
    });
  });

  describe("exportToCommaSeparated", () => {
    it("formats 2D grid matrix into comma-separated values", () => {
      const rows = [
        [1, "admin", "active"],
        [2, "john_doe", "pending"],
        [3, "O'Reilly", null],
      ];
      const result = exportToCommaSeparated(rows);
      expect(result).toBe("1, 'admin', 'active', 2, 'john_doe', 'pending', 3, 'O''Reilly', NULL");
    });

    it("handles empty matrix", () => {
      expect(exportToCommaSeparated([])).toBe("");
      expect(exportToCommaSeparated([[]])).toBe("");
    });
  });

  describe("exportToTsv", () => {
    it("exports with and without headers", () => {
      const cols = ["id", "name"];
      const rows = [[1, "test"]];
      expect(exportToTsv(cols, rows, true)).toBe("id\tname\n1\ttest");
      expect(exportToTsv(cols, rows, false)).toBe("1\ttest");
    });
  });
});

