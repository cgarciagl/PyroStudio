import { describe, expect, it } from "vitest";
import { generateTunnelToken, tunnelTokenServerSnippet } from "../tunnelToken";

describe("generateTunnelToken", () => {
  it("devuelve 64 caracteres hexadecimales (32 bytes)", () => {
    const token = generateTunnelToken();
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("supera el mínimo de 16 caracteres del túnel", () => {
    expect(generateTunnelToken().length).toBeGreaterThanOrEqual(16);
  });

  it("no repite valores", () => {
    const tokens = new Set(
      Array.from({ length: 200 }, () => generateTunnelToken()),
    );
    expect(tokens.size).toBe(200);
  });

  it("codifica cada byte con dos dígitos (conserva ceros a la izquierda)", () => {
    const fake = {
      getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
        (array as unknown as Uint8Array).fill(0x0a);
        return array;
      },
    } as Crypto;
    expect(generateTunnelToken(fake)).toBe("0a".repeat(32));
  });
});

describe("tunnelTokenServerSnippet", () => {
  it("incluye las dos formas de configurarlo en el servidor", () => {
    const snippet = tunnelTokenServerSnippet("abc123");
    expect(snippet).toContain("$tunnelToken = 'abc123';");
    expect(snippet).toContain("PYRO_TUNNEL_TOKEN=abc123");
  });
});
