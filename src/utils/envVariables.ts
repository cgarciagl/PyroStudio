/** environment -> variable -> value */
export type Environments = Record<string, Record<string, string>>;

const VARIABLE_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Replaces `${name}` with the value from `variables`. Names without a value are
 * left untouched (they may be editor placeholders) and reported in `missing`.
 */
export function applyEnvVariables(
  sql: string,
  variables: Record<string, string> | null | undefined,
): { sql: string; missing: string[] } {
  if (!variables) return { sql, missing: [] };
  const missing = new Set<string>();
  const out = sql.replace(VARIABLE_PATTERN, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(variables, name)) return variables[name];
    missing.add(name);
    return match;
  });
  return { sql: out, missing: [...missing] };
}

/** `name=value` per line; blank lines and lines starting with `#` are ignored. */
export function parseVariableLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

export function formatVariableLines(variables: Record<string, string>): string {
  return Object.entries(variables)
    .map(([name, value]) => `${name}=${value}`)
    .join("\n");
}
