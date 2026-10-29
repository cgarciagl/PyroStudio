import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../tauriDb", () => ({
  dbService: {
    deleteCredential: vi.fn().mockResolvedValue(undefined),
    saveCredential: vi.fn().mockResolvedValue(undefined),
    hasCredential: vi.fn().mockResolvedValue(false),
  },
}));

import { connectionStorage } from "../connectionStorage";
import { dbService } from "../tauriDb";
import type { SavedConnection } from "../../types/database";

describe("connectionStorage secret handling", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("stores database, HTTP Basic, and Bearer secrets only as Vault identifiers", () => {
    const profile: SavedConnection = {
      id: "connection-1",
      name: "Remote",
      host: "db.example.test",
      port: 3306,
      user: "app",
      password: "database-secret",
      tunnel: {
        enabled: true,
        url: "https://tunnel.example.test/pyro_tunnel.php",
        http_user: "web-user",
        http_password: "basic-secret",
        auth_token: "bearer-secret",
      },
      createdAt: 1,
    };

    connectionStorage.saveConnection(profile);

    const serialized = localStorage.getItem("pyro_saved_connections_v1") || "";
    expect(serialized).not.toContain("database-secret");
    expect(serialized).not.toContain("basic-secret");
    expect(serialized).not.toContain("bearer-secret");
    expect(serialized).toContain("cred-connection-1");
    expect(serialized).toContain("tunnel-cred-connection-1");
    expect(serialized).toContain("tunnel-token-cred-connection-1");
  });

  it("keeps shared tunnel credentials until their last profile is removed", () => {
    const sharedTokenId = "shared-tunnel-token";
    const first: SavedConnection = {
      id: "first",
      name: "First",
      host: "db.example.test",
      port: 3306,
      user: "app",
      tunnel: {
        enabled: true,
        url: "https://tunnel.example.test/pyro_tunnel.php",
        token_credential_id: sharedTokenId,
      },
      createdAt: 1,
    };
    const second = { ...first, id: "second", name: "Second" };
    connectionStorage.saveConnection(first);
    connectionStorage.saveConnection(second);

    connectionStorage.deleteConnection(first.id);
    expect(dbService.deleteCredential).not.toHaveBeenCalledWith(sharedTokenId);

    connectionStorage.deleteConnection(second.id);
    expect(dbService.deleteCredential).toHaveBeenCalledWith(sharedTokenId);
  });
});

describe("connectionStorage engine compatibility", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("reads profiles saved before SQLite support as MariaDB/MySQL", () => {
    const legacy = [
      { id: "old", name: "Old", host: "db", port: 3306, user: "app", createdAt: 1 },
    ];
    localStorage.setItem("pyro_saved_connections_v1", JSON.stringify(legacy));

    const [profile] = connectionStorage.getSavedConnections();

    expect(profile.engine).toBe("mysql");
    expect(profile.host).toBe("db");
  });

  it("keeps the SQLite engine and file and reserves no database credential", () => {
    connectionStorage.saveConnection({
      id: "lite",
      name: "Chinook",
      engine: "sqlite",
      filePath: "C:/data/chinook.db",
      host: "",
      port: 0,
      user: "",
      createdAt: 1,
    });

    const [profile] = connectionStorage.getSavedConnections();

    expect(profile.engine).toBe("sqlite");
    expect(profile.filePath).toBe("C:/data/chinook.db");
    expect(profile.credentialId).toBeUndefined();
  });

  it("never reports a missing password for SQLite files", async () => {
    const missing = await connectionStorage.hasMissingCredential({
      id: "lite",
      name: "Chinook",
      engine: "sqlite",
      host: "",
      port: 0,
      user: "",
      createdAt: 1,
    });

    expect(missing).toBe(false);
    expect(dbService.hasCredential).not.toHaveBeenCalled();
  });
});
