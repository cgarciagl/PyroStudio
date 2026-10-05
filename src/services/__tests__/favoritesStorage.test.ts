import { describe, it, expect, beforeEach } from "vitest";
import { favoritesStorage } from "../favoritesStorage";

describe("favoritesStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("should return preset favorites by default when empty", () => {
    const list = favoritesStorage.getFavorites();
    expect(list.length).toBeGreaterThan(0);
    expect(list.some((f) => f.title.includes("Procesos"))).toBe(true);
  });

  it("should save a new favorite and retrieve it", () => {
    favoritesStorage.saveFavorite({
      title: "Buscar logs recientes",
      category: "Diagnóstico",
      sql: "SELECT * FROM app_logs ORDER BY created_at DESC LIMIT 50;",
      description: "Muestra los 50 logs más recientes del sistema",
    });

    const list = favoritesStorage.getFavorites();
    const found = list.find((f) => f.title === "Buscar logs recientes");
    expect(found).toBeDefined();
    expect(found?.category).toBe("Diagnóstico");
    expect(found?.sql).toContain("app_logs");
  });

  it("should update an existing favorite", () => {
    favoritesStorage.saveFavorite({
      id: "fav-test-1",
      title: "Original Title",
      category: "General",
      sql: "SELECT 1;",
    });

    favoritesStorage.saveFavorite({
      id: "fav-test-1",
      title: "Updated Title",
      category: "Reportes",
      sql: "SELECT 2;",
    });

    const list = favoritesStorage.getFavorites();
    const found = list.find((f) => f.id === "fav-test-1");
    expect(found?.title).toBe("Updated Title");
    expect(found?.category).toBe("Reportes");
    expect(found?.sql).toBe("SELECT 2;");
  });

  it("should delete a favorite by id", () => {
    favoritesStorage.saveFavorite({
      id: "fav-to-delete",
      title: "Temporary",
      category: "General",
      sql: "SELECT 1;",
    });

    expect(favoritesStorage.getFavorites().some((f) => f.id === "fav-to-delete")).toBe(true);

    favoritesStorage.deleteFavorite("fav-to-delete");
    expect(favoritesStorage.getFavorites().some((f) => f.id === "fav-to-delete")).toBe(false);
  });

  it("should filter favorites by category and search term", () => {
    favoritesStorage.saveFavorite({
      title: "Usuarios activos hoy",
      category: "Usuarios",
      sql: "SELECT * FROM users WHERE active = 1;",
    });

    const searchResults = favoritesStorage.searchFavorites("activos");
    expect(searchResults.length).toBe(1);
    expect(searchResults[0].title).toBe("Usuarios activos hoy");

    const categoryResults = favoritesStorage.searchFavorites("", "Usuarios");
    expect(categoryResults.every((f) => f.category === "Usuarios")).toBe(true);
  });
});
