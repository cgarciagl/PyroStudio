import { create } from "zustand";
import type { OpenTab, SavedConnection } from "../types/database";

export interface DialogOptions {
  title: string;
  message: string;
  details?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "warning" | "primary" | "info";
  icon?: "trash" | "alert" | "info";
  hideCancel?: boolean;
  onConfirm?: () => void;
  onClose?: () => void;
}

interface UIState {
  tabs: OpenTab[];
  activeTabId: string | null;
  recentlyClosedTabs: OpenTab[];
  profilesVersion: number;

  // Command Palette
  isCommandPaletteOpen: boolean;

  // Modals state
  isConnectModalOpen: boolean;
  selectedProfileForModal?: SavedConnection;
  isCreateTableModalOpen: boolean;
  createTableDbName: string | null;
  isImportModalOpen: boolean;
  importTarget: { database: string; table?: string } | null;
  isSqlExportModalOpen: boolean;
  sqlExportTarget: { database: string; table?: string } | null;
  isBackupRestoreModalOpen: boolean;
  backupRestoreInitialTab: "backup" | "restore";
  backupRestoreTargetDatabase: string | null;

  // Global Dialog (Alert / Confirm)
  activeDialog: DialogOptions | null;

  // Actions
  setActiveTabId: (id: string | null) => void;
  openTab: (tab: OpenTab) => void;
  closeTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  closeTabsToTheRight: (id: string) => void;
  closeTabsToTheLeft: (id: string) => void;
  reopenLastClosedTab: () => void;
  togglePinTab: (id: string) => void;
  setTabModified: (id: string, isModified: boolean) => void;
  reorderTabs: (startIndex: number, endIndex: number) => void;
  duplicateTab: (id: string) => void;
  renameTab: (id: string, newTitle: string) => void;
  updateTabQuery: (id: string, queryContent: string) => void;
  clearTabs: () => void;

  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleCommandPalette: () => void;

  isShortcutsModalOpen: boolean;
  openShortcutsModal: () => void;
  closeShortcutsModal: () => void;
  toggleShortcutsModal: () => void;

  openConnectModal: (profile?: SavedConnection) => void;
  closeConnectModal: () => void;

  openCreateTableModal: (dbName: string) => void;
  closeCreateTableModal: () => void;

  openImportModal: (target: { database: string; table?: string }) => void;
  closeImportModal: () => void;

  openSqlExportModal: (target: { database: string; table?: string }) => void;
  closeSqlExportModal: () => void;

  openBackupRestoreModal: (options?: {
    tab?: "backup" | "restore";
    targetDatabase?: string;
  }) => void;
  closeBackupRestoreModal: () => void;

  showAlert: (options: {
    title: string;
    message: string;
    details?: string;
    variant?: "danger" | "warning" | "primary" | "info";
    icon?: "trash" | "alert" | "info";
    confirmText?: string;
    onConfirm?: () => void;
  }) => void;

  showConfirm: (options: {
    title: string;
    message: string;
    details?: string;
    variant?: "danger" | "warning" | "primary" | "info";
    icon?: "trash" | "alert" | "info";
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void;
    onCancel?: () => void;
  }) => void;

  closeDialog: () => void;

  bumpProfilesVersion: () => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  recentlyClosedTabs: [],
  profilesVersion: 0,

  isCommandPaletteOpen: false,
  openCommandPalette: () => set({ isCommandPaletteOpen: true }),
  closeCommandPalette: () => set({ isCommandPaletteOpen: false }),
  toggleCommandPalette: () =>
    set((state) => ({ isCommandPaletteOpen: !state.isCommandPaletteOpen })),

  isShortcutsModalOpen: false,
  openShortcutsModal: () => set({ isShortcutsModalOpen: true }),
  closeShortcutsModal: () => set({ isShortcutsModalOpen: false }),
  toggleShortcutsModal: () =>
    set((state) => ({ isShortcutsModalOpen: !state.isShortcutsModalOpen })),

  isConnectModalOpen: false,
  selectedProfileForModal: undefined,
  isCreateTableModalOpen: false,
  createTableDbName: null,
  isImportModalOpen: false,
  importTarget: null,
  isSqlExportModalOpen: false,
  sqlExportTarget: null,
  isBackupRestoreModalOpen: false,
  backupRestoreInitialTab: "backup",
  backupRestoreTargetDatabase: null,
  activeDialog: null,

