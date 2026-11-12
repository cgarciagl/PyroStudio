import { useContext, useEffect, useMemo } from "react";
import { TabIdContext, usePendingChangesStore } from "../../stores/pendingChangesStore";
import { stagedRowKey, useStagedChangesStore, type StagedCellUpdate } from "../../stores/stagedChangesStore";
import type { StagedChange } from "../../stores/stagedChangesStore";

const EMPTY_STAGED_CHANGES: StagedChange[] = [];

/**
 * Staged (pending) edits for one table: store subscription, O(1) lookup maps
 * and the tab-bar counter of edits that would be lost on close.
 */
export function useStagedTableChanges(database: string, table: string) {
  // Staged changes store subscription for this table with stable fallback reference
  const tableKey = table ? `${database}.${table}` : "";
  const stagedChanges = useStagedChangesStore(
    (s) => (tableKey ? s.changesByTable[tableKey] ?? EMPTY_STAGED_CHANGES : EMPTY_STAGED_CHANGES),
  );
  const {
    stageCellUpdate,
    stageBatchCellUpdates,
    stageBatchRowDeletes,
    clearTableChanges,
    generateSqlForTable,
  } = useStagedChangesStore();

  const stagedChangeCount = stagedChanges.length;

  // Tell the tab bar how many staged edits this tab would lose if closed.
  const tabId = useContext(TabIdContext);
  useEffect(() => {
    if (tabId && table) {
      usePendingChangesStore.getState().setStaged(tabId, { count: stagedChangeCount, database, table });
    }
  }, [tabId, database, table, stagedChangeCount]);
  useEffect(() => {
    if (!tabId) return;
    return () => usePendingChangesStore.getState().clear(tabId);
  }, [tabId]);

  // Staged maps for instant O(1) cell & row lookup
  const stagedUpdatesMap = useMemo(() => {
    const map = new Map<string, StagedCellUpdate>();
    for (const ch of stagedChanges) {
      if (ch.type === "cell_update") {
        map.set(`${ch.columnName}:${stagedRowKey(ch)}`, ch);
      }
    }
    return map;
  }, [stagedChanges]);

  const stagedDeletedRows = useMemo(() => {
    const set = new Set<string>();
    for (const ch of stagedChanges) {
      if (ch.type === "row_delete") {
        set.add(stagedRowKey(ch));
      }
    }
    return set;
  }, [stagedChanges]);

  return {
    stagedChanges,
    stagedChangeCount,
    stagedUpdatesMap,
    stagedDeletedRows,
    stageCellUpdate,
    stageBatchCellUpdates,
    stageBatchRowDeletes,
    clearTableChanges,
    generateSqlForTable,
  };
}
