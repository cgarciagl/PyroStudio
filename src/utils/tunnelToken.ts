/** Bytes of entropy in a generated HTTP tunnel token (64 hex characters). */
const TUNNEL_TOKEN_BYTES = 32;

/** Generates a random tunnel token: 32 bytes from the CSPRNG, hex encoded. */
export function generateTunnelToken(
  source: Crypto = globalThis.crypto,
): string {
  const bytes = source.getRandomValues(new Uint8Array(TUNNEL_TOKEN_BYTES));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The two ways to configure the token on the server running pyro_tunnel.php. */
export function tunnelTokenServerSnippet(token: string): string {
  return [
    "// En pyro_tunnel.php:",
    `$tunnelToken = '${token}';`,
    "",
    "# O como variable de entorno (recomendado):",
    `PYRO_TUNNEL_TOKEN=${token}`,
  ].join("\n");
}
