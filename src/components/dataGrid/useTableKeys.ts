import { useEffect, useMemo, useState } from "react";
import { dbService } from "../../services/tauriDb";
import type { ErRelation, ForeignKeyMetadata } from "../../types/database";

/**
 * Loads the key metadata the grid needs: outgoing foreign keys, foreign keys
 * that reference this table (grouped per constraint) and the primary key.
 */
export function useTableKeys(
  database: string,
  table: string,
  primaryKeyColumns: string[] | undefined,
  primaryKeyColumn: string | undefined,
) {
  // Foreign keys for this table
  const [foreignKeys, setForeignKeys] = useState<ForeignKeyMetadata[]>([]);
  useEffect(() => {
    if (!database || !table) {
      setForeignKeys([]);
      return;
    }
    let isMounted = true;
    dbService
      .getTableForeignKeys(database, table)
      .then((fks) => {
        if (isMounted && fks) {
          setForeignKeys(fks);
        }
      })
      .catch((err) => {
        console.warn("Could not retrieve foreign keys:", err);
      });
    return () => {
      isMounted = false;
    };
  }, [database, table]);

  // Foreign keys elsewhere that point at this table ("rows referencing this one")
  const [referencingFks, setReferencingFks] = useState<ErRelation[]>([]);
  useEffect(() => {
    if (!database || !table) {
      setReferencingFks([]);
      return;
    }
    let isMounted = true;
    dbService
      .getReferencingForeignKeys(database, table)
      .then((relations) => {
        if (isMounted) setReferencingFks(relations);
      })
      .catch((err) => {
        console.warn("Could not retrieve referencing foreign keys:", err);
      });
    return () => {
      isMounted = false;
    };
  }, [database, table]);

  /** One entry per constraint (composite keys span several column rows). */
  const referencingConstraints = useMemo(() => {
    const groups = new Map<string, ErRelation[]>();
    for (const r of referencingFks) {
      const key = `${r.table}\u0000${r.foreign_key.name}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    return [...groups.values()];
  }, [referencingFks]);

  const fkByColumn = useMemo(() => {
    const map = new Map<string, ForeignKeyMetadata>();
    for (const fk of foreignKeys) {
      map.set(fk.column_name.toLowerCase(), fk);
    }
    return map;
  }, [foreignKeys]);

  const [fetchedPkColumns, setFetchedPkColumns] = useState<string[]>([]);

  useEffect(() => {
    if (primaryKeyColumns !== undefined) {
      setFetchedPkColumns(primaryKeyColumns);
      return;
    }
    if (primaryKeyColumn) {
      setFetchedPkColumns([primaryKeyColumn]);
      return;
    }
    if (!database || !table) {
      setFetchedPkColumns([]);
      return;
    }
    let isMounted = true;
    dbService
      .getTablePrimaryKey(database, table)
      .then((pk) => {
        if (isMounted && pk?.columns) {
          setFetchedPkColumns(pk.columns);
        }
      })
      .catch((err) => {
        console.warn("Could not retrieve primary key:", err);
      });
    return () => {
      isMounted = false;
    };
  }, [database, table, primaryKeyColumns, primaryKeyColumn]);

  const activePkColumns = useMemo(() => {
    if (primaryKeyColumns && primaryKeyColumns.length > 0) return primaryKeyColumns;
    if (primaryKeyColumn) return [primaryKeyColumn];
    return fetchedPkColumns;
  }, [primaryKeyColumns, primaryKeyColumn, fetchedPkColumns]);

  return { foreignKeys, referencingConstraints, fkByColumn, activePkColumns };
}
