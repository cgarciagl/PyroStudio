import React, { useState, useEffect } from "react";
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
import { dbService } from "./services/tauriDb";
import type {
  ConnectionConfig,
  ConnectionStatus,
  DatabaseSchema,
  OpenTab,
  RoutineMetadata,
  SavedConnection,
  ServerInfo,
  TableMetadata,
  TriggerMetadata,
} from "./types/database";

export const App: React.FC = () => {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    is_connected: false,
  });
  const [databases, setDatabases] = useState<DatabaseSchema[]>([]);
  const [selectedDatabase, setSelectedDatabase] = useState<string | null>(null);
  const [tables, setTables] = useState<Record<string, TableMetadata[]>>({});
  const [routines, setRoutines] = useState<Record<string, RoutineMetadata[]>>({});
  const [triggers, setTriggers] = useState<Record<string, TriggerMetadata[]>>({});
  const [isLoadingTables, setIsLoadingTables] = useState<Record<string, boolean>>(
    {},
  );
  const [isDbListLoading, setIsDbListLoading] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [selectedProfileForModal, setSelectedProfileForModal] = useState<SavedConnection | undefined>(undefined);
  const [isCreateTableModalOpen, setIsCreateTableModalOpen] = useState(false);
  const [createTableDbName, setCreateTableDbName] = useState<string | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importTarget, setImportTarget] = useState<{ database: string; table?: string } | null>(null);

  const handleOpenConnectModal = (profile?: SavedConnection) => {
    setSelectedProfileForModal(profile);
    setIsConnectModalOpen(true);
  };

  const handleOpenImportExcel = (dbName: string, tableName?: string) => {
    setImportTarget({ database: dbName, table: tableName });
    setIsImportModalOpen(true);
  };

  // Tabs state
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // Initial check of connection status on mount
  useEffect(() => {
    let isMounted = true;
    const checkStatus = async () => {
      try {
        const status = await dbService.getConnectionStatus();
        if (isMounted && status.is_connected) {
          setConnectionStatus(status);
          const initialDb = status.config?.database?.trim() || undefined;
          loadDatabases(initialDb);
        }
      } catch (err) {
        console.warn("Could not retrieve initial status:", err);
      }
    };
    checkStatus();
    return () => {
      isMounted = false;
    };
  }, []);

  const loadDatabases = async (targetDb?: string) => {
    setIsDbListLoading(true);
    try {
      const dbs = await dbService.listDatabases();
      setDatabases(dbs);
      if (targetDb && targetDb.trim()) {
        setSelectedDatabase(targetDb.trim());
        loadSchemaObjects(targetDb.trim());
      }
    } catch (err) {
      console.error("Failed to load databases:", err);
    } finally {
      setIsDbListLoading(false);
    }
  };

  const loadSchemaObjects = async (dbName: string) => {
    setIsLoadingTables((prev) => ({ ...prev, [dbName]: true }));
    try {
      const [tbls, rts, trgs] = await Promise.all([
        dbService.listTables(dbName).catch(() => []),
        dbService.listRoutines(dbName).catch(() => []),
        dbService.listTriggers(dbName).catch(() => []),
      ]);
      setTables((prev) => ({ ...prev, [dbName]: tbls }));
      setRoutines((prev) => ({ ...prev, [dbName]: rts }));
      setTriggers((prev) => ({ ...prev, [dbName]: trgs }));
    } catch (err) {
      console.error(`Failed to load schema objects for ${dbName}:`, err);
    } finally {
      setIsLoadingTables((prev) => ({ ...prev, [dbName]: false }));
    }
  };

  const handleTestConnection = async (
    config: ConnectionConfig,
  ): Promise<ServerInfo> => {
    return await dbService.testConnection(config);
  };

  const handleConnect = async (config: ConnectionConfig) => {
    setIsConnecting(true);
    try {
      const serverInfo = await dbService.connect(config);
      setConnectionStatus({
        is_connected: true,
        config,
        server_info: serverInfo,
      });
      setIsConnectModalOpen(false);
      setSelectedDatabase(null);
      const initialDb = config.database?.trim() || undefined;
      await loadDatabases(initialDb);
    } catch (err) {
      console.error("Connection failed:", err);
      throw err;
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await dbService.disconnect();
    } catch (err) {
      console.error("Error disconnecting:", err);
    } finally {
      setConnectionStatus({ is_connected: false });
      setDatabases([]);
      setTables({});
      setRoutines({});
      setTriggers({});
      setSelectedDatabase(null);
      setTabs([]);
      setActiveTabId(null);
    }
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
    setCreateTableDbName(targetDb);
    setIsCreateTableModalOpen(true);
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
      await dbService.dropTable(dbName, tableName);
      const tabId = `table-${dbName}-${tableName}`;
      setTabs((prev) => prev.filter((t) => t.id !== tabId));
      if (activeTabId === tabId) {
        const remaining = tabs.filter((t) => t.id !== tabId);
        setActiveTabId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
      }
      await loadSchemaObjects(dbName);
      await loadDatabases();
    } catch (err) {
      console.error("Failed to drop table:", err);
      alert(`Error al eliminar tabla: ${err}`);
    }
  };

  const handleSelectTable = (dbName: string, table: TableMetadata) => {
    const tabId = `table-${dbName}-${table.name}`;
    const exists = tabs.find((t) => t.id === tabId);

    if (!exists) {
      const newTab: OpenTab = {
        id: tabId,
        title: table.name,
        type: "table",
        database: dbName,
        tableName: table.name,
      };
      setTabs((prev) => [...prev, newTab]);
    }
    setActiveTabId(tabId);
    setSelectedDatabase(dbName);
  };

  const handleSelectRoutine = (
    dbName: string,
    routineName: string,
    routineType: "PROCEDURE" | "FUNCTION",
  ) => {
    const tabId = `routine-${dbName}-${routineName}`;
    const exists = tabs.find((t) => t.id === tabId);

    if (!exists) {
      const newTab: OpenTab = {
        id: tabId,
        title: routineName,
        type: "routine",
        database: dbName,
        routineName,
        routineType,
      };
      setTabs((prev) => [...prev, newTab]);
    }
    setActiveTabId(tabId);
    setSelectedDatabase(dbName);
  };

  const handleSelectTrigger = (dbName: string, triggerName: string) => {
    const tabId = `trigger-${dbName}-${triggerName}`;
    const exists = tabs.find((t) => t.id === tabId);

    if (!exists) {
      const newTab: OpenTab = {
        id: tabId,
        title: triggerName,
        type: "trigger",
        database: dbName,
        triggerName,
      };
      setTabs((prev) => [...prev, newTab]);
    }
    setActiveTabId(tabId);
    setSelectedDatabase(dbName);
  };

  const handleOpenCreateRoutine = (
    dbName: string,
    routineType: "PROCEDURE" | "FUNCTION",
  ) => {
    const defaultName =
      routineType === "PROCEDURE" ? "sp_nuevo_procedimiento" : "fn_nueva_funcion";
    const tabId = `routine-${dbName}-${Date.now()}`;
    const newTab: OpenTab = {
      id: tabId,
      title: defaultName,
      type: "routine",
      database: dbName,
      routineName: defaultName,
      routineType,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(tabId);
  };

  const handleOpenCreateTrigger = (dbName: string) => {
    const defaultName = "trg_nuevo_trigger";
    const tabId = `trigger-${dbName}-${Date.now()}`;
    const newTab: OpenTab = {
      id: tabId,
      title: defaultName,
      type: "trigger",
      database: dbName,
      triggerName: defaultName,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(tabId);
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

    const newTab: OpenTab = {
      id: tabId,
      title: `Consulta ${queryCount}`,
      type: "query",
      database: currentDb,
      queryContent: defaultSql,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(tabId);
  };

  const handleCloseTab = (id: string) => {
    const newTabs = tabs.filter((t) => t.id !== id);
    setTabs(newTabs);
    if (activeTabId === id) {
      setActiveTabId(newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null);
    }
  };

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeTableMeta =
    activeTab && activeTab.tableName && selectedDatabase
      ? (tables[activeTab.database] || []).find(
          (t) => t.name === activeTab.tableName,
        ) || {
          name: activeTab.tableName,
          table_type: "BASE TABLE",
        }
      : null;

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#0a0b0e] text-neutral-200">
      {/* Top Application Header */}
      <Header
        connectionStatus={connectionStatus}
        onOpenConnectModal={() => handleOpenConnectModal()}
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
            connectionStatus.is_connected ? handleOpenImportExcel : undefined
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
              onCloseTab={handleCloseTab}
              onNewQueryTab={handleNewQueryTab}
            />
          )}

          {/* Tab Content or Welcome Screen */}
          <main className="flex-1 overflow-hidden flex flex-col">
            {activeTab?.type === "query" ? (
              <QueryEditorTab
                key={activeTab.id}
                database={activeTab.database}
                initialQuery={activeTab.queryContent}
              />
            ) : activeTab?.type === "table" && activeTableMeta ? (
              <TableViewer
                key={activeTab.id}
                database={activeTab.database}
                table={activeTableMeta}
                onRefreshTable={() => loadSchemaObjects(activeTab.database)}
                onTableDeleted={handleDropTable}
              />
            ) : activeTab?.type === "routine" && activeTab.routineName ? (
              <RoutineEditorTab
                key={activeTab.id}
                database={activeTab.database}
                routineName={activeTab.routineName}
                routineType={activeTab.routineType || "PROCEDURE"}
                onRoutineDeleted={() => {
                  handleCloseTab(activeTab.id);
                  loadSchemaObjects(activeTab.database);
                }}
              />
            ) : activeTab?.type === "trigger" && activeTab.triggerName ? (
              <TriggerEditorTab
                key={activeTab.id}
                database={activeTab.database}
                triggerName={activeTab.triggerName}
                onTriggerDeleted={() => {
                  handleCloseTab(activeTab.id);
                  loadSchemaObjects(activeTab.database);
                }}
              />
            ) : (
              <WelcomeView
                onOpenConnectModal={handleOpenConnectModal}
                isConnected={connectionStatus.is_connected}
                databasesCount={databases.length}
                onQuickConnect={handleConnect}
              />
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
        onClose={() => setIsConnectModalOpen(false)}
        onConnect={handleConnect}
        onTest={handleTestConnection}
        isConnecting={isConnecting}
        initialProfile={selectedProfileForModal}
      />

      {/* Create Table Wizard Modal */}
      {isCreateTableModalOpen && createTableDbName && (
        <CreateTableModal
          isOpen={isCreateTableModalOpen}
          onClose={() => setIsCreateTableModalOpen(false)}
          database={createTableDbName}
          onTableCreated={handleTableCreated}
        />
      )}

      {/* Excel Import Modal (from Sidebar / Global) */}
      {isImportModalOpen && importTarget && (
        <ExcelImportModal
          isOpen={isImportModalOpen}
          onClose={() => {
            setIsImportModalOpen(false);
            setImportTarget(null);
          }}
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
