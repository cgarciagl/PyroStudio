import { describe, expect, it } from "vitest";
import { applyEnvVariables, formatVariableLines, parseVariableLines } from "../envVariables";

describe("applyEnvVariables", () => {
  it("replaces known variables and keeps the rest", () => {
    const { sql, missing } = applyEnvVariables("SELECT * FROM ${schema}.t WHERE x = '${tenant}' AND ${otra}", {
      schema: "tienda_dev",
      tenant: "acme",
    });
    expect(sql).toBe("SELECT * FROM tienda_dev.t WHERE x = 'acme' AND ${otra}");
    expect(missing).toEqual(["otra"]);
  });

  it("does nothing without an active environment", () => {
    expect(applyEnvVariables("SELECT ${a}", null)).toEqual({ sql: "SELECT ${a}", missing: [] });
  });
});

describe("variable lines", () => {
  it("round-trips name=value lines", () => {
    const vars = parseVariableLines("# comentario\nschema = tienda\n\nurl=a=b\nmal\n");
    expect(vars).toEqual({ schema: "tienda", url: "a=b" });
    expect(parseVariableLines(formatVariableLines(vars))).toEqual(vars);
  });
});
