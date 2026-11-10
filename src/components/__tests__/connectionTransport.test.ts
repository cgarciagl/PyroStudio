import { describe, expect, it } from "vitest";
import type { SavedConnection } from "../../types/database";
import {
  canSwitchLiveTunnel,
  canToggleHttpTunnel,
  connectionTransport,
  isTunnelTimeoutError,
  withHttpTunnelToggled,
} from "../connectionTransport";

const base = { id: "c1", name: "x", host: "db", port: 3306, user: "root", createdAt: 0 } as SavedConnection;
const tunnel = { enabled: true, url: "https://srv/tunnel/pyro_tunnel.php", http_user: "u" };

describe("toggle HTTP tunnel", () => {
  it("only allows toggling when a tunnel URL is configured and SSH is off", () => {
    expect(canToggleHttpTunnel(base)).toBe(false);
    expect(canToggleHttpTunnel({ ...base, tunnel })).toBe(true);
    expect(canToggleHttpTunnel({ ...base, tunnel: { ...tunnel, enabled: false } })).toBe(true);
    expect(
      canToggleHttpTunnel({
        ...base,
        tunnel: { ...tunnel, enabled: false },
        ssh_tunnel: { enabled: true } as SavedConnection["ssh_tunnel"],
      }),
    ).toBe(false);
  });

  it("switches between tunnel and direct keeping the tunnel settings", () => {
    const direct = withHttpTunnelToggled({ ...base, tunnel });
    expect(connectionTransport(direct)).toBe("direct");
    expect(direct.tunnel).toEqual({ ...tunnel, enabled: false });
    const back = withHttpTunnelToggled(direct);
    expect(connectionTransport(back)).toBe("http");
    expect(back.tunnel).toEqual(tunnel);
  });
});

describe("live session transport switch", () => {
  it("detects tunnel timeouts but not ordinary SQL errors", () => {
    expect(isTunnelTimeoutError("Tiempo agotado en la solicitud HTTP del túnel (ID 7).")).toBe(true);
    expect(isTunnelTimeoutError("El servidor del túnel respondió con HTTP 504 Gateway Timeout (ID 3).")).toBe(true);
    expect(isTunnelTimeoutError("El servidor del túnel respondió con HTTP 403 Forbidden (ID 3).")).toBe(false);
    expect(isTunnelTimeoutError("You have an error in your SQL syntax")).toBe(false);
    expect(isTunnelTimeoutError(null)).toBe(false);
  });

  it("only offers the switch when the live config carries a tunnel URL", () => {
    const cfg = { host: "db", port: 3306, user: "root", tunnel: { ...tunnel, enabled: false } };
    expect(canSwitchLiveTunnel(cfg as never)).toBe(true);
    expect(canSwitchLiveTunnel({ host: "db", port: 3306, username: "r", tunnel_enabled: true } as never)).toBe(false);
    expect(canSwitchLiveTunnel(undefined)).toBe(false);
  });
});
