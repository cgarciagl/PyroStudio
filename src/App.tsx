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
import { useConnectionStore } from "./stores/connectionStore";
import { useSchemaStore } from "./stores/schemaStore";
import { useUIStore } from "./stores/uiStore";
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
    bumpProfilesVersion,
  } = useUIStore();

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

  const handleNewQueryTab = () => {
    const currentDb =
      selectedDatabase ||
      (databases.length > 0 ? databases[0].name : "information_schema");
    const queryCount = tabs.filter((t) => t.type === "query").length + 1;
    const tabId = `query-${Date.now()}`;
    const initialTbl =
      tables[currentDb] && tables[currentDb].length > 0
        ? tables[currentDb][0].name
        : "";
    const defaultSql = initialTbl
      ? `SELECT * FROM \`${currentDb}\`.\`${initialTbl}\` LIMIT 100;`
      : `SELECT VERSION(), DATABASE(), USER();`;

    openTab({
      id: tabId,
      title: `Consulta ${queryCount}`,
      type: "query",
      database: currentDb,
      queryContent: defaultSql,
    });
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
        onNewQuery={connectionStatus.is_connected ? handleNewQueryTab : undefined}
        isRefreshing={isRefreshing}
      />

      {/* Main Workspace (Sidebar + Tabs & Content) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Hierarchical Sidebar */}
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
          onOpenCreateTable={
            connectionStatus.is_connected ? handleOpenCreateTable : undefined
          }
          onOpenImportExcel={
            connectionStatus.is_connected
              ? (db, tbl) => openImportModal({ database: db, table: tbl })
              : undefined
          }
          onOpenCreateRoutine={
            connectionStatus.is_connected ? handleOpenCreateRoutine : undefined
          }
          onOpenCreateTrigger={
            connectionStatus.is_connected ? handleOpenCreateTrigger : undefined
          }
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
          onDropTable={
            connectionStatus.is_connected ? handleDropTable : undefined
          }
        />

        {/* Center Canvas */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[#0c0e14]">
          {/* Tab Bar */}
          {tabs.length > 0 && (
            <TabManager
              tabs={tabs}
              activeTabId={activeTabId}
              onSelectTab={setActiveTabId}
              onCloseTab={closeTab}
              onNewQueryTab={handleNewQueryTab}
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
    </div>
  );
};

export default App;
