import React, { useEffect, useState, useRef, useCallback } from "react";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { TabManager } from "./components/TabManager";
import { TableViewer } from "./components/TableViewer";
import { QueryEditorTab } from "./components/QueryEditorTab";
import { RoutineEditorTab } from "./components/RoutineEditorTab";
import { TriggerEditorTab } from "./components/TriggerEditorTab";
import { WelcomeView } from "./components/WelcomeView";
import { StatusFooter } from "./components/StatusFooter";
import { ConnectionModal } from "./components/ConnectionModal";
import { CreateTableModal } from "./components/CreateTableModal";
import { CreateDatabaseModal } from "./components/CreateDatabaseModal";
import { RenameTableModal } from "./components/RenameTableModal";
import { ExcelImportModal } from "./components/ExcelImportModal";
import { SqlExportModal } from "./components/SqlExportModal";
import { BackupRestoreModal } from "./components/BackupRestoreModal";
import { DashboardTab } from "./components/DashboardTab";
import { HealthMonitorTab } from "./components/HealthMonitorTab";
import { SlowQueryAnalyzerTab } from "./components/SlowQueryAnalyzerTab";
import { IndexAdvisorTab } from "./components/IndexAdvisorTab";
import { SchemaDiffTab } from "./components/SchemaDiffTab";
import { DatabaseOperationsTab } from "./components/DatabaseOperationsTab";
import { DatabaseTablesOverviewTab } from "./components/DatabaseTablesOverviewTab";
import { DatabaseAgentTab } from "./components/DatabaseAgentTab";
import { AiSettingsModal } from "./components/AiSettingsModal";
import { SmartSearchModal } from "./components/SmartSearchModal";
import { DatabaseReportsModal } from "./components/DatabaseReportsModal";
import { ConfirmModal } from "./components/ConfirmModal";
import { CommandPalette } from "./components/CommandPalette";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { SettingsModal } from "./components/SettingsModal";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { recentWorkStorage } from "./services/recentWorkStorage";
import { useConnectionStore } from "./stores/connectionStore";
import { useSchemaStore } from "./stores/schemaStore";
import { useUIStore } from "./stores/uiStore";
import { useWorkspaceStore } from "./stores/workspaceStore";
import { ObjectBrowserTab } from "./components/ObjectBrowserTab";
import { activeSavedConnectionId } from "./types/database";
import { useAiStore } from "./stores/aiStore";
import { useFeatureGate } from "./stores/capabilitiesStore";
import { activeSqlDialect } from "./services/sqlDialect";
import { qualifiedTable } from "./services/sqlLiterals";
import { useIsLightTheme, usePreferenceStore } from "./stores/preferenceStore";
import { formatSql } from "./services/sqlFormat";
import { useIsWideLayout } from "./components/ui/RightDock";
import type {
  ConnectionConfig,
  TableMetadata,
} from "./types/database";

