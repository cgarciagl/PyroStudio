import { usePreferenceStore } from "../stores/preferenceStore";
import { activeSqlDialect } from "./sqlDialect";
import { formatSql } from "./sqlFormat";

/**
 * Formats SQL that the app generates before opening it in an editor, using
 * the user's format preferences and the active engine's grammar. Returns the
 * text unchanged when the formatter cannot parse it.
 */
export function formatGeneratedSql(sql: string): string {
  try {
    return formatSql(sql, usePreferenceStore.getState().sqlFormat, activeSqlDialect().formatterLanguage);
  } catch {
    return sql;
  }
}
