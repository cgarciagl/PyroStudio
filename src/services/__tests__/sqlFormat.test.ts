import { describe, it, expect } from "vitest";
import { formatSql } from "../sqlFormat";
import { DEFAULT_SQL_FORMAT } from "../../stores/preferenceStore";

describe("formatSql", () => {
  it("formats with uppercase keywords by default", () => {
    const out = formatSql("select a, b from t where a = 1 and b = 2", DEFAULT_SQL_FORMAT);
    expect(out).toContain("SELECT");
    expect(out).toContain("\n  AND b = 2");
  });

  it("honors lowercase keywords and tab indentation", () => {
    const out = formatSql("SELECT a FROM t", { ...DEFAULT_SQL_FORMAT, keywordCase: "lower", indent: "tab" });
    expect(out).toBe("select\n\ta\nfrom\n\tt");
  });

  it("keeps named placeholders", () => {
    expect(formatSql("select * from t where id = :id", DEFAULT_SQL_FORMAT)).toContain(":id");
  });
});
