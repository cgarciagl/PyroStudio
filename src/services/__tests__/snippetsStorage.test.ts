import { describe, expect, it } from "vitest";
import { DEFAULT_SNIPPETS, describeSnippetBody } from "../snippetsStorage";

describe("snippets", () => {
  it("resume los huecos y variables del cuerpo", () => {
    expect(describeSnippetBody("SELECT * FROM ${tabla} WHERE id = :id AND x = ${tabla}")).toBe(
      "tabla, :id",
    );
    // `::` casts and timestamps are not variables.
    expect(describeSnippetBody("SELECT '10:30', a::text")).toBe("");
  });

  it("los snippets por defecto tienen prefijos únicos sin espacios", () => {
    const prefixes = DEFAULT_SNIPPETS.map((s) => s.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(prefixes.every((p) => !/\s/.test(p))).toBe(true);
  });
});
