import { describe, expect, it } from "vitest";
import { analyzeCrossDatabase } from "../crossDatabase";

const dbs = ["ventas", "crm", "Logs"];

describe("analyzeCrossDatabase", () => {
  it("ignores queries confined to the active database", () => {
    const r = analyzeCrossDatabase("SELECT c.id FROM clientes c WHERE c.x = 1", "ventas", dbs);
    expect(r.foreignDatabases).toEqual([]);
    expect(r.isWrite).toBe(false);
  });

  it("detects qualified names of other databases", () => {
    expect(analyzeCrossDatabase("SELECT * FROM crm.clientes", "ventas", dbs).foreignDatabases).toEqual(["crm"]);
    expect(analyzeCrossDatabase("DELETE FROM `logs` . `t`", "ventas", dbs)).toEqual({
      foreignDatabases: ["Logs"],
      isWrite: true,
    });
  });

  it("treats the active database qualifier as local", () => {
    expect(analyzeCrossDatabase("UPDATE ventas.t SET a=1", "ventas", dbs).foreignDatabases).toEqual([]);
  });

  it("detects USE as a write that switches database", () => {
    expect(analyzeCrossDatabase("USE crm; SELECT 1", "ventas", dbs)).toEqual({
      foreignDatabases: ["crm"],
      isWrite: true,
    });
  });

  it("ignores names inside strings and comments", () => {
    const r = analyzeCrossDatabase("SELECT 'crm.x' -- crm.y\nFROM t /* USE crm */", "ventas", dbs);
    expect(r.foreignDatabases).toEqual([]);
  });

  it("does not confuse aliases with unknown database names", () => {
    expect(analyzeCrossDatabase("SELECT a.id FROM t a", "ventas", dbs).foreignDatabases).toEqual([]);
  });
});
