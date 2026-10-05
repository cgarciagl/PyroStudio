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
});
