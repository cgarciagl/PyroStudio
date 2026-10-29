import { useConnectionStore } from "../../stores/connectionStore";
import { connectionEngine, type DbEngine } from "../../types/database";
import { MYSQL_DDL } from "./mysqlDdl";
import { SQLITE_DDL } from "./sqliteDdl";
import type { DdlBuilder } from "./types";

export type { AddColumnSpec, ChangeColumnSpec, ColumnSpec, CreateTableSpec, DdlBuilder } from "./types";

export const DDL_BUILDERS: Record<DbEngine, DdlBuilder> = {
  mysql: MYSQL_DDL,
  sqlite: SQLITE_DDL,
};

/** DDL builder of the active session's engine. */
export function useDdlBuilder(): DdlBuilder {
  const engine = useConnectionStore((state) => connectionEngine(state.connectionStatus.config));
  return DDL_BUILDERS[engine];
}
