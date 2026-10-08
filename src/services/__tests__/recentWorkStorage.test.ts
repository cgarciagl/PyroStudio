import { describe, it, expect, beforeEach } from "vitest";
import { recentWorkStorage } from "../recentWorkStorage";

describe("recentWorkStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns default empty structure when nothing is stored", () => {
    const data = recentWorkStorage.getRecentWork();
    expect(data.lastConnection).toBeNull();
    expect(data.recentTables).toEqual([]);
    expect(data.recentQueries).toEqual([]);
    expect(data.savedSession).toBeNull();
  });

  it("saves last connection and recent databases correctly", () => {
    recentWorkStorage.saveLastConnection({
      profileId: "conn-1",
      profileName: "Servidor Dev",
      environment: "development",
      database: "universidad",
      host: "localhost",
      port: 3306,
      user: "root",
      connectedAt: Date.now(),
    });

    const data = recentWorkStorage.getRecentWork();
    expect(data.lastConnection?.profileName).toBe("Servidor Dev");
    expect(data.lastConnection?.environment).toBe("development");
    expect(data.recentDatabases).toContain("universidad");
  });

  it("records table opened and deduplicates", () => {
    recentWorkStorage.recordTableOpened("universidad", "alumnos");
    recentWorkStorage.recordTableOpened("universidad", "profesores");
    recentWorkStorage.recordTableOpened("universidad", "alumnos");

    const data = recentWorkStorage.getRecentWork();
    expect(data.recentTables.length).toBe(2);
    expect(data.recentTables[0].table).toBe("alumnos");
    expect(data.recentTables[1].table).toBe("profesores");
  });

  it("records queries and truncates long SQL strings safely", () => {
    recentWorkStorage.recordQueryExecuted(
      "test_db",
      "SELECT * FROM users WHERE active = 1 AND created_at > NOW()",
    );
    const data = recentWorkStorage.getRecentWork();
    expect(data.recentQueries.length).toBe(1);
    expect(data.recentQueries[0].sqlPreview).toContain("SELECT * FROM users");
  });

  it("saves and clears session state without throwing", () => {
    recentWorkStorage.saveSessionState({
      connectionProfileId: "conn-1",
      connectionName: "Localhost",
      environment: "local",
      database: "db_test",
      tabs: [
        {
          id: "tab-1",
          title: "usuarios",
          type: "table",
          database: "db_test",
          tableName: "usuarios",
        },
      ],
      activeTabId: "tab-1",
      savedAt: Date.now(),
    });

    let data = recentWorkStorage.getRecentWork();
    expect(data.savedSession?.tabs.length).toBe(1);

    recentWorkStorage.clearSavedSession();
    data = recentWorkStorage.getRecentWork();
    expect(data.savedSession).toBeNull();
  });
});

