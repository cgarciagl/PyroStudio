import { describe, it, expect } from "vitest";
import { sqlHint } from "../FavoritesList";

describe("sqlHint", () => {
  it("shows the SQL on one line without comments", () => {
    expect(sqlHint("-- totales\nSELECT a,\n       b\nFROM t;")).toBe("SELECT a, b FROM t;");
  });
});
