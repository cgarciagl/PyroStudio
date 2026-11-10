import { describe, expect, it } from "vitest";
import type { SavedConnection } from "../../types/database";
import { canToggleHttpTunnel, connectionTransport, withHttpTunnelToggled } from "../connectionTransport";

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
