import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
vi.mock("../tauriDb", () => ({
  dbService: {
    deleteCredential: vi.fn().mockResolvedValue(undefined),
    saveCredential: vi.fn().mockResolvedValue(undefined),
    hasCredential: vi.fn().mockResolvedValue(false),
  },
}));

import { connectionStorage } from "../connectionStorage";
import { FavoriteConflictError, favoritesStorage } from "../favoritesStorage";
import { toSharedConnection, toWorkspaceError, WorkspaceError } from "../workspaceService";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { SavedConnection } from "../../types/database";
import type { WorkspaceQuery, WorkspaceStatus } from "../../types/workspace";

const available: WorkspaceStatus = {
  availability: "available",
  workspaceId: "ws-1",
  name: "Equipo",
  path: "C:/Drive/Pyro",
  formatVersion: 1,
  error: null,
};

const conn: SavedConnection = {
  id: "conn-1",
  name: "Prod",
  host: "db",
  port: 3306,
  user: "app",
  password: "SECRET",
  credentialId: "cred-conn-1",
  tunnel: { enabled: true, url: "https://t", http_password: "HP", auth_token: "TK", timeout_seconds: 9 },
  tls: { enabled: true, ca_cert_path: "/ca.pem", verify_certificate: true, allow_insecure_tls: false },
  ssh_tunnel: {
    enabled: true, ssh_host: "b", ssh_port: 22, ssh_user: "o", remote_host: "127.0.0.1",
    remote_port: 3306, authentication: "private_key", private_key_path: "~/.ssh/k",
  },
  createdAt: 1,
  lastConnectedAt: 2,
};

const query: WorkspaceQuery = {
  id: "q-1", title: "Uno", category: "A", sql: "SELECT 1;", description: null,
  createdAt: 1, updatedAt: 2, relPath: "queries/A/Uno.sql", contentHash: "h1", hasHeader: true,
};

/** Routes invoke() calls to a tiny in-memory fake of the Rust commands. */
function fakeBackend(opts: { conflict?: boolean } = {}) {
  let connections: unknown[] = [];
  invokeMock.mockImplementation(async (cmd: string, args?: Record<string, any>) => {
    switch (cmd) {
      case "workspace_get_status": return available;
      case "workspace_list_connections": return { connections, errors: [] };
      case "workspace_list_queries": return { queries: [query], errors: [] };
      case "workspace_save_connection": connections = [args!.connection]; return args!.connection;
      case "workspace_save_query":
        if (opts.conflict && !args!.query.force) throw "[WS_CONFLICT] cambió";
        return query;
      case "workspace_delete_query": return undefined;
      default: throw `[WS_IO] unexpected ${cmd}`;
    }
  });
}

describe("workspace serialization", () => {
  it("never includes secrets or machine-local fields", () => {
    const shared = toSharedConnection(conn);
    const text = JSON.stringify(shared);
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("\"HP\"");
    expect(text).not.toContain("\"TK\"");
    expect(shared).not.toHaveProperty("lastConnectedAt");
    expect(shared.tls).toEqual(conn.tls);
    expect(shared.ssh_tunnel).toEqual(conn.ssh_tunnel);
    expect((shared.tunnel as any).timeout_seconds).toBe(9);
    expect((shared.tunnel as any).token_credential_id).toBe("tunnel-token-cred-conn-1");
  });

  it("parses structured Rust errors", () => {
    const e = toWorkspaceError("[WS_UNAVAILABLE] La carpeta no está");
    expect(e).toBeInstanceOf(WorkspaceError);
    expect(e.code).toBe("WS_UNAVAILABLE");
    expect(toWorkspaceError("boom").code).toBe("UNKNOWN");
  });
});

describe("storage in workspace mode", () => {
  beforeEach(async () => {
    localStorage.clear();
    invokeMock.mockReset();
    fakeBackend();
    await useWorkspaceStore.getState().init();
  });

  it("writes connections to the workspace, not localStorage, and keeps lastConnectedAt local", async () => {
    const list = await connectionStorage.persistConnection(conn);
    expect(list.map((c) => c.id)).toEqual(["conn-1"]);
    expect(localStorage.getItem("pyro_saved_connections_v1")).toBeNull();
    const sent = invokeMock.mock.calls.find((c) => c[0] === "workspace_save_connection")![1];
    expect(JSON.stringify(sent)).not.toContain("SECRET");

    connectionStorage.markConnected("conn-1");
    expect(connectionStorage.getSavedConnections()[0].lastConnectedAt).toBeGreaterThan(2);
  });

  it("shows presets without copying them and merges workspace queries", () => {
    const favs = favoritesStorage.getFavorites();
    expect(favs[0].id).toBe("q-1");
    expect(favs.some((f) => f.id === "fav-preset-users")).toBe(true);
    expect(invokeMock.mock.calls.some((c) => c[0] === "workspace_save_query")).toBe(false);
  });

  it("refuses writes when the workspace is unavailable instead of falling back", async () => {
    useWorkspaceStore.setState({ status: { ...available, availability: "unavailable" } });
    await expect(connectionStorage.persistConnection(conn)).rejects.toMatchObject({ code: "WS_UNAVAILABLE" });
    expect(localStorage.getItem("pyro_saved_connections_v1")).toBeNull();
  });

  it("surfaces external-change conflicts and supports explicit overwrite", async () => {
    invokeMock.mockReset();
    fakeBackend({ conflict: true });
    const input = { id: "q-1", title: "Uno", category: "A", sql: "SELECT 2;" };
    await expect(favoritesStorage.persistFavorite(input)).rejects.toBeInstanceOf(FavoriteConflictError);
    await expect(favoritesStorage.persistFavorite(input, "overwrite")).resolves.toBeDefined();
    const sent = invokeMock.mock.calls.filter((c) => c[0] === "workspace_save_query").map((c) => c[1].query);
    expect(sent[0].expectedHash).toBe("h1");
    expect(sent[1].force).toBe(true);
  });

  it("does not allow deleting built-in presets", async () => {
    await expect(favoritesStorage.removeFavorite("fav-preset-users")).rejects.toBeInstanceOf(WorkspaceError);
  });
});

describe("unavailable workspace", () => {
  it("is reported as an error state, not an empty workspace", async () => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "workspace_get_status") return { ...available, availability: "unavailable", error: "no montada" };
      throw "[WS_UNAVAILABLE] x";
    });
    await useWorkspaceStore.getState().init();
    const s = useWorkspaceStore.getState();
    expect(s.loadState).toBe("error");
    expect(s.error).toBe("no montada");
  });
});

describe("legacy migration source", () => {
  it("reads legacy data without modifying it and skips untouched presets", () => {
    localStorage.clear();
    favoritesStorage.getFavorites(); // seeds presets in local mode
    useWorkspaceStore.setState({ status: null });
    const before = localStorage.getItem("pyro_sql_favorites_v1");
    expect(favoritesStorage.readLegacyFavorites()).toEqual([]);
    expect(localStorage.getItem("pyro_sql_favorites_v1")).toBe(before);
    localStorage.setItem("pyro_saved_connections_v1", JSON.stringify([conn]));
    expect(connectionStorage.readLegacyConnections()[0].id).toBe("conn-1");
    expect(localStorage.getItem("pyro_saved_connections_v1")).toContain("SECRET");
  });
});
