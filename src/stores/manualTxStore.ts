import { create } from "zustand";

/** Uncommitted statements per editor tab in manual-commit mode. */
interface ManualTxState {
  pendingByTab: Record<string, number>;
  setPending: (tabId: string, pending: number) => void;
  clear: (tabId: string) => void;
}

export const useManualTxStore = create<ManualTxState>((set) => ({
  pendingByTab: {},
  setPending: (tabId, pending) =>
    set((s) => ({ pendingByTab: { ...s.pendingByTab, [tabId]: pending } })),
  clear: (tabId) =>
    set((s) => {
      const { [tabId]: _removed, ...rest } = s.pendingByTab;
      return { pendingByTab: rest };
    }),
}));

/** Statements a tab would lose (roll back) if it were closed now. */
export function pendingStatements(tabId: string): number {
  return useManualTxStore.getState().pendingByTab[tabId] ?? 0;
}
