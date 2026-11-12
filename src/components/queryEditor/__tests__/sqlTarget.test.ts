import { describe, it, expect } from "vitest";
import { extractTargetTableAndDb } from "../sqlTarget";

describe("extractTargetTableAndDb", () => {
  it("finds the table of SELECT / UPDATE / INSERT", () => {
    expect(extractTargetTableAndDb("SELECT * FROM users WHERE id = 1")).toEqual({ db: null, table: "users" });
    expect(extractTargetTableAndDb("UPDATE `shop`.`orders` SET x = 1")).toEqual({ db: "shop", table: "orders" });
    expect(extractTargetTableAndDb("INSERT INTO logs VALUES (1)")).toEqual({ db: null, table: "logs" });
  });
  it("ignores comments", () => {
    expect(extractTargetTableAndDb("-- FROM wrong\n/* FROM nope */ SELECT 1 FROM right_one")).toEqual({
      db: null,
      table: "right_one",
    });
  });
  it("returns nothing without a table", () => {
    expect(extractTargetTableAndDb("SELECT 1")).toEqual({ db: null, table: null });
  });
});
