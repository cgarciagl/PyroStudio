import { describe, expect, it } from "vitest";
import { extractSqlStatements, resolveExecutionTarget } from "./sqlStatementExtractor";

describe("SQL editor execution regression", () => {
  const script = "SELECT 1 AS first_value;\nSELECT 2 AS second_value;";

  it("executes only the statement under the cursor in statement mode", () => {
    const result = resolveExecutionTarget({ fullText: script, cursorOffset: script.indexOf("SELECT 2"), preferredMode: "statement" });
    expect(result.mode).toBe("statement");
    expect(result.statementIndex).toBe(1);
    expect(result.sql).toBe("SELECT 2 AS second_value");
    expect(result.totalStatements).toBe(2);
  });

  it("executes the selected SQL when selection mode is requested", () => {
    const result = resolveExecutionTarget({ fullText: script, selectionText: "SELECT 9", cursorOffset: 0, preferredMode: "selection" });
    expect(result.mode).toBe("selection");
    expect(result.sql).toBe("SELECT 9");
    expect(result.hasSelection).toBe(true);
  });

  it("executes the complete script in all mode even when a selection exists", () => {
    const result = resolveExecutionTarget({ fullText: script, selectionText: "SELECT 9", preferredMode: "all" });
    expect(result.mode).toBe("all");
    expect(result.sql).toBe(script.trim());
    expect(result.totalStatements).toBe(2);
  });

  it("does not split semicolons inside strings or comments", () => {
    const statements = extractSqlStatements("SELECT 'a;b'; -- ; comment\nSELECT 2;");
    expect(statements).toHaveLength(2);
    expect(statements[0].text).toBe("SELECT 'a;b'");
    expect(statements[1].text).toBe("-- ; comment\nSELECT 2");
  });
});
