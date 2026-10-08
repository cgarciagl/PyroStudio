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
  profilesVersion: number;

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
  updateTabQuery: (id: string, queryContent: string) => void;
  clearTabs: () => void;

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
  profilesVersion: 0,

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
