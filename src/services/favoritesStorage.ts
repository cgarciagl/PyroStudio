import type { SqlFavorite } from "../types/database";
import type { WorkspaceQuery } from "../types/workspace";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { WorkspaceError, queryToFavorite, workspaceService } from "./workspaceService";

function inWorkspace(): boolean {
  return useWorkspaceStore.getState().isFolderMode();
}

/** Thrown when a workspace file changed on disk since it was loaded. */
export class FavoriteConflictError extends Error {
  constructor(public favoriteId: string) {
    super("La consulta cambió en disco desde que se abrió.");
    this.name = "FavoriteConflictError";
  }
}

export type FavoriteInput = Omit<SqlFavorite, "id" | "createdAt" | "updatedAt"> & { id?: string };

/** Fired on window whenever saved queries change (any storage mode). */
export const FAVORITES_CHANGED_EVENT = "pyro:favorites-changed";

function notifyChanged() {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new Event(FAVORITES_CHANGED_EVENT));
  }
}

/** New ids are assigned on the client so callers can link tabs to the saved query. */
export function newFavoriteId(): string {
  return `fav-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
}

const FAVORITES_STORAGE_KEY = "pyro_sql_favorites_v1";

export const DEFAULT_FAVORITE_CATEGORIES = [
  "Todos",
  "Diagnóstico",
  "Usuarios",
  "Reportes",
  "Administración",
  "Rendimiento",
] as const;

const PRESET_FAVORITES: SqlFavorite[] = [
  {
    id: "fav-preset-connections",
    title: "Procesos y Conexiones Activas",
    category: "Diagnóstico",
    sql: "SHOW FULL PROCESSLIST;",
    description: "Muestra todos los hilos y consultas en ejecución actualmente en el servidor.",
    createdAt: Date.now() - 100000,
    updatedAt: Date.now() - 100000,
  },
  {
    id: "fav-preset-table-sizes",
    title: "Tamaño de Tablas y Datos",
    category: "Reportes",
    sql: `SELECT 
    TABLE_SCHEMA AS 'Base de Datos',
    TABLE_NAME AS 'Tabla',
    ROUND((DATA_LENGTH + INDEX_LENGTH) / 1024 / 1024, 2) AS 'Tamaño (MB)',
    TABLE_ROWS AS 'Filas Estimadas',
    ENGINE AS 'Motor'
FROM information_schema.TABLES
WHERE TABLE_SCHEMA NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
ORDER BY (DATA_LENGTH + INDEX_LENGTH) DESC
LIMIT 25;`,
    description: "Calcula las tablas más pesadas en disco ordenadas por consumo total de MB.",
    createdAt: Date.now() - 90000,
    updatedAt: Date.now() - 90000,
  },
  {
    id: "fav-preset-users",
    title: "Usuarios y Privilegios Globales",
    category: "Usuarios",
    sql: "SELECT User, Host, plugin, authentication_string FROM mysql.user ORDER BY User;",
    description: "Lista las cuentas de usuario registradas en MariaDB/MySQL con su host y método de autenticación.",
    createdAt: Date.now() - 80000,
    updatedAt: Date.now() - 80000,
  },
  {
    id: "fav-preset-status",
    title: "Variables Globales de Rendimiento",
    category: "Rendimiento",
    sql: "SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected', 'Threads_running', 'Uptime', 'Questions', 'Slow_queries');",
    description: "Métricas operativas del servidor: conexiones activas, uptime y conteo de consultas lentas.",
    createdAt: Date.now() - 70000,
    updatedAt: Date.now() - 70000,
  },
  {
    id: "fav-preset-open-tables",
    title: "Tablas Abiertas en Cache",
    category: "Administración",
    sql: "SHOW OPEN TABLES WHERE In_use > 0;",
    description: "Inspecciona tablas bloqueadas o en uso por transacciones activas.",
    createdAt: Date.now() - 60000,
    updatedAt: Date.now() - 60000,
  },
];

export const favoritesStorage = {
  getFavorites(): SqlFavorite[] {
    if (inWorkspace()) {
      // Built-in presets are shown but never copied into the workspace; a workspace
      // file with the same id (an edited preset) takes precedence.
      const fromDisk = useWorkspaceStore.getState().queries.map(queryToFavorite);
      const ids = new Set(fromDisk.map((f) => f.id));
      return [...fromDisk, ...PRESET_FAVORITES.filter((p) => !ids.has(p.id))];
    }
    try {
      const data = localStorage.getItem(FAVORITES_STORAGE_KEY);
      if (!data) {
        localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(PRESET_FAVORITES));
        return PRESET_FAVORITES;
      }
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
      return PRESET_FAVORITES;
    } catch (e) {
      console.warn("Failed to load SQL favorites from localStorage:", e);
      return PRESET_FAVORITES;
    }
  },

  saveFavorite(fav: Omit<SqlFavorite, "id" | "createdAt" | "updatedAt"> & { id?: string }): SqlFavorite[] {
    try {
      const list = this.getFavorites();
      const now = Date.now();
      let updated: SqlFavorite[];

      if (fav.id) {
        const existingIdx = list.findIndex((f) => f.id === fav.id);
        if (existingIdx !== -1) {
          const updatedItem: SqlFavorite = {
            ...list[existingIdx],
            title: fav.title.trim(),
            category: fav.category.trim() || "General",
            sql: fav.sql.trim(),
            description: fav.description?.trim(),
            connectionId: fav.connectionId || undefined,
            database: fav.connectionId ? fav.database || undefined : undefined,
            folder: fav.connectionId ? fav.folder?.trim() || undefined : undefined,
            updatedAt: now,
          };
          updated = [...list];
          updated[existingIdx] = updatedItem;
        } else {
          const newItem: SqlFavorite = {
            id: fav.id,
            title: fav.title.trim(),
            category: fav.category.trim() || "General",
            sql: fav.sql.trim(),
            description: fav.description?.trim(),
            connectionId: fav.connectionId || undefined,
            database: fav.connectionId ? fav.database || undefined : undefined,
            folder: fav.connectionId ? fav.folder?.trim() || undefined : undefined,
            createdAt: now,
            updatedAt: now,
          };
          updated = [newItem, ...list];
        }
      } else {
        const newItem: SqlFavorite = {
          id: `fav-${now}-${Math.random().toString(36).substring(2, 7)}`,
          title: fav.title.trim(),
          category: fav.category.trim() || "General",
          sql: fav.sql.trim(),
          description: fav.description?.trim(),
          connectionId: fav.connectionId || undefined,
          database: fav.connectionId ? fav.database || undefined : undefined,
          folder: fav.connectionId ? fav.folder?.trim() || undefined : undefined,
          createdAt: now,
          updatedAt: now,
        };
        updated = [newItem, ...list];
      }

      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(updated));
      return updated;
    } catch (e) {
      console.error("Failed to save SQL favorite:", e);
      return [];
    }
  },

  deleteFavorite(id: string): SqlFavorite[] {
    try {
      const list = this.getFavorites();
      const updated = list.filter((f) => f.id !== id);
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(updated));
      return updated;
    } catch (e) {
      console.error("Failed to delete SQL favorite:", e);
      return [];
    }
  },

  getCategories(): string[] {
    const list = this.getFavorites();
    const catSet = new Set<string>();
    catSet.add("Todos");
    for (const c of DEFAULT_FAVORITE_CATEGORIES) {
      catSet.add(c);
    }
    for (const f of list) {
      if (f.category) {
        catSet.add(f.category);
      }
    }
    return Array.from(catSet);
  },

  /** Queries saved for a given connection + database (most recent first). */
  forDatabase(connectionId: string | undefined, database: string): SqlFavorite[] {
    if (!connectionId) return [];
    return this.getFavorites()
      .filter((f) => f.connectionId === connectionId && f.database === database)
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  },

  searchFavorites(term: string, categoryFilter?: string): SqlFavorite[] {
    const list = this.getFavorites();
    const cleanTerm = term.toLowerCase().trim();

    return list.filter((item) => {
      if (categoryFilter && categoryFilter !== "Todos" && item.category !== categoryFilter) {
        return false;
      }
      if (!cleanTerm) return true;
      return (
        item.title.toLowerCase().includes(cleanTerm) ||
        item.sql.toLowerCase().includes(cleanTerm) ||
        (item.description && item.description.toLowerCase().includes(cleanTerm)) ||
        item.category.toLowerCase().includes(cleanTerm)
      );
    });
  },

  // ─── Async API (works for both local storage and folder workspaces) ────────

  isPreset(id: string): boolean {
    return PRESET_FAVORITES.some((p) => p.id === id);
  },

  workspaceQuery(id: string): WorkspaceQuery | undefined {
    return useWorkspaceStore.getState().queries.find((q) => q.id === id);
  },

  /**
   * Saves a favorite. In a workspace it is written as a `.sql` file; if the file
   * changed externally it rejects with FavoriteConflictError unless `mode` says
   * how to resolve it ("overwrite" or "copy").
   */
  async persistFavorite(fav: FavoriteInput, mode?: "overwrite" | "copy"): Promise<SqlFavorite[]> {
    if (!inWorkspace()) {
      const list = this.saveFavorite(fav);
      notifyChanged();
      return list;
    }
    if (useWorkspaceStore.getState().status?.availability !== "available") {
      throw new WorkspaceError("WS_UNAVAILABLE", "El workspace no está disponible; la consulta no se ha guardado.");
    }
    const existing = fav.id ? this.workspaceQuery(fav.id) : undefined;
    const asCopy = mode === "copy";
    try {
      await workspaceService.saveQuery({
        id: asCopy ? undefined : fav.id,
        title: asCopy ? `${fav.title.trim()} (copia local)` : fav.title,
        category: fav.category,
        sql: fav.sql.trim(),
        description: fav.description?.trim(),
        connectionId: fav.connectionId || undefined,
        database: fav.connectionId ? fav.database || undefined : undefined,
        folder: fav.connectionId ? fav.folder?.trim() || undefined : undefined,
        expectedHash: asCopy ? undefined : existing?.contentHash,
        force: mode === "overwrite",
      });
    } catch (e) {
      if (e instanceof WorkspaceError && e.code === "WS_CONFLICT" && fav.id) {
        throw new FavoriteConflictError(fav.id);
      }
      throw e;
    }
    await useWorkspaceStore.getState().reload();
    notifyChanged();
    return this.getFavorites();
  },

  async removeFavorite(id: string): Promise<SqlFavorite[]> {
    if (!inWorkspace()) {
      const list = this.deleteFavorite(id);
      notifyChanged();
      return list;
    }
    const existing = this.workspaceQuery(id);
    if (!existing) {
      throw new WorkspaceError("WS_NOT_FOUND", "Las consultas predefinidas de PyroStudio no se pueden eliminar.");
    }
    try {
      await workspaceService.deleteQuery(id, existing.contentHash);
    } catch (e) {
      if (e instanceof WorkspaceError && e.code === "WS_CONFLICT") throw new FavoriteConflictError(id);
      throw e;
    }
    await useWorkspaceStore.getState().reload();
    notifyChanged();
    return this.getFavorites();
  },

  /**
   * Legacy favorites worth migrating: everything except untouched built-in presets.
   * Reads localStorage without modifying it.
   */
  readLegacyFavorites(): SqlFavorite[] {
    try {
      const data = localStorage.getItem(FAVORITES_STORAGE_KEY);
      const parsed: SqlFavorite[] = data ? JSON.parse(data) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((f) => {
        const preset = PRESET_FAVORITES.find((p) => p.id === f.id);
        return (
          !preset ||
          preset.sql !== f.sql ||
          preset.title !== f.title ||
          preset.category !== f.category ||
          (preset.description ?? "") !== (f.description ?? "")
        );
      });
    } catch {
      return [];
    }
  },
};
