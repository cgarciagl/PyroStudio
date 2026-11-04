import { describe, expect, it } from "vitest";
import { exportToCommaSeparated, exportToJsonArray, exportToMarkdownTable, exportToSqlInsert, exportToTsv } from "./formatCopy";

describe("data grid copy and export regression", () => {
  const columns = ["id", "name", "note"];
  const rows = [[1, "Ana", "line\nwith tab\there"], [2, null, "NULL"]];
  it("exports TSV with headers and normalized cell whitespace", () => {
    expect(exportToTsv(columns, rows)).toBe("id\tname\tnote\n1\tAna\tline with tab here\n2\tNULL\tNULL");
    expect(exportToTsv(columns, rows, false)).toBe("1\tAna\tline with tab here\n2\tNULL\tNULL");
  });
  it("exports JSON preserving nulls and column names", () => {
    expect(JSON.parse(exportToJsonArray(columns, rows))).toEqual([{ id: 1, name: "Ana", note: "line\nwith tab\there" }, { id: 2, name: null, note: "NULL" }]);
  });
  it("escapes Markdown separators and represents SQL NULL distinctly", () => {
    const markdown = exportToMarkdownTable(["id", "note"], [[1, "a|b"], [2, null]]);
    expect(markdown).toContain("a\\|b");
    expect(markdown).toContain("*NULL*");
  });
  it("creates SQL INSERT statements with qualified target and NULL literals", () => {
    const sql = exportToSqlInsert("test_db", "users", ["id", "name"], [[1, "Ana"], [2, null]]);
    expect(sql).toContain("INSERT INTO");
    expect(sql).toContain("test_db");
    expect(sql).toContain("NULL");
    expect(sql.split("\n")).toHaveLength(2);
  });
  it("formats numeric and string values in comma-separated output", () => {
    expect(exportToCommaSeparated([[12, "hello", null]])).toBe("12, 'hello', NULL");
  });
});
