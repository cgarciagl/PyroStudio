import { describe, it, expect, beforeEach } from "vitest";
import { useUIStore } from "../uiStore";

describe("uiStore", () => {
  beforeEach(() => {
    useUIStore.getState().clearTabs();
  });

  it("should open a tab and set it active", () => {
    const { openTab } = useUIStore.getState();
    openTab({
      id: "tab-1",
      title: "Consulta 1",
      type: "query",
      database: "test_db",
    });

    const state = useUIStore.getState();
    expect(state.tabs.length).toBe(1);
    expect(state.activeTabId).toBe("tab-1");
  });

  it("should not duplicate tabs with the same id", () => {
    const { openTab } = useUIStore.getState();
    openTab({
      id: "tab-1",
      title: "Consulta 1",
      type: "query",
      database: "test_db",
    });
    openTab({
      id: "tab-1",
      title: "Consulta 1",
      type: "query",
      database: "test_db",
    });

    expect(useUIStore.getState().tabs.length).toBe(1);
  });

  it("should close tab and activate adjacent tab", () => {
    const { openTab, closeTab } = useUIStore.getState();
    openTab({
      id: "tab-1",
      title: "Consulta 1",
      type: "query",
      database: "test_db",
    });
    openTab({
      id: "tab-2",
      title: "Consulta 2",
      type: "query",
      database: "test_db",
    });

    expect(useUIStore.getState().activeTabId).toBe("tab-2");

    closeTab("tab-2");
    const state = useUIStore.getState();
    expect(state.tabs.length).toBe(1);
    expect(state.activeTabId).toBe("tab-1");
  });

  it("should reorder tabs properly", () => {
    const { openTab, reorderTabs } = useUIStore.getState();
    openTab({ id: "t1", title: "Tab 1", type: "query", database: "db" });
    openTab({ id: "t2", title: "Tab 2", type: "query", database: "db" });
    openTab({ id: "t3", title: "Tab 3", type: "query", database: "db" });

    // Move t1 from index 0 to index 2 (at the end)
    reorderTabs(0, 2);
    let ids = useUIStore.getState().tabs.map((t) => t.id);
    expect(ids).toEqual(["t2", "t3", "t1"]);

    // Move t1 back to index 0
    reorderTabs(2, 0);
    ids = useUIStore.getState().tabs.map((t) => t.id);
    expect(ids).toEqual(["t1", "t2", "t3"]);
  });

  it("should close other tabs", () => {
    const { openTab, closeOtherTabs } = useUIStore.getState();
    openTab({ id: "t1", title: "Tab 1", type: "query", database: "db" });
    openTab({ id: "t2", title: "Tab 2", type: "query", database: "db" });
    openTab({ id: "t3", title: "Tab 3", type: "query", database: "db" });

    closeOtherTabs("t2");
    const state = useUIStore.getState();
    expect(state.tabs.length).toBe(1);
    expect(state.tabs[0].id).toBe("t2");
    expect(state.activeTabId).toBe("t2");
  });

  it("should close tabs to the right", () => {
    const { openTab, closeTabsToTheRight } = useUIStore.getState();
    openTab({ id: "t1", title: "Tab 1", type: "query", database: "db" });
    openTab({ id: "t2", title: "Tab 2", type: "query", database: "db" });
    openTab({ id: "t3", title: "Tab 3", type: "query", database: "db" });
    openTab({ id: "t4", title: "Tab 4", type: "query", database: "db" });

    closeTabsToTheRight("t2");
    const state = useUIStore.getState();
    expect(state.tabs.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(state.activeTabId).toBe("t2");
  });

  it("should close tabs to the left", () => {
    const { openTab, closeTabsToTheLeft } = useUIStore.getState();
    openTab({ id: "t1", title: "Tab 1", type: "query", database: "db" });
    openTab({ id: "t2", title: "Tab 2", type: "query", database: "db" });
    openTab({ id: "t3", title: "Tab 3", type: "query", database: "db" });
    openTab({ id: "t4", title: "Tab 4", type: "query", database: "db" });

    closeTabsToTheLeft("t3");
    const state = useUIStore.getState();
    expect(state.tabs.map((t) => t.id)).toEqual(["t3", "t4"]);
    expect(state.activeTabId).toBe("t4");
  });

  it("should duplicate a tab", () => {
    const { openTab, duplicateTab } = useUIStore.getState();
    openTab({ id: "t1", title: "Tab 1", type: "query", database: "db", queryContent: "SELECT 1;" });

    duplicateTab("t1");
    const state = useUIStore.getState();
    expect(state.tabs.length).toBe(2);
    expect(state.tabs[1].title).toBe("Tab 1 (Copia)");
    expect(state.tabs[1].queryContent).toBe("SELECT 1;");
    expect(state.activeTabId).toBe(state.tabs[1].id);
  });

  it("should rename a tab", () => {
    const { openTab, renameTab } = useUIStore.getState();
    openTab({ id: "t1", title: "Tab 1", type: "query", database: "db" });

    renameTab("t1", "Nueva Consulta Reportes");
    const state = useUIStore.getState();
    expect(state.tabs[0].title).toBe("Nueva Consulta Reportes");

    // Should ignore empty rename
    renameTab("t1", "   ");
    expect(useUIStore.getState().tabs[0].title).toBe("Nueva Consulta Reportes");
  });

  it("should update tab query content", () => {
    const { openTab, updateTabQuery } = useUIStore.getState();
    openTab({
      id: "tab-1",
      title: "Consulta 1",
      type: "query",
      database: "test_db",
      queryContent: "SELECT 1;",
    });

    updateTabQuery("tab-1", "SELECT 2;");
    const tab = useUIStore.getState().tabs.find((t) => t.id === "tab-1");
    expect(tab?.queryContent).toBe("SELECT 2;");
  });

  it("should open and close SQL export modal", () => {
    const { openSqlExportModal, closeSqlExportModal } = useUIStore.getState();

    openSqlExportModal({ database: "test_db", table: "users" });
    let state = useUIStore.getState();
    expect(state.isSqlExportModalOpen).toBe(true);
    expect(state.sqlExportTarget).toEqual({ database: "test_db", table: "users" });

    closeSqlExportModal();
    state = useUIStore.getState();
    expect(state.isSqlExportModalOpen).toBe(false);
    expect(state.sqlExportTarget).toBeNull();
  });

  it("should open and close Backup & Restore modal with target DB and tab", () => {
    const { openBackupRestoreModal, closeBackupRestoreModal } = useUIStore.getState();

    openBackupRestoreModal({ tab: "restore", targetDatabase: "production_db" });
    let state = useUIStore.getState();
    expect(state.isBackupRestoreModalOpen).toBe(true);
    expect(state.backupRestoreInitialTab).toBe("restore");
    expect(state.backupRestoreTargetDatabase).toBe("production_db");

    closeBackupRestoreModal();
    state = useUIStore.getState();
    expect(state.isBackupRestoreModalOpen).toBe(false);
    expect(state.backupRestoreTargetDatabase).toBeNull();
  });

  it("should open alert dialog and close it", () => {
    const { showAlert, closeDialog } = useUIStore.getState();

    showAlert({
      title: "Alerta de Prueba",
      message: "Este es un mensaje de alerta modal.",
      variant: "warning",
    });

    let state = useUIStore.getState();
    expect(state.activeDialog).not.toBeNull();
    expect(state.activeDialog?.title).toBe("Alerta de Prueba");
    expect(state.activeDialog?.hideCancel).toBe(true);
    expect(state.activeDialog?.variant).toBe("warning");

    closeDialog();
    state = useUIStore.getState();
    expect(state.activeDialog).toBeNull();
  });

  it("should open confirm dialog and close it", () => {
    const { showConfirm, closeDialog } = useUIStore.getState();
    let confirmed = false;

    showConfirm({
      title: "Confirmar Acción",
      message: "¿Deseas continuar?",
      onConfirm: () => {
        confirmed = true;
      },
    });

    let state = useUIStore.getState();
    expect(state.activeDialog).not.toBeNull();
    expect(state.activeDialog?.title).toBe("Confirmar Acción");
    expect(state.activeDialog?.hideCancel).toBe(false);
    expect(state.activeDialog?.confirmText).toBe("Eliminar");

    state.activeDialog?.onConfirm?.();
    expect(confirmed).toBe(true);

    closeDialog();
    state = useUIStore.getState();
    expect(state.activeDialog).toBeNull();
  });
});
