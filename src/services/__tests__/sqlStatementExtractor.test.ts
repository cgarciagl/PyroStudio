import { describe, it, expect } from "vitest";
import {
  extractSqlStatements,
  isDdlQuery,
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

    it("handles doubled quotes and backticks without prematurely cutting statements", () => {
      const sql = "INSERT INTO users (bio) VALUES ('It''s a test; yes it is'); SELECT \"He said \"\"Hello; world\"\"\"; SELECT `col``name;with;semicolon`;";
      const statements = extractSqlStatements(sql);
      expect(statements).toHaveLength(3);
      expect(statements[0].text).toBe("INSERT INTO users (bio) VALUES ('It''s a test; yes it is')");
      expect(statements[1].text).toBe("SELECT \"He said \"\"Hello; world\"\"\"");
      expect(statements[2].text).toBe("SELECT `col``name;with;semicolon`");
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

  describe("isDdlQuery", () => {
    it("identifies standard DDL statements", () => {
      expect(isDdlQuery("CREATE TABLE users (id INT);")).toBe(true);
      expect(isDdlQuery("ALTER TABLE users ADD COLUMN name VARCHAR(50);")).toBe(true);
      expect(isDdlQuery("DROP TABLE users;")).toBe(true);
      expect(isDdlQuery("RENAME TABLE old_name TO new_name;")).toBe(true);
      expect(isDdlQuery("TRUNCATE TABLE logs;")).toBe(true);
    });

    it("identifies DDL statements with leading whitespace and comments", () => {
      expect(isDdlQuery("   \n\t  CREATE VIEW v AS SELECT 1;")).toBe(true);
      expect(isDdlQuery("-- Comment\n/* block */\nDROP VIEW v;")).toBe(true);
      expect(isDdlQuery("# Hash comment\nALTER TABLE t DROP COLUMN c;")).toBe(true);
    });

    it("rejects non-DDL statements", () => {
      expect(isDdlQuery("SELECT * FROM users;")).toBe(false);
      expect(isDdlQuery("INSERT INTO users VALUES (1);")).toBe(false);
      expect(isDdlQuery("UPDATE users SET name = 'a';")).toBe(false);
      expect(isDdlQuery("DELETE FROM users;")).toBe(false);
      expect(isDdlQuery("")).toBe(false);
    });
  });
});

