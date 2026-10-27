import { format } from "sql-formatter";
import type { SqlFormatOptions } from "../stores/preferenceStore";

/**
 * Formats MariaDB/MySQL SQL with the user's preferences. Throws if the text
 * cannot be parsed so the caller can leave the editor untouched.
 */
export function formatSql(sql: string, opts: SqlFormatOptions): string {
  return format(sql, {
    language: "mariadb",
    keywordCase: opts.keywordCase,
    functionCase: opts.functionCase,
    dataTypeCase: opts.keywordCase,
    tabWidth: opts.indent === "4" ? 4 : 2,
    useTabs: opts.indent === "tab",
    logicalOperatorNewline: opts.logicalOperatorNewline,
    linesBetweenQueries: opts.linesBetweenQueries,
    denseOperators: opts.denseOperators,
    // Keep `:name` placeholders (SQL variables) intact.
    paramTypes: { named: [":"] },
  });
}
