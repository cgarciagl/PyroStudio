import type { SavedConnection } from "../types/database";
import { dbService } from "./tauriDb";

const STORAGE_KEY = "pyro_saved_connections_v1";
const LAST_ACTIVE_KEY = "pyro_last_active_connection_id";

const DEFAULT_PRESETS: SavedConnection[] = [
  {
    id: "preset-local-3306",
    name: "MariaDB Local (3306)",
    host: "127.0.0.1",
    port: 3306,
    user: "root",
    credentialId: "cred-preset-local-3306",
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
    credentialId: "cred-preset-docker-3307",
    database: "",
    environment: "development",
    colorTag: "#3b82f6",
    createdAt: Date.now(),
  },
];

/**
 * Sanitizes a connection profile before writing to localStorage.
 * STRICT SECURITY REQUIREMENT: Passwords and raw secrets MUST NEVER be written to localStorage.
 */
function sanitizeForLocalStorage(conn: SavedConnection): SavedConnection {
  const sanitized: SavedConnection = {
    ...conn,
    credentialId: conn.credentialId || `cred-${conn.id}`,
  };

  // Strip plaintext passwords
  delete sanitized.password;

  if (sanitized.tunnel) {
    const sanitizedTunnel = {
      ...sanitized.tunnel,
      tunnel_credential_id:
        sanitized.tunnel.tunnel_credential_id || `tunnel-cred-${conn.id}`,
    };
    delete sanitizedTunnel.http_password;
    sanitized.tunnel = sanitizedTunnel;
  }

  return sanitized;
}

export const connectionStorage = {
  getSavedConnections(): SavedConnection[] {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (!data) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_PRESETS));
        return DEFAULT_PRESETS;
      }
      const parsed: SavedConnection[] = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Automatic migration of any legacy stored plaintext passwords
        let needsResave = false;
        const cleaned = parsed.map((item) => {
          let modified = false;
          const cleanItem = { ...item };

          // If legacy password found, migrate to encrypted vault and strip from localStorage
          if (item.password) {
            const credId = item.credentialId || `cred-${item.id}`;
            cleanItem.credentialId = credId;
            dbService.saveCredential(credId, item.password).catch(() => {});
            delete cleanItem.password;
            modified = true;
          }

          if (item.tunnel?.http_password) {
            const tunnelCredId =
              item.tunnel.tunnel_credential_id || `tunnel-cred-${item.id}`;
            if (cleanItem.tunnel) {
              cleanItem.tunnel.tunnel_credential_id = tunnelCredId;
              delete cleanItem.tunnel.http_password;
            }
            dbService.saveCredential(tunnelCredId, item.tunnel.http_password).catch(() => {});
            modified = true;
          }

          if (modified) {
            needsResave = true;
          }
          return cleanItem;
        });

        if (needsResave) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
        }

        return cleaned;
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
      const sanitized = sanitizeForLocalStorage(conn);
      const existingIdx = connections.findIndex((c) => c.id === conn.id);
      let updated: SavedConnection[];

      if (existingIdx !== -1) {
        updated = [...connections];
        updated[existingIdx] = sanitized;
      } else {
        updated = [sanitized, ...connections];
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
      const target = connections.find((c) => c.id === id);
      if (target?.credentialId) {
        dbService.deleteCredential(target.credentialId).catch(() => {});
      }
      if (target?.tunnel?.tunnel_credential_id) {
        dbService.deleteCredential(target.tunnel.tunnel_credential_id).catch(() => {});
      }

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

    const newId = `conn-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const newProfile: SavedConnection = {
      ...source,
      id: newId,
      name: `${source.name} (Copia)`,
      credentialId: `cred-${newId}`,
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
