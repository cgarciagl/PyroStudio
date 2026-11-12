import { describe, it, expect, vi } from "vitest";
import {
  buildConnectConfig,
  buildProfile,
  clampTunnelTimeout,
  credentialIdsFor,
  saveSecrets,
  type ConnectionDraft,
} from "../connectionDraft";

const draft = (over: Partial<ConnectionDraft> = {}): ConnectionDraft => ({
  id: "conn-1",
  name: "Prod",
  engine: "mysql",
  host: "db",
  port: 3306,
  user: "app",
  password: "",
  hasSavedPassword: true,
  database: " ventas ",
  environment: "production",
  readOnly: false,
  folder: "",
  useTunnel: false,
  hadTunnelConfig: false,
  tunnelUrl: "",
  tunnelUser: "",
  tunnelPassword: "",
  tunnelToken: "",
  tunnelEncodeBase64: true,
  tunnelTimeoutSec: 30,
  ids: credentialIdsFor("conn-1", false, {}),
  ...over,
});

describe("connectionDraft", () => {
  it("keeps the creation date of an existing profile", () => {
    expect(buildProfile(draft({ createdAt: 111 }), "x", 999).createdAt).toBe(111);
    expect(buildProfile(draft(), "x", 999).createdAt).toBe(999);
  });

  it("never stores passwords in the profile", () => {
    const p = buildProfile(
      draft({ password: "s3cret", useTunnel: true, tunnelUrl: "https://t", tunnelPassword: "tp", tunnelToken: "tk" }),
      "x",
    );
    expect(JSON.stringify(p)).not.toMatch(/s3cret|"tp"|"tk"/);
    expect(p.tunnel?.tunnel_credential_id).toBe("tunnel-cred-conn-1");
  });

  it("sends a typed password once, otherwise the vault id", () => {
    expect(buildConnectConfig(draft({ password: "p" }), "connect")).toMatchObject({ password: "p", credential_id: undefined });
    expect(buildConnectConfig(draft(), "connect")).toMatchObject({ password: undefined, credential_id: "cred-conn-1" });
    expect(buildConnectConfig(draft(), "connect").database).toBe("ventas");
  });

  it("a test ignores a disabled tunnel; connect keeps it disabled", () => {
    const d = draft({ hadTunnelConfig: true, tunnelUrl: "https://t" });
    expect(buildConnectConfig(d, "test").tunnel).toBeUndefined();
    expect(buildConnectConfig(d, "connect").tunnel?.enabled).toBe(false);
  });

  it("SQLite has no database credential", () => {
    expect(credentialIdsFor("c", true, {}).database).toBeUndefined();
  });

  it("clamps the tunnel timeout", () => {
    expect([clampTunnelTimeout(0), clampTunnelTimeout(500), clampTunnelTimeout(45.4)]).toEqual([30, 120, 45]);
  });

  it("reports secrets that fail and only marks the stored ones", async () => {
    const save = vi.fn(async (id: string) => {
      if (id.startsWith("tunnel-cred")) throw new Error("llavero bloqueado");
    });
    const onError = vi.fn();
    const r = await saveSecrets(draft({ password: "p", tunnelPassword: "tp" }), save, onError);
    expect(r).toEqual({ password: true, tunnelPassword: false, tunnelToken: false });
    expect(onError).toHaveBeenCalledWith("No se guardó la contraseña del túnel", expect.any(Error));
  });
});
