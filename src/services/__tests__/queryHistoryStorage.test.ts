import { describe, it, expect, beforeEach } from "vitest";
import { queryHistoryStorage } from "../queryHistoryStorage";

describe("queryHistoryStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("should return empty array when no history exists", () => {
    const history = queryHistoryStorage.getHistory();
    expect(history).toEqual([]);
  });

  it("should add entry and retrieve it", () => {
    const entry = queryHistoryStorage.addEntry({
      connectionName: "Local MariaDB",
      database: "test_db",
      sql: "SELECT * FROM users;",
      durationMs: 45,
      success: true,
      affectedRows: 12,
    });

    expect(entry.id).toBeDefined();
    expect(entry.sql).toBe("SELECT * FROM users;");
    expect(entry.database).toBe("test_db");

    const history = queryHistoryStorage.getHistory();
    expect(history.length).toBe(1);
    expect(history[0].id).toBe(entry.id);
  });

  it("should search history entries by text or database", () => {
    queryHistoryStorage.addEntry({
      connectionName: "Local",
      database: "prod_db",
      sql: "SELECT * FROM customers;",
      durationMs: 10,
      success: true,
    });
    queryHistoryStorage.addEntry({
      connectionName: "Local",
      database: "test_db",
      sql: "DELETE FROM orders WHERE id = 1;",
      durationMs: 25,
      success: true,
    });

    const results = queryHistoryStorage.searchHistory("customers");
    expect(results.length).toBe(1);
    expect(results[0].sql).toContain("customers");

    const filteredByDb = queryHistoryStorage.searchHistory("", "test_db");
    expect(filteredByDb.length).toBe(1);
    expect(filteredByDb[0].database).toBe("test_db");
  });

  it("should delete entry by id", () => {
    const e1 = queryHistoryStorage.addEntry({
      connectionName: "Local",
      database: "db1",
      sql: "SELECT 1;",
      durationMs: 5,
      success: true,
    });
    const e2 = queryHistoryStorage.addEntry({
      connectionName: "Local",
      database: "db2",
      sql: "SELECT 2;",
      durationMs: 5,
      success: true,
    });

    expect(queryHistoryStorage.getHistory().length).toBe(2);

    queryHistoryStorage.deleteEntry(e1.id);
    const updated = queryHistoryStorage.getHistory();
    expect(updated.length).toBe(1);
    expect(updated[0].id).toBe(e2.id);
  });

  it("should clear all history entries", () => {
    queryHistoryStorage.addEntry({
      connectionName: "Local",
      database: "db",
      sql: "SELECT 1;",
      durationMs: 5,
      success: true,
    });
    queryHistoryStorage.clearHistory();
    expect(queryHistoryStorage.getHistory().length).toBe(0);
  });
});
