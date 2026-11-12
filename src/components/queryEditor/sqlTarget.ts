/**
 * Table (and optional database) a statement reads from or writes to, used to make
 * query results editable. Comments are ignored; only the first FROM/UPDATE/INTO counts.
 */
export function extractTargetTableAndDb(sqlText: string): { db: string | null; table: string | null } {
  if (!sqlText) return { db: null, table: null };
  const clean = sqlText
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .replace(/#.*$/gm, " ");

  const match = clean.match(
    /\b(?:FROM|UPDATE|INTO)\s+[`"]?([a-zA-Z0-9_$]+)[`"]?(?:\s*\.\s*[`"]?([a-zA-Z0-9_$]+)[`"]?)?/i,
  );
  if (!match) return { db: null, table: null };
  if (match[2]) return { db: match[1], table: match[2] };
  return { db: null, table: match[1] };
}
