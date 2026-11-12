import { describe, it, expect } from "vitest";
import { buildFilterSql, sqlLiteral, validateFilter, type FilterRule } from "../filterSql";

const rule = (over: Partial<FilterRule>): FilterRule => ({
  id: over.id ?? "r1",
  enabled: true,
  column: "nombre",
  operator: "=",
  value: "",
  connector: "AND",
  ...over,
});

describe("filterSql fixes", () => {
  it("'does not begin with' excludes only the prefix (was NOT LIKE '%x%')", () => {
    expect(buildFilterSql([rule({ operator: "does not begin with", value: "ab" })])).toBe("`nombre` NOT LIKE 'ab%'");
  });

  it("takes % and _ literally in text operators", () => {
    expect(buildFilterSql([rule({ operator: "contains", value: "50%" })])).toBe("`nombre` LIKE '%50!%%' ESCAPE '!'");
    expect(buildFilterSql([rule({ operator: "begins with", value: "user_1" })])).toBe("`nombre` LIKE 'user!_1%' ESCAPE '!'");
    // Ordinary values keep the same SQL as before.
    expect(buildFilterSql([rule({ operator: "contains", value: "119" })])).toBe("`nombre` LIKE '%119%'");
  });

  it("keeps leading zeros as text", () => {
    expect(sqlLiteral("007")).toBe("'007'");
    expect(sqlLiteral("7")).toBe("7");
    expect(sqlLiteral("-3.5")).toBe("-3.5");
    expect(buildFilterSql([rule({ operator: "is in list", value: "007, 8" })])).toBe("`nombre` IN ('007', 8)");
  });
});

describe("validateFilter", () => {
  it("flags missing values but allows = '' and unary operators", () => {
    const issues = validateFilter([
      rule({ id: "a", operator: "is between", value: "1" }),
      rule({ id: "b", operator: "contains", value: "" }),
      rule({ id: "c", operator: "=", value: "" }),
      rule({ id: "d", operator: "is null" }),
      rule({ id: "e", operator: "contains", value: "", enabled: false }),
    ]);
    expect(Object.keys(issues.byRule).sort()).toEqual(["a", "b"]);
    expect(issues.global).toBeUndefined();
  });

  it("detects unbalanced parentheses", () => {
    expect(validateFilter([rule({ value: "x", openParen: true })]).global).toBe("Falta cerrar un paréntesis.");
    expect(validateFilter([rule({ value: "x", closeParen: true })]).global).toContain("cierre sin su apertura");
    expect(validateFilter([rule({ value: "x", openParen: true, closeParen: true })]).global).toBeUndefined();
  });
});
