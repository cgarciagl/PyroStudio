import { createContext } from "react";
import { create } from "zustand";
import { useStagedChangesStore } from "./stagedChangesStore";

/** Id of the tab a component is rendered in (set by App around each tab's content). */
export const TabIdContext = createContext<string | null>(null);

/** Table whose staged grid edits a tab shows (Table and Query mode alike). */
interface TabStaged {
  count: number;
  database: string;
  table: string;
}

interface PendingChangesState {
  stagedByTab: Record<string, TabStaged>;
  setStaged: (tabId: string, staged: TabStaged) => void;
  clear: (tabId: string) => void;
}

export const usePendingChangesStore = create<PendingChangesState>((set) => ({
  stagedByTab: {},
  setStaged: (tabId, staged) =>
    set((s) => {
      const current = s.stagedByTab[tabId];
      if (staged.count === 0) {
        if (!current) return s;
        const { [tabId]: _removed, ...rest } = s.stagedByTab;
        return { stagedByTab: rest };
      }
      if (
        current &&
        current.count === staged.count &&
        current.database === staged.database &&
        current.table === staged.table
      ) {
        return s;
      }
      return { stagedByTab: { ...s.stagedByTab, [tabId]: staged } };
    }),
  clear: (tabId) =>
    set((s) => {
      if (!s.stagedByTab[tabId]) return s;
      const { [tabId]: _removed, ...rest } = s.stagedByTab;
      return { stagedByTab: rest };
    }),
}));

/** Staged edits a tab would lose if it were closed now. */
export function stagedChanges(tabId: string): number {
  return usePendingChangesStore.getState().stagedByTab[tabId]?.count ?? 0;
}

/** Tabs (by id) with staged edits, for the window-close check. */
export function tabsWithStagedChanges(): string[] {
  return Object.keys(usePendingChangesStore.getState().stagedByTab);
}

/**
 * Drops the staged edits of a tab that is being closed, unless another open tab
 * shows the same table (staged edits are kept per table, not per tab).
 */
export function discardStagedChanges(tabId: string) {
  const { stagedByTab, clear } = usePendingChangesStore.getState();
  const staged = stagedByTab[tabId];
  clear(tabId);
  if (!staged) return;
  const sharedWithOtherTab = Object.entries(stagedByTab).some(
    ([id, other]) => id !== tabId && other.database === staged.database && other.table === staged.table,
  );
  if (!sharedWithOtherTab) {
    useStagedChangesStore.getState().clearTableChanges(staged.database, staged.table);
  }
}
