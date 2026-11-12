import { describe, it, expect, beforeEach } from "vitest";
import { favoritesStorage } from "../favoritesStorage";

describe("built-in queries per engine", () => {
  beforeEach(() => localStorage.clear());

  it("offers SHOW PROCESSLIST only on MySQL/MariaDB and PRAGMA queries only on SQLite", () => {
    const list = favoritesStorage.getFavorites();
    const processlist = list.find((f) => f.sql.includes("PROCESSLIST"))!;
    const integrity = list.find((f) => f.sql.includes("integrity_check"))!;
    expect(favoritesStorage.fitsActiveEngine(processlist, "mysql")).toBe(true);
    expect(favoritesStorage.fitsActiveEngine(processlist, "sqlite")).toBe(false);
    expect(favoritesStorage.fitsActiveEngine(integrity, "sqlite")).toBe(true);
    expect(favoritesStorage.fitsActiveEngine(integrity, "mysql")).toBe(false);
  });

  it("tags presets stored before the engine field existed, and keeps user queries everywhere", () => {
    const legacy = { id: "fav-preset-connections", title: "x", category: "D", sql: "SHOW FULL PROCESSLIST;", createdAt: 0, updatedAt: 0 };
    expect(favoritesStorage.fitsActiveEngine(legacy, "sqlite")).toBe(false);
    const mine = { id: "fav-1", title: "Mía", category: "General", sql: "SELECT 1;", createdAt: 0, updatedAt: 0 };
    expect(favoritesStorage.fitsActiveEngine(mine, "sqlite")).toBe(true);
  });

  it("adds new presets to an existing list once, without restoring deleted ones", () => {
    // List seeded by an older version, where the user deleted the PROCESSLIST preset.
    const old = favoritesStorage.getFavorites().filter(
      (f) => !f.id.startsWith("fav-preset-sqlite") && f.id !== "fav-preset-connections",
    );
    localStorage.clear();
    localStorage.setItem("pyro_sql_favorites_v1", JSON.stringify(old));

    const list = favoritesStorage.getFavorites();
    expect(list.some((f) => f.id === "fav-preset-connections")).toBe(false);
    expect(list.some((f) => f.id === "fav-preset-sqlite-integrity")).toBe(true);

    // Deleting a new preset sticks.
    favoritesStorage.deleteFavorite("fav-preset-sqlite-integrity");
    expect(favoritesStorage.getFavorites().some((f) => f.id === "fav-preset-sqlite-integrity")).toBe(false);
  });
});
