import { beforeEach, describe, expect, it } from "vitest";
import { useConnectionStore } from "../../stores/connectionStore";
import { useUIStore } from "../../stores/uiStore";
import { usePendingChangesStore } from "../../stores/pendingChangesStore";
import { useStagedChangesStore } from "../../stores/stagedChangesStore";
import type { ConnectionConfig, OpenTab } from "../../types/database";
import { endSession, restoreSession, sessionKey } from "../sessionRestore";

const config: ConnectionConfig = { host: "db.local", port: 3306, user: "ana", savedConnectionId: "conn-1" };
const queryTab: OpenTab = {
  id: "query-1",
  title: "Consulta 1",
  type: "query",
  database: "tienda",
  queryContent: "SELECT 1;",
  isModified: true,
};
const tableTab: OpenTab = { id: "tab_table_tienda_cliente", title: "cliente", type: "table", database: "tienda", tableName: "cliente" };

const connectAs = (c: ConnectionConfig | undefined) =>
  useConnectionStore.setState({ connectionStatus: c ? { is_connected: true, config: c } : { is_connected: false } });

beforeEach(() => {
  localStorage.clear();
  useUIStore.setState({ tabs: [], activeTabId: null, activeDialog: null });
  usePendingChangesStore.setState({ stagedByTab: {} });
  connectAs(undefined);
});

describe("restauración de sesión", () => {
  it("la clave coincide entre la configuración y el estado leído tras recargar", () => {
    expect(sessionKey(config)).toBe(
      sessionKey({ host: "db.local", port: 3306, username: "ana", tunnel_enabled: false }),
    );
  });

  it("guarda las pestañas al desconectar y las reabre al volver a conectar", () => {
    connectAs(config);
    restoreSession(config); // nothing saved yet: starts tracking this connection
    useUIStore.setState({ tabs: [queryTab, tableTab], activeTabId: tableTab.id });
    endSession();

    useUIStore.setState({ tabs: [], activeTabId: null });
    connectAs(config);
    const restored = restoreSession(config);

    expect(restored).toEqual({ tabs: 2, drafts: 1 });
    expect(useUIStore.getState().tabs.map((t) => t.id)).toEqual([queryTab.id, tableTab.id]);
    expect(useUIStore.getState().tabs[0].queryContent).toBe("SELECT 1;");
    expect(useUIStore.getState().activeTabId).toBe(tableTab.id);
  });

  it("no pisa la sesión guardada con una barra vacía antes de restaurar", () => {
    connectAs(config);
    restoreSession(config);
    useUIStore.setState({ tabs: [queryTab], activeTabId: queryTab.id });
    endSession();

    // Another connection, never restored: saving must not touch the first one.
    const other = { ...config, host: "otro" };
    connectAs(other);
    useUIStore.setState({ tabs: [], activeTabId: null });
    endSession();

    useUIStore.setState({ tabs: [] });
    connectAs(config);
    expect(restoreSession(config).tabs).toBe(1);
  });
});

describe("cambios del grid sin aplicar", () => {
  it("cerrar la pestaña pide confirmación y descartar limpia los cambios", () => {
    useUIStore.setState({ tabs: [tableTab], activeTabId: tableTab.id });
    useStagedChangesStore.getState().stageRowDelete({
      database: "tienda",
      table: "cliente",
      rowIndex: 0,
      originalRow: [1],
      primaryKeys: [{ column: "id", value: 1 }],
    });
    usePendingChangesStore.getState().setStaged(tableTab.id, { count: 1, database: "tienda", table: "cliente" });

    useUIStore.getState().closeTab(tableTab.id);
    const dialog = useUIStore.getState().activeDialog;
    expect(dialog?.title).toBe("Cambios sin aplicar");
    expect(useUIStore.getState().tabs).toHaveLength(1);

    dialog!.onConfirm!();
    expect(useUIStore.getState().tabs).toHaveLength(0);
    expect(useStagedChangesStore.getState().hasPendingChanges("tienda", "cliente")).toBe(false);
  });
});
