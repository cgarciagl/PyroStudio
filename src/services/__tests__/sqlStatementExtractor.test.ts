import { describe, it, expect } from "vitest";
import {
  extractSqlStatements,
  resolveExecutionTarget,
} from "../sqlStatementExtractor";

describe("sqlStatementExtractor", () => {
  describe("extractSqlStatements", () => {
    it("handles single statement without semicolon", () => {
      const sql = "SELECT * FROM users";
      const statements = extractSqlStatements(sql);
      expect(statements).toHaveLength(1);
      expect(statements[0].text).toBe("SELECT * FROM users");
    });

    it("handles single statement with semicolon", () => {
      const sql = "SELECT * FROM users;";
      const statements = extractSqlStatements(sql);
      expect(statements).toHaveLength(1);
      expect(statements[0].text).toBe("SELECT * FROM users");
    });

    it("splits multiple statements cleanly", () => {
      const sql = "SELECT 1; SELECT 2; SELECT 3;";
      const statements = extractSqlStatements(sql);
      expect(statements).toHaveLength(3);
      expect(statements[0].text).toBe("SELECT 1");
      expect(statements[1].text).toBe("SELECT 2");
      expect(statements[2].text).toBe("SELECT 3");
    });

    it("does not split on semicolons inside single or double quotes", () => {
      const sql = "INSERT INTO logs (msg) VALUES ('hello; world'); SELECT \"a;b;c\";";
      const statements = extractSqlStatements(sql);
      expect(statements).toHaveLength(2);
      expect(statements[0].text).toBe("INSERT INTO logs (msg) VALUES ('hello; world')");
      expect(statements[1].text).toBe("SELECT \"a;b;c\"");
    });

    it("does not split on semicolons inside backticks", () => {
      const sql = "SELECT * FROM `my;table;name`; SELECT 2;";
      const statements = extractSqlStatements(sql);
      expect(statements).toHaveLength(2);
      expect(statements[0].text).toBe("SELECT * FROM `my;table;name`");
      expect(statements[1].text).toBe("SELECT 2");
    });

    it("does not split on semicolons inside comments", () => {
      const sql = `
        -- line comment with ; semicolon
        SELECT 1;
        # another comment with ;
        /* block comment; with; semicolons */
        SELECT 2;
      `;
      const statements = extractSqlStatements(sql);
      expect(statements).toHaveLength(2);
      expect(statements[0].text).toContain("SELECT 1");
      expect(statements[1].text).toContain("SELECT 2");
    });
  });

  describe("resolveExecutionTarget", () => {
    it("prioritizes selection when selection is active", () => {
      const fullText = "SELECT 1; SELECT 2; SELECT 3;";
      const target = resolveExecutionTarget({
        fullText,
        selectionText: "SELECT 2",
        cursorOffset: 0,
        preferredMode: "auto",
      });
      expect(target.mode).toBe("selection");
      expect(target.sql).toBe("SELECT 2");
      expect(target.hasSelection).toBe(true);
    });

    it("resolves cursor within the second statement", () => {
      const fullText = "SELECT 1;\nSELECT 2;\nSELECT 3;";
      // 'SELECT 1;\n' is 10 chars. Cursor at 14 is inside 'SELECT 2;'
      const target = resolveExecutionTarget({
        fullText,
        cursorOffset: 14,
        preferredMode: "auto",
      });
      expect(target.mode).toBe("statement");
      expect(target.sql).toBe("SELECT 2");
      expect(target.statementIndex).toBe(1);
      expect(target.totalStatements).toBe(3);
    });

    it("supports explicit 'all' mode", () => {
      const fullText = "SELECT 1; SELECT 2;";
      const target = resolveExecutionTarget({
        fullText,
        cursorOffset: 2,
        preferredMode: "all",
      });
      expect(target.mode).toBe("all");
      expect(target.sql).toBe("SELECT 1; SELECT 2;");
      expect(target.totalStatements).toBe(2);
    });
  });
});

