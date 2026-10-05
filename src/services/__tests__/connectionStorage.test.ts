import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../tauriDb", () => ({
  dbService: {
    deleteCredential: vi.fn().mockResolvedValue(undefined),
    saveCredential: vi.fn().mockResolvedValue(undefined),
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
        url: "https://tunnel.example.test/ntunnel_mysql.php",
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
        url: "https://tunnel.example.test/ntunnel_mysql.php",
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
