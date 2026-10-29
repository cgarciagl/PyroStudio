import { useConnectionStore } from "../stores/connectionStore";
import { connectionEngine, type DbEngine } from "../types/database";

/** How each engine writes identifiers and literals in generated SQL. */
export interface SqlLiteralRules {
  quoteIdentifier: (name: string) => string;
  /** Quoted, escaped string literal. */
  stringLiteral: (text: string) => string;
  /** Clause closing a single-row UPDATE/DELETE (SQLite builds usually reject `LIMIT` there). */
  singleRowLimit: string;
}

/** MariaDB/MySQL string escapes, including backslash sequences. */
const mysqlStringLiteral = (text: string): string =>
  `'${text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "''")
    .replace(/\0/g, "\\0")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\x1a/g, "\\Z")}'`;

export const SQL_LITERALS: Record<DbEngine, SqlLiteralRules> = {
  mysql: {
    quoteIdentifier: (name) => `\`${name.replace(/`/g, "``")}\``,
    stringLiteral: mysqlStringLiteral,
    singleRowLimit: " LIMIT 1",
  },
  sqlite: {
    quoteIdentifier: (name) => `"${name.replace(/"/g, '""')}"`,
    // SQLite has no backslash escapes: only quotes are doubled.
    stringLiteral: (text) => `'${text.replace(/'/g, "''")}'`,
    singleRowLimit: "",
  },
};

/** `schema.table`, or just `table` without a schema. */
export function qualifiedTable(rules: SqlLiteralRules, schema: string | undefined, table: string): string {
  const quotedTable = rules.quoteIdentifier(table);
  return schema ? `${rules.quoteIdentifier(schema)}.${quotedTable}` : quotedTable;
}

/** Literal rules of the active session; re-renders when the session changes. */
export function useSqlLiteralRules(): SqlLiteralRules {
  const engine = useConnectionStore((state) => connectionEngine(state.connectionStatus.config));
  return SQL_LITERALS[engine];
}
