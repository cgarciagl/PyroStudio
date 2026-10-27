/**
 * Detects SQL that reaches a database other than the active one, either via
 * `USE other` or via qualified names (`other.table`, `` `other`.`table` ``).
 * Only names of databases that exist on the server count, so `alias.column`
 * is not mistaken for a database reference.
 */

const WRITE_KEYWORDS = new Set([
  "INSERT", "UPDATE", "DELETE", "REPLACE", "DROP", "ALTER", "CREATE",
  "TRUNCATE", "RENAME", "GRANT", "REVOKE", "LOAD", "CALL", "USE",
]);

/** Removes comments and string literals so they cannot produce false matches. */
function stripCommentsAndStrings(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(--\s|#)[^\n]*/g, " ")
    .replace(/'(?:[^'\\]|\\.|'')*'/g, "''")
    .replace(/"(?:[^"\\]|\\.|"")*"/g, '""');
}

export interface CrossDatabaseAnalysis {
  /** Other databases referenced, in their server spelling. */
  foreignDatabases: string[];
  /** True when any statement can modify data, schema or session context. */
  isWrite: boolean;
}

export function analyzeCrossDatabase(
  sql: string,
  activeDatabase: string,
  knownDatabases: string[],
): CrossDatabaseAnalysis {
  const clean = stripCommentsAndStrings(sql);
  const known = new Map(knownDatabases.map((d) => [d.toLowerCase(), d]));
  const active = activeDatabase.toLowerCase();
  const found = new Set<string>();

  const consider = (name: string) => {
    const real = known.get(name.toLowerCase());
    if (real && real.toLowerCase() !== active) found.add(real);
  };

  const ident = "(?:`((?:[^`]|``)+)`|([A-Za-z0-9_$]+))";
  for (const m of clean.matchAll(new RegExp(`\\bUSE\\s+${ident}`, "gi"))) {
    consider((m[1] ?? m[2]).replace(/``/g, "`"));
  }
  for (const m of clean.matchAll(new RegExp(`${ident}\\s*\\.\\s*[\`A-Za-z0-9_$]`, "g"))) {
    consider((m[1] ?? m[2]).replace(/``/g, "`"));
  }

  const isWrite = clean
    .split(";")
    .some((stmt) => {
      const first = stmt.trim().match(/^\(*\s*([A-Za-z]+)/)?.[1]?.toUpperCase();
      return !!first && WRITE_KEYWORDS.has(first);
    });

  return { foreignDatabases: [...found], isWrite };
}
