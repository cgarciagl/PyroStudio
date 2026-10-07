import React, { useEffect } from "react";
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
import { useConnectionStore } from "./stores/connectionStore";
import { useSchemaStore } from "./stores/schemaStore";
import { useUIStore } from "./stores/uiStore";
import { useAiStore } from "./stores/aiStore";
import type {
  ConnectionConfig,
  TableMetadata,
} from "./types/database";

export const App: React.FC = () => {
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
    setActiveTabId,
    updateTabQuery,
    clearTabs,
    openConnectModal,
    closeConnectModal,
    openCreateTableModal,
    closeCreateTableModal,
    openImportModal,
    closeImportModal,
    openSqlExportModal,
    closeSqlExportModal,
    openBackupRestoreModal,
    bumpProfilesVersion,
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

  // Global Keyboard shortcuts (Ctrl+K: Smart Search, Ctrl+Shift+A: AI Settings)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openSmartSearch();
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
  }, [openSmartSearch, openAiSettings]);

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

  const handleSelectDatabase = (dbName: string) => {
    setSelectedDatabase(dbName);
    loadSchemaObjects(dbName);
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

  const handleDropTable = async (dbName: string, tableName: string) => {
    try {
      await dropTable(dbName, tableName);
      const tabId = `table-${dbName}-${tableName}`;
      closeTab(tabId);
    } catch (err) {
      console.error("Failed to drop table:", err);
      alert(`Error al eliminar tabla: ${err}`);
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

  const handleOpenCreateTrigger = (dbName: string) => {
    const defaultName = "trg_nuevo_trigger";
    const tabId = `trigger-${dbName}-${Date.now()}`;
    openTab({
      id: tabId,
      title: defaultName,
      type: "trigger",
      database: dbName,
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
    const defaultSql = initialSql || (initialTbl
      ? `SELECT * FROM \`${currentDb}\`.\`${initialTbl}\` LIMIT 100;`
      : `SELECT VERSION(), DATABASE(), USER();`);

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
      title: `Dashboard (${targetDb})`,
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
      title: `Slow Query (${targetDb})`,
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
      title: `Index Advisor (${targetDb})`,
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
      title: `Diff: ${sDb} ➔ ${tDb}`,
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

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#0a0b0e] text-neutral-200">
      {/* Top Application Header */}
      <Header
        connectionStatus={connectionStatus}
        onOpenConnectModal={() => openConnectModal()}
        onDisconnect={handleDisconnect}
        onRefresh={handleRefresh}
        onNewQuery={connectionStatus.is_connected ? () => handleNewQueryTab() : undefined}
        onOpenDashboard={connectionStatus.is_connected ? () => handleOpenDashboard() : undefined}
        onOpenHealth={connectionStatus.is_connected ? () => handleOpenHealth() : undefined}
        onOpenSlowQuery={connectionStatus.is_connected ? () => handleOpenSlowQuery() : undefined}
        onOpenAdvisor={connectionStatus.is_connected ? () => handleOpenIndexAdvisor() : undefined}
        onOpenDiff={connectionStatus.is_connected ? () => handleOpenSchemaDiff() : undefined}
        onOpenOperations={connectionStatus.is_connected ? () => handleOpenOperations() : undefined}
        onOpenBackupRestore={
          connectionStatus.is_connected
            ? () => openBackupRestoreModal({ tab: "backup" })
            : undefined
        }
        onOpenAgent={connectionStatus.is_connected ? () => handleOpenAgent() : undefined}
        onOpenSmartSearch={connectionStatus.is_connected ? () => openSmartSearch() : undefined}
        onOpenReports={connectionStatus.is_connected ? () => handleOpenReports() : undefined}
        isRefreshing={isRefreshing}
      />

      {/* Main Workspace (Sidebar + Tabs & Content) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Hierarchical Sidebar */}
        {connectionStatus.is_connected && (
          <Sidebar
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
            onOpenCreateTable={handleOpenCreateTable}
            onOpenImportExcel={(db, tbl) =>
              openImportModal({ database: db, table: tbl })
            }
            onOpenSqlExport={(db, tbl) =>
              openSqlExportModal({ database: db, table: tbl })
            }
            onOpenBackupRestore={(db, tab) =>
              openBackupRestoreModal({ targetDatabase: db, tab })
            }
            onOpenCreateRoutine={handleOpenCreateRoutine}
            onOpenCreateTrigger={handleOpenCreateTrigger}
            onOpenDashboard={handleOpenDashboard}
            onOpenHealth={handleOpenHealth}
            onOpenSlowQuery={handleOpenSlowQuery}
            onOpenIndexAdvisor={handleOpenIndexAdvisor}
            onOpenSchemaDiff={handleOpenSchemaDiff}
            onOpenOperations={handleOpenOperations}
            onOpenTablesOverview={handleOpenTablesOverview}
            onOpenAgent={handleOpenAgent}
            onOpenReports={handleOpenReports}
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
            onDropTable={handleDropTable}
          />
        )}

        {/* Center Canvas */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[#0c0e14]">
          {/* Tab Bar */}
          {tabs.length > 0 && (
            <TabManager
              tabs={tabs}
              activeTabId={activeTabId}
              onSelectTab={setActiveTabId}
              onCloseTab={closeTab}
              onNewQueryTab={() => handleNewQueryTab()}
            />
          )}

          {/* Tab Content or Welcome Screen */}
          <main className="flex-1 overflow-hidden relative flex flex-col">
            {tabs.length === 0 ? (
              <WelcomeView
                onOpenConnectModal={(p) => openConnectModal(p)}
                isConnected={connectionStatus.is_connected}
                databasesCount={databases.length}
                onQuickConnect={handleConnect}
                profilesVersion={profilesVersion}
              />
            ) : (
              tabs.map((tab) => {
                const isActive = tab.id === activeTabId;
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
                    className={`w-full h-full flex flex-col ${
                      isActive ? "" : "hidden"
                    }`}
                  >
                    {tab.type === "query" && (
                      <QueryEditorTab
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
                        onTriggerDeleted={() => {
                          closeTab(tab.id);
                          loadSchemaObjects(tab.database);
                        }}
                      />
                    )}
                    {tab.type === "dashboard" && (
                      <DashboardTab
                        database={tab.database}
                        onOpenHealth={() => handleOpenHealth(tab.database)}
                        onOpenSlowQuery={(view) =>
                          handleOpenSlowQuery(tab.database, undefined, view)
                        }
                        onOpenAdvisor={() => handleOpenIndexAdvisor(tab.database)}
                        onOpenDiff={() => handleOpenSchemaDiff(tab.database)}
                        onOpenOperations={() => handleOpenOperations(tab.database)}
                        onOpenTablesOverview={() => handleOpenTablesOverview(tab.database)}
                        onOpenSqlExport={() =>
                          openSqlExportModal({ database: tab.database })
                        }
                        onOpenBackupRestore={() =>
                          openBackupRestoreModal({ targetDatabase: tab.database })
                        }
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
    </div>
  );
};

export default App;
