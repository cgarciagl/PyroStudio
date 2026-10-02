import type { SavedConnection } from "../types/database";

const STORAGE_KEY = "pyro_saved_connections_v1";
const LAST_ACTIVE_KEY = "pyro_last_active_connection_id";

const DEFAULT_PRESETS: SavedConnection[] = [
  {
    id: "preset-local-3306",
    name: "MariaDB Local (3306)",
    host: "127.0.0.1",
    port: 3306,
    user: "root",
    password: "",
    database: "",
    environment: "local",
    colorTag: "#ff5c16",
    createdAt: Date.now(),
  },
  {
    id: "preset-docker-3307",
    name: "Docker MariaDB (3307)",
    host: "127.0.0.1",
    port: 3307,
    user: "root",
    password: "",
    database: "",
    environment: "development",
    colorTag: "#3b82f6",
    createdAt: Date.now(),
  },
];

export const connectionStorage = {
  getSavedConnections(): SavedConnection[] {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (!data) {
        // Initialize with default presets on first launch
        localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_PRESETS));
        return DEFAULT_PRESETS;
      }
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
      return DEFAULT_PRESETS;
    } catch (e) {
      console.warn("Failed to read saved connections from localStorage:", e);
      return DEFAULT_PRESETS;
    }
  },

  saveConnection(conn: SavedConnection): SavedConnection[] {
    try {
      const connections = this.getSavedConnections();
      const existingIdx = connections.findIndex((c) => c.id === conn.id);
      let updated: SavedConnection[];

      if (existingIdx !== -1) {
        updated = [...connections];
        updated[existingIdx] = { ...conn };
      } else {
        updated = [conn, ...connections];
      }

      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    } catch (e) {
      console.error("Failed to save connection profile to localStorage:", e);
      return [];
    }
  },

  deleteConnection(id: string): SavedConnection[] {
    try {
      const connections = this.getSavedConnections();
      const updated = connections.filter((c) => c.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));

      if (this.getLastActiveProfileId() === id) {
        localStorage.removeItem(LAST_ACTIVE_KEY);
      }
      return updated;
    } catch (e) {
      console.error("Failed to delete connection profile:", e);
      return [];
    }
  },

  duplicateConnection(id: string): SavedConnection[] {
    const connections = this.getSavedConnections();
    const source = connections.find((c) => c.id === id);
    if (!source) return connections;

    const newProfile: SavedConnection = {
      ...source,
      id: `conn-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      name: `${source.name} (Copia)`,
      createdAt: Date.now(),
      lastConnectedAt: undefined,
    };

    return this.saveConnection(newProfile);
  },

  markConnected(id: string): void {
    try {
      const connections = this.getSavedConnections();
      const idx = connections.findIndex((c) => c.id === id);
      if (idx !== -1) {
        connections[idx].lastConnectedAt = Date.now();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(connections));
      }
      localStorage.setItem(LAST_ACTIVE_KEY, id);
    } catch (e) {
      console.warn("Failed to mark connection as active:", e);
    }
  },

  getLastActiveProfileId(): string | null {
    try {
      return localStorage.getItem(LAST_ACTIVE_KEY);
    } catch {
      return null;
    }
  },

  setLastActiveProfileId(id: string): void {
    try {
      localStorage.setItem(LAST_ACTIVE_KEY, id);
    } catch (e) {
      console.warn("Failed to set last active profile id:", e);
    }
  },
};
