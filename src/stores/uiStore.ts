import { create } from "zustand";
import type { OpenTab, SavedConnection } from "../types/database";

interface UIState {
  tabs: OpenTab[];
  activeTabId: string | null;
  profilesVersion: number;

  // Modals state
  isConnectModalOpen: boolean;
  selectedProfileForModal?: SavedConnection;
  isCreateTableModalOpen: boolean;
  createTableDbName: string | null;
  isImportModalOpen: boolean;
  importTarget: { database: string; table?: string } | null;

  // Actions
  setActiveTabId: (id: string | null) => void;
  openTab: (tab: OpenTab) => void;
  closeTab: (id: string) => void;
  updateTabQuery: (id: string, queryContent: string) => void;
  clearTabs: () => void;

  openConnectModal: (profile?: SavedConnection) => void;
  closeConnectModal: () => void;

  openCreateTableModal: (dbName: string) => void;
  closeCreateTableModal: () => void;

  openImportModal: (target: { database: string; table?: string }) => void;
  closeImportModal: () => void;

  bumpProfilesVersion: () => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  profilesVersion: 0,

  isConnectModalOpen: false,
  selectedProfileForModal: undefined,
  isCreateTableModalOpen: false,
  createTableDbName: null,
  isImportModalOpen: false,
  importTarget: null,

  setActiveTabId: (id) => set({ activeTabId: id }),

  openTab: (tab) => {
    const { tabs } = get();
    const existing = tabs.find((t) => t.id === tab.id);
    if (!existing) {
      set({ tabs: [...tabs, tab], activeTabId: tab.id });
    } else {
      set({ activeTabId: tab.id });
    }
  },

  closeTab: (id) => {
    const { tabs, activeTabId } = get();
    const newTabs = tabs.filter((t) => t.id !== id);
    let nextActiveId = activeTabId;
    if (activeTabId === id) {
      nextActiveId = newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null;
    }
    set({ tabs: newTabs, activeTabId: nextActiveId });
  },

  updateTabQuery: (id, queryContent) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, queryContent } : t,
      ),
    }));
  },

  clearTabs: () => set({ tabs: [], activeTabId: null }),

  openConnectModal: (profile) =>
    set({
      isConnectModalOpen: true,
      selectedProfileForModal: profile,
    }),

  closeConnectModal: () =>
    set({
      isConnectModalOpen: false,
      selectedProfileForModal: undefined,
    }),

  openCreateTableModal: (dbName) =>
    set({
      isCreateTableModalOpen: true,
      createTableDbName: dbName,
    }),

  closeCreateTableModal: () =>
    set({
      isCreateTableModalOpen: false,
      createTableDbName: null,
    }),

  openImportModal: (target) =>
    set({
      isImportModalOpen: true,
      importTarget: target,
    }),

  closeImportModal: () =>
    set({
      isImportModalOpen: false,
      importTarget: null,
    }),

  bumpProfilesVersion: () =>
    set((state) => ({ profilesVersion: state.profilesVersion + 1 })),
}));
