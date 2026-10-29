import { MySQL, SQLite, type SQLDialect } from "@codemirror/lang-sql";
import { useConnectionStore } from "../stores/connectionStore";
import { connectionEngine, type DbEngine } from "../types/database";
import type { SqlFormatLanguage } from "./sqlFormat";

/** SQL syntax details of each engine, kept in one place for the editor. */
export interface EngineSqlDialect {
  engine: DbEngine;
  /** CodeMirror grammar for highlighting and autocompletion. */
  codeMirror: SQLDialect;
  formatterLanguage: SqlFormatLanguage;
  /** Query offered by a new editor tab. */
  starterQuery: string;
}

export const SQL_DIALECTS: Record<DbEngine, EngineSqlDialect> = {
  mysql: {
    engine: "mysql",
    codeMirror: MySQL,
    formatterLanguage: "mariadb",
    starterQuery: "SELECT * FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() LIMIT 100;",
  },
  sqlite: {
    engine: "sqlite",
    codeMirror: SQLite,
    formatterLanguage: "sqlite",
    starterQuery: "SELECT type, name, tbl_name FROM sqlite_master ORDER BY type, name;",
  },
};

/** Dialect of the active session, for code outside React components. */
export function activeSqlDialect(): EngineSqlDialect {
  return SQL_DIALECTS[connectionEngine(useConnectionStore.getState().connectionStatus.config)];
}

/** Dialect of the active session; re-renders when the session changes. */
export function useSqlDialect(): EngineSqlDialect {
  const engine = useConnectionStore((state) => connectionEngine(state.connectionStatus.config));
  return SQL_DIALECTS[engine];
}
