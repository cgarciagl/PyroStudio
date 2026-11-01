import { describe, expect, it } from "vitest";
import { parseColumnType } from "../EditColumnModal";

describe("parseColumnType", () => {
  it("keeps UNSIGNED and ZEROFILL as attributes", () => {
    expect(parseColumnType("int(10) unsigned zerofill")).toEqual({
      base: "INT",
      length: "10",
      attributes: "unsigned zerofill",
    });
  });

  it("reads ENUM values with parentheses and accents inside quotes", () => {
    expect(parseColumnType("enum('sí','a(b)','c')")).toEqual({
      base: "ENUM",
      length: "'sí','a(b)','c'",
      attributes: "",
    });
  });

  it("handles types without length", () => {
    expect(parseColumnType("bigint unsigned")).toEqual({ base: "BIGINT", length: "", attributes: "unsigned" });
    expect(parseColumnType("text")).toEqual({ base: "TEXT", length: "", attributes: "" });
    expect(parseColumnType("decimal(10,2)")).toEqual({ base: "DECIMAL", length: "10,2", attributes: "" });
  });
});
