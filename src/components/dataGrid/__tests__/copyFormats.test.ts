import { describe, it, expect } from "vitest";
import { buildSmartCopyOutput } from "../copyFormats";
import { exportToJsonArray, exportToSqlInsert, exportToTsv } from "../../../utils/formatCopy";

const cols = ["id", "name"];
const rows = [[1, "ana"], [2, null]];
const opts = { database: "shop", table: "users", dialect: undefined };

describe("buildSmartCopyOutput", () => {
  it("delegates each format to its exporter", () => {
    expect(buildSmartCopyOutput("tsv", cols, rows, opts)).toBe(exportToTsv(cols, rows, true));
    expect(buildSmartCopyOutput("json", cols, rows, opts)).toBe(exportToJsonArray(cols, rows));
    expect(buildSmartCopyOutput("sql", cols, rows, opts)).toBe(exportToSqlInsert("shop", "users", cols, rows));
  });
  it("produces non-empty output for every format", () => {
    for (const f of ["tsv", "comma", "sql", "json", "markdown", "php", "ts"] as const) {
      expect(buildSmartCopyOutput(f, cols, rows, opts).length).toBeGreaterThan(0);
    }
  });
});
