import type { SavedConnection } from "../types/database";
import { dbService } from "./tauriDb";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { WorkspaceError, workspaceService } from "./workspaceService";

const STORAGE_KEY = "pyro_saved_connections_v1";
const LAST_ACTIVE_KEY = "pyro_last_active_connection_id";
// Per-computer "last connected" timestamps for workspace connections (never shared).
const WORKSPACE_LAST_CONNECTED_KEY = "pyro_workspace_last_connected_v1";

function readLastConnectedMap(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(WORKSPACE_LAST_CONNECTED_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

/** True when connections live in a folder workspace instead of localStorage. */
function inWorkspace(): boolean {
  return useWorkspaceStore.getState().isFolderMode();
}

function assertWorkspaceWritable(): void {
  const { status } = useWorkspaceStore.getState();
  if (status?.availability !== "available") {
    throw new WorkspaceError(
      "WS_UNAVAILABLE",
      "El workspace no está disponible; los cambios no se han guardado en ningún otro sitio."
    );
  }
}

function credentialIdsOf(connection: SavedConnection): string[] {
  return [
    connection.credentialId || `cred-${connection.id}`,
    connection.tunnel?.tunnel_credential_id || `tunnel-cred-${connection.id}`,
    connection.tunnel?.token_credential_id || `tunnel-token-cred-${connection.id}`,
  ];
}

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
      token_credential_id:
        sanitized.tunnel.token_credential_id || `tunnel-token-cred-${conn.id}`,
    };
    delete sanitizedTunnel.http_password;
    delete sanitizedTunnel.auth_token;
    sanitized.tunnel = sanitizedTunnel;
  }

  return sanitized;
}

export const connectionStorage = {
  getSavedConnections(): SavedConnection[] {
    if (inWorkspace()) {
      const lastMap = readLastConnectedMap();
      return useWorkspaceStore
        .getState()
        .connections.map((c) => ({ ...c, lastConnectedAt: lastMap[c.id] ?? c.lastConnectedAt }));
    }
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
      const updated = connections.filter((c) => c.id !== id);
      const isCredentialStillUsed = (credentialId: string) =>
        updated.some((connection) => {
          const ids = [
            connection.credentialId || `cred-${connection.id}`,
            connection.tunnel?.tunnel_credential_id ||
              `tunnel-cred-${connection.id}`,
            connection.tunnel?.token_credential_id ||
              `tunnel-token-cred-${connection.id}`,
          ];
          return ids.includes(credentialId);
        });
      if (target?.credentialId && !isCredentialStillUsed(target.credentialId)) {
        dbService.deleteCredential(target.credentialId).catch(() => {});
      }
      if (
        target?.tunnel?.tunnel_credential_id &&
        !isCredentialStillUsed(target.tunnel.tunnel_credential_id)
      ) {
        dbService.deleteCredential(target.tunnel.tunnel_credential_id).catch(() => {});
      }
      if (
        target?.tunnel?.token_credential_id &&
        !isCredentialStillUsed(target.tunnel.token_credential_id)
      ) {
        dbService.deleteCredential(target.tunnel.token_credential_id).catch(() => {});
      }

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
    if (inWorkspace()) {
      try {
        const map = readLastConnectedMap();
        map[id] = Date.now();
        localStorage.setItem(WORKSPACE_LAST_CONNECTED_KEY, JSON.stringify(map));
        localStorage.setItem(LAST_ACTIVE_KEY, id);
      } catch (e) {
        console.warn("Failed to mark connection as active:", e);
      }
      return;
    }
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

  // ─── Async API (works for both local storage and folder workspaces) ────────
  // Resolves only after the write is confirmed; rejects with WorkspaceError.

  async persistConnection(conn: SavedConnection): Promise<SavedConnection[]> {
    if (!inWorkspace()) return this.saveConnection(conn);
    assertWorkspaceWritable();
    await workspaceService.saveConnection(conn);
    await useWorkspaceStore.getState().reload();
    return this.getSavedConnections();
  },

  async removeConnection(id: string): Promise<SavedConnection[]> {
    if (!inWorkspace()) return this.deleteConnection(id);
    assertWorkspaceWritable();
    const target = this.getSavedConnections().find((c) => c.id === id);
    await workspaceService.deleteConnection(id);
    await useWorkspaceStore.getState().reload();
    const remaining = this.getSavedConnections();
    // Local secrets are removed only on explicit deletion, and only when unused.
    if (target) {
      const stillUsed = new Set(remaining.flatMap(credentialIdsOf));
      for (const credId of credentialIdsOf(target)) {
        if (!stillUsed.has(credId)) dbService.deleteCredential(credId).catch(() => {});
      }
    }
    if (this.getLastActiveProfileId() === id) localStorage.removeItem(LAST_ACTIVE_KEY);
    return remaining;
  },

  async duplicateConnectionAsync(id: string): Promise<SavedConnection[]> {
    if (!inWorkspace()) return this.duplicateConnection(id);
    const source = this.getSavedConnections().find((c) => c.id === id);
    if (!source) return this.getSavedConnections();
    const newId = `conn-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const { tunnel } = source;
    return this.persistConnection({
      ...source,
      id: newId,
      name: `${source.name} (Copia)`,
      credentialId: `cred-${newId}`,
      tunnel: tunnel
        ? { ...tunnel, tunnel_credential_id: `tunnel-cred-${newId}`, token_credential_id: `tunnel-token-cred-${newId}` }
        : undefined,
      createdAt: Date.now(),
      lastConnectedAt: undefined,
    });
  },

  /** Moves a connection into a folder (null/empty = no folder). */
  async moveToFolder(id: string, folder: string | null): Promise<SavedConnection[]> {
    const conn = this.getSavedConnections().find((c) => c.id === id);
    if (!conn) return this.getSavedConnections();
    const next = (folder ?? "").trim() || undefined;
    if ((conn.folder ?? undefined) === next) return this.getSavedConnections();
    return this.persistConnection({ ...conn, folder: next });
  },

  /** Renames a folder by updating every connection in it. */
  async renameFolder(from: string, to: string): Promise<SavedConnection[]> {
    const target = to.trim();
    const affected = this.getSavedConnections().filter((c) => (c.folder ?? "").trim() === from.trim());
    let result = this.getSavedConnections();
    for (const c of affected) {
      result = await this.persistConnection({ ...c, folder: target || undefined });
    }
    return result;
  },

  /** Reads the legacy localStorage list without mutating it (used by migration). */
  readLegacyConnections(): SavedConnection[] {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      const parsed = data ? JSON.parse(data) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  /** True when this computer has no stored password for the connection. Never reveals secrets. */
  async hasMissingCredential(conn: SavedConnection): Promise<boolean> {
    try {
      return !(await dbService.hasCredential(conn.credentialId || `cred-${conn.id}`));
    } catch {
      return false;
    }
  },
};