  setActiveTabId: (id) => set({ activeTabId: id }),

  openTab: (tab) => {
    const { tabs } = get();
    const existing = tabs.find((t) => t.id === tab.id);
    if (!existing) {
      // If tab is pinned, insert after last pinned tab, else append
      if (tab.isPinned) {
        let lastPinnedIdx = -1;
        for (let i = tabs.length - 1; i >= 0; i--) {
          if (tabs[i].isPinned) {
            lastPinnedIdx = i;
            break;
          }
        }
        const insertIdx = lastPinnedIdx === -1 ? 0 : lastPinnedIdx + 1;
        const newTabs = [...tabs];
        newTabs.splice(insertIdx, 0, tab);
        set({ tabs: newTabs, activeTabId: tab.id });
      } else {
        set({ tabs: [...tabs, tab], activeTabId: tab.id });
      }
    } else {
      set({ activeTabId: tab.id });
    }
  },

  closeTab: (id) => {
    const { tabs, activeTabId, recentlyClosedTabs } = get();
    const targetIdx = tabs.findIndex((t) => t.id === id);
    if (targetIdx === -1) return;

    const closedTab = tabs[targetIdx];
    const newTabs = tabs.filter((t) => t.id !== id);

    let nextActiveId = activeTabId;
    if (activeTabId === id) {
      if (newTabs.length === 0) {
        nextActiveId = null;
      } else if (targetIdx < newTabs.length) {
        nextActiveId = newTabs[targetIdx].id;
      } else {
        nextActiveId = newTabs[newTabs.length - 1].id;
      }
    }

    set({
      tabs: newTabs,
      activeTabId: nextActiveId,
      recentlyClosedTabs: [closedTab, ...recentlyClosedTabs.slice(0, 19)],
    });
  },

  closeOtherTabs: (id) => {
    const { tabs, recentlyClosedTabs } = get();
    const keptTabs = tabs.filter((t) => t.id === id || t.isPinned);
    const removedTabs = tabs.filter((t) => t.id !== id && !t.isPinned);

    set({
      tabs: keptTabs,
      activeTabId: id,
      recentlyClosedTabs: [...removedTabs.reverse(), ...recentlyClosedTabs].slice(0, 20),
    });
  },

  closeTabsToTheRight: (id) => {
    const { tabs, activeTabId, recentlyClosedTabs } = get();
    const targetIdx = tabs.findIndex((t) => t.id === id);
    if (targetIdx === -1) return;

    const keptTabs: OpenTab[] = [];
    const removedTabs: OpenTab[] = [];

    tabs.forEach((t, idx) => {
      if (idx <= targetIdx || t.isPinned) {
        keptTabs.push(t);
      } else {
        removedTabs.push(t);
      }
    });

    const isCurrentActiveKept = keptTabs.some((t) => t.id === activeTabId);
    set({
      tabs: keptTabs,
      activeTabId: isCurrentActiveKept ? activeTabId : id,
      recentlyClosedTabs: [...removedTabs.reverse(), ...recentlyClosedTabs].slice(0, 20),
    });
  },

  closeTabsToTheLeft: (id) => {
    const { tabs, activeTabId, recentlyClosedTabs } = get();
    const targetIdx = tabs.findIndex((t) => t.id === id);
    if (targetIdx === -1) return;

    const keptTabs: OpenTab[] = [];
    const removedTabs: OpenTab[] = [];

    tabs.forEach((t, idx) => {
      if (idx >= targetIdx || t.isPinned) {
        keptTabs.push(t);
      } else {
        removedTabs.push(t);
      }
    });

    const isCurrentActiveKept = keptTabs.some((t) => t.id === activeTabId);
    set({
      tabs: keptTabs,
      activeTabId: isCurrentActiveKept ? activeTabId : id,
      recentlyClosedTabs: [...removedTabs.reverse(), ...recentlyClosedTabs].slice(0, 20),
    });
  },

  reopenLastClosedTab: () => {
    const { recentlyClosedTabs } = get();
    if (recentlyClosedTabs.length === 0) return;
    const [tabToReopen, ...remainingClosed] = recentlyClosedTabs;
    set({ recentlyClosedTabs: remainingClosed });
    get().openTab(tabToReopen);
  },