export const App: React.FC = () => {
  const gate = useFeatureGate();
  // Connection store
  const {
    connectionStatus,
    isConnecting,
    isRefreshing,
    setIsRefreshing,
    checkInitialStatus,
    testConnection,
    connect,
    disconnect,
  } = useConnectionStore();

  // Schema store
  const {
    databases,
    selectedDatabase,
    tables,
    routines,
    triggers,
    isLoadingTables,
    isDbListLoading,
    setSelectedDatabase,
    loadDatabases,
    loadSchemaObjects,
    dropTable,
    clearSchema,
  } = useSchemaStore();

  // UI store
  const {
    tabs,
    activeTabId,
    profilesVersion,
    isConnectModalOpen,
    selectedProfileForModal,
    isCreateTableModalOpen,
    createTableDbName,
    isImportModalOpen,
    importTarget,
    isSqlExportModalOpen,
    sqlExportTarget,
    openTab,
    closeTab,
    closeOtherTabs,
    closeTabsToTheRight,
    closeTabsToTheLeft,
    reorderTabs,
    duplicateTab,
    renameTab,
    setActiveTabId,
    updateTabQuery,
    clearTabs,
    openConnectModal,
    closeConnectModal,
    openCreateTableModal,
    closeCreateTableModal,
    isCreateDatabaseModalOpen,
    openCreateDatabaseModal,
    closeCreateDatabaseModal,
    openImportModal,
    closeImportModal,
    openSqlExportModal,
    closeSqlExportModal,
    openBackupRestoreModal,
    bumpProfilesVersion,
    activeDialog,
    showAlert,
    showConfirm,
    closeDialog,
    toggleCommandPalette,
    isShortcutsModalOpen,
    closeShortcutsModal,
    toggleShortcutsModal,
    isSettingsModalOpen,
    openSettingsModal,
    closeSettingsModal,
  } = useUIStore();

  // AI store
  const {
    isAiSettingsOpen,
    isSmartSearchOpen,
    isReportsModalOpen,
    openAiSettings,
    closeAiSettings,
    openSmartSearch,
    closeSmartSearch,
    openReportsModal,
    closeReportsModal,
  } = useAiStore();

  // Resizable & Collapsible Sidebar state
  // Split view: a second tab shown to the right of the active one (wide screens only).
  const isWideLayout = useIsWideLayout();
  const [splitTabId, setSplitTabId] = useState<string | null>(null);
  const isSplitView =
    isWideLayout && !!splitTabId && splitTabId !== activeTabId && tabs.some((t) => t.id === splitTabId);
  useEffect(() => {
    if (splitTabId && !tabs.some((t) => t.id === splitTabId)) setSplitTabId(null);
  }, [tabs, splitTabId]);
  const handleSelectTab = useCallback(
    (id: string) => {
      // Selecting the right-hand tab swaps both panes instead of collapsing the split.
      if (id === splitTabId && activeTabId) setSplitTabId(activeTabId);
      setActiveTabId(id);
    },
    [splitTabId, activeTabId, setActiveTabId],
  );

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("pyro_sidebar_width");
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 180 && parsed <= 550) return parsed;
      }
    } catch {}
    return 260;
  });

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("pyro_sidebar_collapsed") === "true";
    } catch {}
    return false;
  });

  const isDraggingSidebarSplitterRef = useRef(false);
  const startDragXRef = useRef(0);
  const startSidebarWidthRef = useRef(sidebarWidth);

  const handleSidebarSplitterMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingSidebarSplitterRef.current = true;
      startDragXRef.current = e.clientX;
      startSidebarWidthRef.current = sidebarWidth;

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!isDraggingSidebarSplitterRef.current) return;
        const deltaX = moveEvent.clientX - startDragXRef.current;
        const newWidth = Math.max(180, Math.min(550, startSidebarWidthRef.current + deltaX));
        setSidebarWidth(newWidth);
        try {
          localStorage.setItem("pyro_sidebar_width", String(newWidth));
        } catch {}
      };

      const onMouseUp = () => {
        isDraggingSidebarSplitterRef.current = false;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [sidebarWidth],
  );

  // Global Keyboard shortcuts (F1: Shortcuts Help, Ctrl+K: Command Palette, Ctrl+B: Toggle Sidebar, Ctrl+,: Settings)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F1") {
        e.preventDefault();
        toggleShortcutsModal();
      } else if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        openSettingsModal();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setIsSidebarCollapsed((prev: boolean) => {
          const next = !prev;
          try {
            localStorage.setItem("pyro_sidebar_collapsed", String(next));
          } catch {}
          return next;
        });
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "k"
      ) {
        e.preventDefault();
        openSmartSearch();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === "k" ||
          e.key.toLowerCase() === "p" ||
          (e.shiftKey && e.key.toLowerCase() === "p"))
      ) {
        e.preventDefault();
        toggleCommandPalette();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "a"
      ) {
        e.preventDefault();
        openAiSettings();
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [openSmartSearch, openAiSettings, openSettingsModal, toggleCommandPalette, toggleShortcutsModal]);

  // Load the configured workspace (if any) and pick up external edits when the
  // window regains focus (e.g. files synced from another computer).
  useEffect(() => {
    const workspace = useWorkspaceStore.getState();
    workspace.init().then(() => bumpProfilesVersion());
    let lastReload = 0;
    const onFocus = () => {
      if (!useWorkspaceStore.getState().isFolderMode() || Date.now() - lastReload < 3000) return;
      lastReload = Date.now();
      useWorkspaceStore.getState().reload();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Initial check of connection status on mount
  useEffect(() => {
    let isMounted = true;
    checkInitialStatus().then((status) => {
      if (isMounted && status.is_connected) {
        const initialDb = status.config?.database?.trim() || undefined;
        loadDatabases(initialDb);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [checkInitialStatus, loadDatabases]);

  const handleConnect = async (config: ConnectionConfig) => {
    try {
      await connect(config);
      closeConnectModal();
      setSelectedDatabase(null);
      const initialDb = config.database?.trim() || undefined;
      await loadDatabases(initialDb);

      // Record in Recent Work
      recentWorkStorage.saveLastConnection({
        profileId: config.savedConnectionId || `conn-${Date.now()}`,
        profileName: config.savedConnectionName || config.host,
        environment: config.environment || "local",
        database: initialDb,
        host: config.host,
        port: config.port,
        user: config.user,
        connectedAt: Date.now(),
      });
    } catch (err) {
      console.error("Connection failed:", err);
      throw err;
    }
  };

  const handleDisconnect = async () => {
    await disconnect();
    clearSchema();
    clearTabs();
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await loadDatabases();
      if (selectedDatabase) {
        await loadSchemaObjects(selectedDatabase);
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  // Switching the active database closes the tabs of the previous one, so ask
  // first whenever there is something open to lose.
  const handleSelectDatabase = (dbName: string) => {
    const activate = () => {
      setSelectedDatabase(dbName);
      loadSchemaObjects(dbName);
    };
    const tabsToClose = tabs.filter((t) => t.database !== dbName);
    if (!selectedDatabase || dbName === selectedDatabase || tabsToClose.length === 0) {
      activate();
      return;
    }
    const modifiedCount = tabsToClose.filter((t) => t.isModified).length;
    showConfirm({
      title: `Activar '${dbName}'`,
      message: `Se cerrarán ${tabsToClose.length} pestaña(s) de '${selectedDatabase}'. Solo se trabaja sobre una base de datos a la vez.`,
      details: modifiedCount > 0
        ? `${modifiedCount} pestaña(s) tienen cambios sin guardar que se perderán.`
        : undefined,
      variant: modifiedCount > 0 ? "warning" : "primary",
      icon: modifiedCount > 0 ? "alert" : "info",
      confirmText: "Cambiar de base de datos",
      onConfirm: activate,
    });
  };

  const handleOpenCreateTable = (dbName?: string) => {
    const targetDb =
      dbName ||
      selectedDatabase ||
      (databases.length > 0 ? databases[0].name : "test");
    openCreateTableModal(targetDb);
  };

  const handleOpenImportExcel = (dbName: string, tableName?: string) => {
    openImportModal({ database: dbName, table: tableName });
  };

  const handleTableCreated = async (dbName: string, tableName: string) => {
    await loadSchemaObjects(dbName);
    await loadDatabases();
    handleSelectTable(dbName, {
      name: tableName,
      table_type: "BASE TABLE",
      engine: "InnoDB",
    });
  };

  const [tableToRename, setTableToRename] = useState<{ database: string; table: string } | null>(null);

  const handleDropTable = async (dbName: string, tableName: string) => {
    try {
      await dropTable(dbName, tableName);
      const tabId = `table-${dbName}-${tableName}`;
      closeTab(tabId);
    } catch (err) {
      console.error("Failed to drop table:", err);
      showAlert({
        title: "Error al Eliminar Tabla",
        message: `No se pudo eliminar la tabla '${tableName}' de la base de datos '${dbName}'.`,
        details: typeof err === "string" ? err : (err as Error)?.message || String(err),
        variant: "danger",
        icon: "trash",
      });
    }
  };

  const handleSelectTable = (dbName: string, table: TableMetadata) => {
    const tabId = `table-${dbName}-${table.name}`;
    openTab({
      id: tabId,
      title: table.name,
      type: "table",
      database: dbName,
      tableName: table.name,
    });
    setSelectedDatabase(dbName);
    recentWorkStorage.recordTableOpened(dbName, table.name);
  };

  const handleSelectRoutine = (
    dbName: string,
    routineName: string,
    routineType: "PROCEDURE" | "FUNCTION",
  ) => {
    const tabId = `routine-${dbName}-${routineName}`;
    openTab({
      id: tabId,
      title: routineName,
      type: "routine",
      database: dbName,
      routineName,
      routineType,
    });
    setSelectedDatabase(dbName);
  };

  const handleSelectTrigger = (dbName: string, triggerName: string) => {
    const tabId = `trigger-${dbName}-${triggerName}`;
    openTab({
      id: tabId,
      title: triggerName,
      type: "trigger",
      database: dbName,
      triggerName,
    });
    setSelectedDatabase(dbName);
  };

  const handleOpenCreateRoutine = (
    dbName: string,
    routineType: "PROCEDURE" | "FUNCTION",
  ) => {
    const defaultName =
      routineType === "PROCEDURE" ? "sp_nuevo_procedimiento" : "fn_nueva_funcion";
    const tabId = `routine-${dbName}-${Date.now()}`;
    openTab({
      id: tabId,
      title: defaultName,
      type: "routine",
      database: dbName,
      routineName: defaultName,
      routineType,
    });
  };

  const handleOpenCreateTrigger = (dbName: string, tableName?: string) => {
    const defaultName = tableName
      ? `trg_${tableName}_before_insert`
      : "trg_nuevo_trigger";
    const tabId = `trigger-${dbName}-${Date.now()}`;
    openTab({
      id: tabId,
      title: defaultName,
      type: "trigger",
      database: dbName,
      tableName: tableName,
      triggerName: defaultName,
    });
  };

  const handleNewQueryTab = (initialSql?: string, dbName?: string) => {
    const currentDb =
      dbName ||
      selectedDatabase ||
      (databases.length > 0 ? databases[0].name : "information_schema");
    const queryCount = tabs.filter((t) => t.type === "query").length + 1;
    const tabId = `query-${Date.now()}`;
    const initialTbl =
      tables[currentDb] && tables[currentDb].length > 0
        ? tables[currentDb][0].name
        : "";
    const dialect = activeSqlDialect();
    let defaultSql =
      initialSql ||
      (initialTbl
        ? `SELECT * FROM ${qualifiedTable(dialect, currentDb, initialTbl)} LIMIT 100;`
        : dialect.sessionInfoQuery);
    // The starter query is generated here, so show it already formatted.
    if (!initialSql) {
      try {
        defaultSql = formatSql(
          defaultSql,
          usePreferenceStore.getState().sqlFormat,
          dialect.formatterLanguage,
        );
      } catch {
        // Keep the raw starter query if the formatter cannot parse it.
      }
    }

    openTab({
      id: tabId,
      title: `Consulta ${queryCount}`,
      type: "query",
      database: currentDb,
      queryContent: defaultSql,
    });
  };

  // P3 Diagnostic & Administration Tab Handlers
  const handleOpenDashboard = (dbName?: string) => {
    const targetDb =
      dbName ||
      selectedDatabase ||
      (databases.length > 0 ? databases[0].name : "test");
    const tabId = `dashboard-${targetDb}`;
    openTab({
      id: tabId,
      title: `Panel de Control (${targetDb})`,
      type: "dashboard",
      database: targetDb,
    });
    setSelectedDatabase(targetDb);
  };

  const handleOpenHealth = (dbName?: string) => {
    const targetDb =
      dbName ||
      selectedDatabase ||
      (databases.length > 0 ? databases[0].name : "test");
    const tabId = `health-${targetDb}`;
    openTab({
      id: tabId,
      title: `Salud (${targetDb})`,
      type: "health",
      database: targetDb,
    });
    setSelectedDatabase(targetDb);
  };

  const handleOpenSlowQuery = (
    dbName?: string,
    initialSql?: string,
    initialView?: "custom" | "server_log",
  ) => {
    const targetDb =
      dbName ||
      selectedDatabase ||
      (databases.length > 0 ? databases[0].name : "test");
    const tabId = `slow-query-${targetDb}-${Date.now()}`;
    openTab({
      id: tabId,
      title: `Consultas Lentas (${targetDb})`,
      type: "slow_query",
      database: targetDb,
      queryContent: initialSql || "",
      initialView,
    });
    setSelectedDatabase(targetDb);
  };

  const handleOpenIndexAdvisor = (dbName?: string) => {
    const targetDb =
      dbName ||
      selectedDatabase ||
      (databases.length > 0 ? databases[0].name : "test");
    const tabId = `advisor-${targetDb}`;
    openTab({
      id: tabId,
      title: `Asesor de Índices (${targetDb})`,
      type: "advisor",
      database: targetDb,
    });
    setSelectedDatabase(targetDb);
  };

  const handleOpenSchemaDiff = (sourceDb?: string, targetDb?: string) => {
    const sDb =
      sourceDb ||
      selectedDatabase ||
      (databases.length > 0 ? databases[0].name : "test");
    const tDb =
      targetDb ||
      (databases.length > 1
        ? databases.find((d) => d.name !== sDb)?.name || sDb
        : sDb);
    const tabId = `diff-${sDb}-vs-${tDb}-${Date.now()}`;
    openTab({
      id: tabId,
      title: `Diferencias: ${sDb} ➔ ${tDb}`,
      type: "diff",
      database: sDb,
      targetDatabase: tDb,
    });
  };

  const handleOpenOperations = (dbName?: string) => {
    const targetDb =
      dbName ||
      selectedDatabase ||
      (databases.length > 0 ? databases[0].name : "test");
    const tabId = `operations-${targetDb}`;
    openTab({
      id: tabId,
      title: `Mantenimiento (${targetDb})`,
      type: "operations",
      database: targetDb,
    });
    setSelectedDatabase(targetDb);
  };

  const handleOpenTablesOverview = (dbName?: string) => {
    const targetDb =
      dbName ||
      selectedDatabase ||
      (databases.length > 0 ? databases[0].name : "test");
    const tabId = `tables-overview-${targetDb}`;
    openTab({
      id: tabId,
      title: `Tablas (${targetDb})`,
      type: "tables_overview",
      database: targetDb,
    });
    setSelectedDatabase(targetDb);
  };

  const handleOpenAgent = (dbName?: string) => {
    const targetDb =
      dbName ||
      selectedDatabase ||
      (databases.length > 0 ? databases[0].name : "test");
    const tabId = `agent-${targetDb}`;
    openTab({
      id: tabId,
      title: `Agente BD (${targetDb})`,
      type: "agent",
      database: targetDb,
    });
    setSelectedDatabase(targetDb);
  };

  const handleOpenReports = (dbName?: string) => {
    if (dbName) setSelectedDatabase(dbName);
    openReportsModal();
  };

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const isLight = useIsLightTheme();

  return (
    <div
      className="flex flex-col h-screen w-screen overflow-hidden transition-colors bg-canvas text-fg"
    >
      {/* Top Application Header */}
      <Header
        connectionStatus={connectionStatus}
        onOpenConnectModal={() => openConnectModal()}
        onDisconnect={handleDisconnect}
        onRefresh={handleRefresh}
        onToggleSidebar={() =>
          setIsSidebarCollapsed((prev: boolean) => {
            const next = !prev;
            try {
              localStorage.setItem("pyro_sidebar_collapsed", String(next));
            } catch {}
            return next;
          })
        }
        isSidebarCollapsed={isSidebarCollapsed}
        onNewQuery={connectionStatus.is_connected ? () => handleNewQueryTab() : undefined}
        onOpenDashboard={connectionStatus.is_connected ? gate("dashboard", () => handleOpenDashboard()) : undefined}
        onOpenHealth={connectionStatus.is_connected ? gate("healthMonitor", () => handleOpenHealth()) : undefined}
        onOpenSlowQuery={
          connectionStatus.is_connected ? gate("slowQueryAnalyzer", () => handleOpenSlowQuery()) : undefined
        }
        onOpenAdvisor={
          connectionStatus.is_connected ? gate("indexAdvisor", () => handleOpenIndexAdvisor()) : undefined
        }
        onOpenDiff={connectionStatus.is_connected ? gate("schemaDiff", () => handleOpenSchemaDiff()) : undefined}
        onOpenOperations={
          connectionStatus.is_connected ? gate("tableMaintenance", () => handleOpenOperations()) : undefined
        }
        onOpenBackupRestore={
          connectionStatus.is_connected
            ? () => openBackupRestoreModal({ tab: "backup" })
            : undefined
        }
        onOpenAgent={connectionStatus.is_connected ? gate("databaseAgent", () => handleOpenAgent()) : undefined}
        onOpenSmartSearch={connectionStatus.is_connected ? () => openSmartSearch() : undefined}
        onOpenReports={
          connectionStatus.is_connected ? gate("databaseReports", () => handleOpenReports()) : undefined
        }
        isRefreshing={isRefreshing}
      />

      {/* Main Workspace (Sidebar + Tabs & Content) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Hierarchical Sidebar */}
        {connectionStatus.is_connected && !isSidebarCollapsed && (
          <>
            <div style={{ width: `${sidebarWidth}px` }} className="shrink-0 h-full">
              <Sidebar
                width={sidebarWidth}
                onCollapse={() => {
                  setIsSidebarCollapsed(true);
                  try {
                    localStorage.setItem("pyro_sidebar_collapsed", "true");
                  } catch {}
                }}
                databases={databases}
                selectedDatabase={selectedDatabase}
                onSelectDatabase={handleSelectDatabase}
                tables={tables}
                routines={routines}
                triggers={triggers}
                isLoadingTables={isLoadingTables}
                onSelectTable={handleSelectTable}
                onSelectRoutine={handleSelectRoutine}
                onSelectTrigger={handleSelectTrigger}
                onNewQueryTab={handleNewQueryTab}
                onOpenCreateDatabase={gate("databaseManagement", openCreateDatabaseModal)}
                onOpenCreateTable={handleOpenCreateTable}
                onOpenImportExcel={(db, tbl) =>
                  openImportModal({ database: db, table: tbl })
                }
                onOpenSqlExport={gate("sqlDump", (db: string, tbl?: string) =>
                  openSqlExportModal({ database: db, table: tbl }),
                )}
                onOpenBackupRestore={(db, tab) =>
                  openBackupRestoreModal({ targetDatabase: db, tab })
                }
                onDropTable={handleDropTable}
                onRenameTable={(database, table) => setTableToRename({ database, table })}
                onOpenCreateRoutine={gate("routines", handleOpenCreateRoutine)}
                onOpenCreateTrigger={handleOpenCreateTrigger}
                onOpenDashboard={gate("dashboard", handleOpenDashboard)}
                onOpenHealth={gate("healthMonitor", handleOpenHealth)}
                onOpenSlowQuery={gate("slowQueryAnalyzer", handleOpenSlowQuery)}
                onOpenIndexAdvisor={gate("indexAdvisor", handleOpenIndexAdvisor)}
                onOpenSchemaDiff={gate("schemaDiff", handleOpenSchemaDiff)}
                onOpenOperations={gate("tableMaintenance", handleOpenOperations)}
                onOpenTablesOverview={gate("tableStorageDetails", handleOpenTablesOverview)}
                onOpenAgent={gate("databaseAgent", handleOpenAgent)}
                onOpenReports={gate("databaseReports", handleOpenReports)}
                activeTable={
                  activeTab?.tableName
                    ? `${activeTab.database}.${activeTab.tableName}`
                    : undefined
                }
                activeRoutine={
                  activeTab?.routineName
                    ? `${activeTab.database}.${activeTab.routineName}`
                    : undefined
                }
                activeTrigger={
                  activeTab?.triggerName
                    ? `${activeTab.database}.${activeTab.triggerName}`
                    : undefined
                }
                isDbListLoading={isDbListLoading}
              />
            </div>
            {/* Splitter Drag Handle */}
            <div
              onMouseDown={handleSidebarSplitterMouseDown}
              title="Arrastra para redimensionar el explorador lateral"
              className={`w-1 hover:w-1.5 active:w-1.5 cursor-col-resize transition-all select-none shrink-0 z-20 ${
                isLight
                  ? "bg-slate-200 hover:bg-orange-500/50 active:bg-orange-500"
                  : "bg-raised hover:bg-orange-500/50 active:bg-orange-500"
              }`}
            />
          </>
        )}

        {/* Center Canvas */}
        <div
          className={`flex-1 flex flex-col overflow-hidden transition-colors ${
            isLight ? "bg-slate-100" : "bg-canvas"
          }`}
        >
          {/* Tab Bar */}
          {tabs.length > 0 && (
            <TabManager
              tabs={tabs}
              activeTabId={activeTabId}
              onSelectTab={handleSelectTab}
              splitTabId={isSplitView ? splitTabId : null}
              onSplitTab={isWideLayout ? setSplitTabId : undefined}
              onCloseTab={closeTab}
              onCloseOtherTabs={closeOtherTabs}
              onCloseTabsToRight={closeTabsToTheRight}
              onCloseTabsToLeft={closeTabsToTheLeft}
              onCloseAllTabs={clearTabs}
              onReorderTabs={reorderTabs}
              onDuplicateTab={duplicateTab}
              onRenameTab={renameTab}
              onNewQueryTab={() => handleNewQueryTab()}
            />
          )}

          {/* Tab Content or Welcome Screen */}
          <main className={`flex-1 overflow-hidden relative flex ${isSplitView ? "flex-row" : "flex-col"}`}>
            {tabs.length === 0 ? (
              <WelcomeView
                onOpenConnectModal={(p) => openConnectModal(p)}
                isConnected={connectionStatus.is_connected}
                databasesCount={databases.length}
                onQuickConnect={handleConnect}
                profilesVersion={profilesVersion}
                onNewQuery={() => handleNewQueryTab()}
              />
            ) : (
              tabs.map((tab) => {
                const isActive = tab.id === activeTabId;
                const isSplit = isSplitView && tab.id === splitTabId;
                const tabTableMeta =
                  tab.type === "table" && tab.tableName
                    ? (tables[tab.database] || []).find(
                        (t) => t.name === tab.tableName,
                      ) || {
                        name: tab.tableName,
                        table_type: "BASE TABLE",
                      }
                    : null;

                return (
                  <div
                    key={tab.id}
                    className={`h-full flex flex-col ${
                      isSplitView ? "flex-1 basis-0 min-w-0" : "w-full"
                    } ${isActive ? "order-1" : isSplit ? "order-2 border-l border-line" : "hidden"}`}
                  >
                    <ErrorBoundary
                      fallbackTitle={`Error en pestaña: ${tab.title}`}
                      onClose={() => closeTab(tab.id)}
                    >
                      {tab.type === "query" && (
                        <QueryEditorTab
                          tabId={tab.id}
                          savedQueryId={tab.savedQueryId}
                          pendingFolder={tab.pendingFolder}
                          database={tab.database}
                          initialQuery={tab.queryContent}
                          onQueryChange={(newQuery) =>
                            updateTabQuery(tab.id, newQuery)
                          }
                        />
                      )}
                      {tab.type === "table" && tabTableMeta && (
                        <TableViewer
                          database={tab.database}
                          table={tabTableMeta}
                          onRefreshTable={() => loadSchemaObjects(tab.database)}
                          onTableDeleted={handleDropTable}
                          onOpenCreateTrigger={handleOpenCreateTrigger}
                        />
                      )}
                      {tab.type === "objects" && tab.objectKind && (
                        <ObjectBrowserTab
                          database={tab.database}
                          kind={tab.objectKind}
                          connectionId={activeSavedConnectionId(connectionStatus.config)}
                          onOpenTable={handleSelectTable}
                          onCreateTable={handleOpenCreateTable}
                          onDropTable={handleDropTable}
                          onOpenRoutine={handleSelectRoutine}
                          onCreateRoutine={handleOpenCreateRoutine}
                        />
                      )}
                      {tab.type === "tables_overview" && (
                        <DatabaseTablesOverviewTab
                          database={tab.database}
                          onOpenTableData={(tblName) =>
                            handleSelectTable(tab.database, {
                              name: tblName,
                              table_type: "BASE TABLE",
                            })
                          }
                          onOpenCreateTable={handleOpenCreateTable}
                          onOpenImportExcel={handleOpenImportExcel}
                          onOpenSqlExport={(db, tbl) =>
                            openSqlExportModal({ database: db, table: tbl })
                          }
                          onOpenOperations={() => handleOpenOperations(tab.database)}
                        />
                      )}
                      {tab.type === "routine" && tab.routineName && (
                        <RoutineEditorTab
                          database={tab.database}
                          routineName={tab.routineName}
                          routineType={tab.routineType || "PROCEDURE"}
                          onRoutineDeleted={() => {
                            closeTab(tab.id);
                            loadSchemaObjects(tab.database);
                          }}
                        />
                      )}
                      {tab.type === "trigger" && tab.triggerName && (
                        <TriggerEditorTab
                          database={tab.database}
                          triggerName={tab.triggerName}
                          initialTableName={tab.tableName}
                          onTriggerDeleted={() => {
                            closeTab(tab.id);
                            loadSchemaObjects(tab.database);
                          }}
                        />
                      )}
                      {tab.type === "dashboard" && (
                        <DashboardTab
                          database={tab.database}
                          onOpenSlowQuery={(view) =>
                            handleOpenSlowQuery(tab.database, undefined, view)
                          }
                          onOpenTablesOverview={() => handleOpenTablesOverview(tab.database)}
                        />
                      )}
                      {tab.type === "health" && (
                        <HealthMonitorTab
                          database={tab.database}
                          onOpenSlowQuery={() => handleOpenSlowQuery(tab.database)}
                          onOpenAdvisor={() => handleOpenIndexAdvisor(tab.database)}
                          onOpenOperations={() => handleOpenOperations(tab.database)}
                        />
                      )}
                      {tab.type === "slow_query" && (
                        <SlowQueryAnalyzerTab
                          database={tab.database}
                          initialSql={tab.queryContent}
                          initialView={tab.initialView}
                        />
                      )}
                      {tab.type === "advisor" && (
                        <IndexAdvisorTab
                          database={tab.database}
                          onOpenQueryWithSql={(sql) =>
                            handleNewQueryTab(sql, tab.database)
                          }
                        />
                      )}
                      {tab.type === "diff" && (
                        <SchemaDiffTab
                          initialSourceDb={tab.database}
                          initialTargetDb={tab.targetDatabase}
                          databases={databases}
                          onExecuteMigration={(sql) =>
                            handleNewQueryTab(sql, tab.targetDatabase || tab.database)
                          }
                        />
                      )}
                      {tab.type === "operations" && (
                        <DatabaseOperationsTab
                          database={tab.database}
                          tables={tables[tab.database] || []}
                          onRefreshDatabase={() => loadSchemaObjects(tab.database)}
                        />
                      )}
                      {tab.type === "agent" && (
                        <DatabaseAgentTab
                          database={tab.database}
                          onOpenQuery={(sql) => handleNewQueryTab(sql, tab.database)}
                        />
                      )}
                    </ErrorBoundary>
                  </div>
                );
              })
            )}
          </main>
        </div>
      </div>

      {/* Status Footer */}
      <StatusFooter
        connectionStatus={connectionStatus}
        activeDatabase={selectedDatabase || undefined}
        activeTable={
          activeTab?.tableName || activeTab?.routineName || activeTab?.triggerName
        }
      />

      {/* Connection Dialog Modal */}
      <ConnectionModal
        isOpen={isConnectModalOpen}
        onClose={closeConnectModal}
        onConnect={handleConnect}
        onTest={testConnection}
        isConnecting={isConnecting}
        initialProfile={selectedProfileForModal}
        onProfilesUpdated={bumpProfilesVersion}
      />

      {/* Create Table Wizard Modal */}
      {isCreateTableModalOpen && createTableDbName && (
        <CreateTableModal
          isOpen={isCreateTableModalOpen}
          onClose={closeCreateTableModal}
          database={createTableDbName}
          onTableCreated={handleTableCreated}
        />
      )}

      <RenameTableModal
        target={tableToRename}
        onClose={() => setTableToRename(null)}
        onRenamed={async (database, oldName) => {
          closeTab(`table-${database}-${oldName}`);
          await loadSchemaObjects(database);
        }}
      />

      {/* Create Database Wizard Modal */}
      <CreateDatabaseModal
        isOpen={isCreateDatabaseModalOpen}
        onClose={closeCreateDatabaseModal}
        onDatabaseCreated={async (newDbName) => {
          await loadDatabases();
          setSelectedDatabase(newDbName);
          await loadSchemaObjects(newDbName);
        }}
      />

      {/* Excel Import Modal */}
      {isImportModalOpen && importTarget && (
        <ExcelImportModal
          isOpen={isImportModalOpen}
          onClose={closeImportModal}
          database={importTarget.database}
          table={importTarget.table}
          onImportComplete={async () => {
            await loadSchemaObjects(importTarget.database);
            await loadDatabases();
          }}
        />
      )}

      {/* SQL Dump Export Modal */}
      {isSqlExportModalOpen && sqlExportTarget && (
        <SqlExportModal
          isOpen={isSqlExportModalOpen}
          onClose={closeSqlExportModal}
          database={sqlExportTarget.database}
          table={sqlExportTarget.table}
        />
      )}

      {/* Backup and Restore Database Modal */}
      <BackupRestoreModal />

      {/* AI Settings Modal */}
      <AiSettingsModal
        isOpen={isAiSettingsOpen}
        onClose={closeAiSettings}
      />

      {/* Smart Search Modal */}
      <SmartSearchModal
        isOpen={isSmartSearchOpen}
        onClose={closeSmartSearch}
        database={selectedDatabase || (databases[0]?.name ?? "test")}
        onOpenTable={(tbl) =>
          handleSelectTable(selectedDatabase || (databases[0]?.name ?? "test"), {
            name: tbl,
            table_type: "BASE TABLE",
          })
        }
        onOpenQuery={(sql) => handleNewQueryTab(sql, selectedDatabase || undefined)}
      />

      {/* Database Reports Modal */}
      <DatabaseReportsModal
        isOpen={isReportsModalOpen}
        onClose={closeReportsModal}
        database={selectedDatabase || (databases[0]?.name ?? "test")}
      />

      {/* Global Command Palette */}
      <CommandPalette />

      {/* Shortcuts & Productivity Help Modal */}
      <ShortcutsModal
        isOpen={isShortcutsModalOpen}
        onClose={closeShortcutsModal}
      />

      {/* Settings & User Preferences Modal */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={closeSettingsModal}
      />

      {/* Global Alert / Confirm Modal */}
      {activeDialog && (
        <ConfirmModal
          isOpen={true}
          title={activeDialog.title}
          message={activeDialog.message}
          details={activeDialog.details}
          confirmText={activeDialog.confirmText}
          cancelText={activeDialog.cancelText}
          variant={activeDialog.variant}
          icon={activeDialog.icon}
          hideCancel={activeDialog.hideCancel}
          onConfirm={() => {
            if (activeDialog.onConfirm) {
              activeDialog.onConfirm();
            }
            closeDialog();
          }}
          onClose={() => {
            if (activeDialog.onClose) {
              activeDialog.onClose();
            }
            closeDialog();
          }}
        />
      )}
    </div>
  );
};

export default App;