  togglePinTab: (id) => {
    const { tabs } = get();
    const target = tabs.find((t) => t.id === id);
    if (!target) return;

    const isNowPinned = !target.isPinned;
    const updatedTabs = tabs.map((t) =>
      t.id === id ? { ...t, isPinned: isNowPinned } : t
    );

    // Group pinned tabs first while maintaining their respective orders
    const pinned = updatedTabs.filter((t) => t.isPinned);
    const unpinned = updatedTabs.filter((t) => !t.isPinned);

    set({ tabs: [...pinned, ...unpinned] });
  },

  setTabModified: (id, isModified) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, isModified } : t
      ),
    }));
  },

  reorderTabs: (startIndex, endIndex) => {
    const { tabs } = get();
    if (
      startIndex < 0 ||
      startIndex >= tabs.length ||
      endIndex < 0 ||
      endIndex >= tabs.length ||
      startIndex === endIndex
    ) {
      return;
    }
    const newTabs = [...tabs];
    const [movedTab] = newTabs.splice(startIndex, 1);
    newTabs.splice(endIndex, 0, movedTab);
    set({ tabs: newTabs });
  },

  duplicateTab: (id) => {
    const { tabs } = get();
    const targetIdx = tabs.findIndex((t) => t.id === id);
    if (targetIdx === -1) return;
    const sourceTab = tabs[targetIdx];
    const newId = `${sourceTab.type}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const duplicatedTab: OpenTab = {
      ...sourceTab,
      id: newId,
      title: `${sourceTab.title} (Copia)`,
      isPinned: false,
    };
    const newTabs = [...tabs];
    newTabs.splice(targetIdx + 1, 0, duplicatedTab);
    set({
      tabs: newTabs,
      activeTabId: newId,
    });
  },

  renameTab: (id, newTitle) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, title: trimmed } : t)),
    }));
  },

  updateTabQuery: (id, queryContent) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, queryContent } : t
      ),
    }));
  },

  clearTabs: () => {
    const { tabs, recentlyClosedTabs } = get();
    const unpinned = tabs.filter((t) => !t.isPinned);
    const pinned = tabs.filter((t) => t.isPinned);

    if (pinned.length > 0) {
      set({
        tabs: pinned,
        activeTabId: pinned[0]?.id ?? null,
        recentlyClosedTabs: [...unpinned.reverse(), ...recentlyClosedTabs].slice(0, 20),
      });
    } else {
      set({
        tabs: [],
        activeTabId: null,
        recentlyClosedTabs: [...unpinned.reverse(), ...recentlyClosedTabs].slice(0, 20),
      });
    }
  },

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

  openSqlExportModal: (target) =>
    set({
      isSqlExportModalOpen: true,
      sqlExportTarget: target,
    }),

  closeSqlExportModal: () =>
    set({
      isSqlExportModalOpen: false,
      sqlExportTarget: null,
    }),

  openBackupRestoreModal: (options) =>
    set({
      isBackupRestoreModalOpen: true,
      backupRestoreInitialTab: options?.tab || "backup",
      backupRestoreTargetDatabase: options?.targetDatabase || null,
    }),

  closeBackupRestoreModal: () =>
    set({
      isBackupRestoreModalOpen: false,
      backupRestoreTargetDatabase: null,
    }),

  showAlert: ({ title, message, details, variant = "info", icon, confirmText = "Entendido", onConfirm }) =>
    set({
      activeDialog: {
        title,
        message,
        details,
        variant,
        icon: icon || (variant === "danger" ? "trash" : variant === "warning" ? "alert" : "info"),
        confirmText,
        hideCancel: true,
        onConfirm,
      },
    }),

  showConfirm: ({
    title,
    message,
    details,
    variant = "danger",
    icon,
    confirmText,
    cancelText = "Cancelar",
    onConfirm,
    onCancel,
  }) =>
    set({
      activeDialog: {
        title,
        message,
        details,
        variant,
        icon: icon || (variant === "danger" ? "trash" : variant === "warning" ? "alert" : "info"),
        confirmText: confirmText || (variant === "danger" ? "Eliminar" : "Confirmar"),
        cancelText,
        hideCancel: false,
        onConfirm,
        onClose: onCancel,
      },
    }),

  closeDialog: () => set({ activeDialog: null }),

  bumpProfilesVersion: () =>
    set((state) => ({ profilesVersion: state.profilesVersion + 1 })),
}));

