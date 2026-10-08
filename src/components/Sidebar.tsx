import React, { useState, useRef, useEffect } from "react";
import {
  Database,
  Table as TableIcon,
  Eye,
  ChevronDown,
  ChevronRight,
  Search,
  Layers,
  FolderOpen,
  Folder,
  Hash,
  Loader2,
  Plus,
  Settings,
  FunctionSquare,
  Zap,
  FileSpreadsheet,
  Trash2,
  LayoutDashboard,
  Activity,
  Sparkles,
  GitCompare,
  Wrench,
  Flame,
  FileCode2,
  Archive,
  Bot,
  FileText,
  Copy,
  Edit3,
} from "lucide-react";
import type {
  DatabaseSchema,
  TableMetadata,
  RoutineMetadata,
  TriggerMetadata,
} from "../types/database";
import { ConfirmModal } from "./ConfirmModal";

interface SidebarProps {
  databases: DatabaseSchema[];
  selectedDatabase: string | null;
  onSelectDatabase: (dbName: string) => void;
  tables: Record<string, TableMetadata[]>;
  routines?: Record<string, RoutineMetadata[]>;
  triggers?: Record<string, TriggerMetadata[]>;
  isLoadingTables: Record<string, boolean>;
  onSelectTable: (dbName: string, table: TableMetadata) => void;
  onSelectRoutine?: (
    dbName: string,
    routineName: string,
    routineType: "PROCEDURE" | "FUNCTION"
  ) => void;
  onSelectTrigger?: (dbName: string, triggerName: string) => void;
  activeTable?: string;
  activeRoutine?: string;
  activeTrigger?: string;
  isDbListLoading: boolean;
  onOpenCreateTable?: (dbName: string) => void;
  onOpenImportExcel?: (dbName: string, tableName?: string) => void;
  onOpenSqlExport?: (dbName: string, tableName?: string) => void;
  onOpenBackupRestore?: (dbName: string, tab?: "backup" | "restore") => void;
  onDropTable?: (dbName: string, tableName: string) => void;
  onOpenCreateRoutine?: (
    dbName: string,
    routineType: "PROCEDURE" | "FUNCTION"
  ) => void;
  onOpenCreateTrigger?: (dbName: string) => void;
  onOpenDashboard?: (dbName: string) => void;
  onOpenHealth?: (dbName: string) => void;
  onOpenSlowQuery?: (dbName: string) => void;
  onOpenIndexAdvisor?: (dbName: string) => void;
  onOpenSchemaDiff?: (dbName: string) => void;
  onOpenOperations?: (dbName: string) => void;
  onOpenTablesOverview?: (dbName: string) => void;
  onOpenAgent?: (dbName: string) => void;
  onOpenReports?: (dbName: string) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  type: "database" | "table" | "routine" | "trigger";
  dbName: string;
  tableName?: string;
  routineName?: string;
  routineType?: "PROCEDURE" | "FUNCTION";
  triggerName?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  databases,
  selectedDatabase,
  onSelectDatabase,
  tables,
  routines = {},
  triggers = {},
  isLoadingTables,
  onSelectTable,
  onSelectRoutine,
  onSelectTrigger,
  activeTable,
  activeRoutine,
  activeTrigger,
  isDbListLoading,
  onOpenCreateTable,
  onOpenImportExcel,
  onOpenSqlExport,
  onOpenBackupRestore,
  onDropTable,
  onOpenCreateRoutine,
  onOpenCreateTrigger,
  onOpenDashboard,
  onOpenHealth,
  onOpenSlowQuery,
  onOpenIndexAdvisor,
  onOpenSchemaDiff,
  onOpenOperations,
  onOpenTablesOverview,
  onOpenAgent,
  onOpenReports,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedDbs, setExpandedDbs] = useState<Record<string, boolean>>({});
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [tableToDrop, setTableToDrop] = useState<{ dbName: string; tableName: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Automatically expand selected database and its tables subfolder when selected externally
  useEffect(() => {
    if (selectedDatabase) {
      setExpandedDbs((prev) => ({ ...prev, [selectedDatabase]: true }));
      setExpandedFolders((prev) => ({ ...prev, [`${selectedDatabase}-tables`]: true }));
    }
  }, [selectedDatabase]);

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenu(null);
      }
    };

    window.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  // Toggle DB expansion & selection without auto-opening the dashboard tab
  const toggleDbExpand = (dbName: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const isNowExpanded = !expandedDbs[dbName];
    setExpandedDbs((prev) => ({ ...prev, [dbName]: isNowExpanded }));
    onSelectDatabase(dbName);
    if (isNowExpanded) {
      // Expand tables folder by default on first expansion
      setExpandedFolders((prev) => ({
        ...prev,
        [`${dbName}-tables`]: prev[`${dbName}-tables`] ?? true,
      }));
    }
  };

  const toggleFolder = (folderKey: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedFolders((prev) => ({
      ...prev,
      [folderKey]: !prev[folderKey],
    }));
  };

  const handleTablesFolderClick = (dbName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedFolders((prev) => ({
      ...prev,
      [`${dbName}-tables`]: !prev[`${dbName}-tables`],
    }));
    onSelectDatabase(dbName);
  };

  const handleContextMenu = (
    e: React.MouseEvent,
    menuData: Omit<ContextMenuState, "x" | "y">
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const menuWidth = 220;
    const menuHeight = 260;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 10);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 10);

    setContextMenu({
      ...menuData,
      x: Math.max(10, x),
      y: Math.max(10, y),
    });
  };

  const filteredDatabases = databases.filter((db) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    if (db.name.toLowerCase().includes(term)) return true;
    const dbTables = tables[db.name] || [];
    const dbRoutines = routines[db.name] || [];
    const dbTriggers = triggers[db.name] || [];

    return (
      dbTables.some((t) => t.name.toLowerCase().includes(term)) ||
      dbRoutines.some((r) => r.name.toLowerCase().includes(term)) ||
      dbTriggers.some((tr) => tr.name.toLowerCase().includes(term))
    );
  });

  return (
    <aside className="w-64 bg-[#0a0c10] border-r border-[#1a1f2c] flex flex-col h-full select-none">
      {/* Top Header */}
      <div className="p-3 border-b border-[#181d29] flex items-center justify-between">
        <div className="flex items-center space-x-2 text-xs font-semibold text-neutral-300">
          <Layers className="w-4 h-4 text-orange-500" />
          <span>EXPLORADOR</span>
        </div>
        <div className="flex items-center space-x-2">
          {selectedDatabase && onOpenCreateTable && (
            <button
              onClick={() => onOpenCreateTable(selectedDatabase)}
              title={`Crear nueva tabla en '${selectedDatabase}'`}
              className="p-1 rounded hover:bg-orange-600/20 text-orange-400 hover:text-orange-300 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#161a24] text-neutral-400 font-mono border border-[#242b3d]">
            {databases.length} BDs
          </span>
        </div>
      </div>

      {/* Filter / Search Box */}
      <div className="p-2 border-b border-[#161a25]">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 top-2.5" />
          <input
            type="text"
            placeholder="Filtrar tablas, rutinas..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-[#11141c] border border-[#202636] rounded text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-orange-500/60 transition-colors font-mono"
          />
        </div>
      </div>

      {/* Database Tree */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {isDbListLoading ? (
          <div className="flex flex-col items-center justify-center py-10 space-y-2 text-neutral-500">
            <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
            <span className="text-xs">Cargando bases de datos...</span>
          </div>
        ) : filteredDatabases.length === 0 ? (
          <div className="text-center py-8 px-3 text-xs text-neutral-500">
            {databases.length === 0
              ? "Sin conexión activa. Haz clic en 'Conectar a MariaDB'."
              : "No se encontraron coincidencias."}
          </div>
        ) : (
          filteredDatabases.map((db) => {
            const isExpanded = expandedDbs[db.name] ?? (selectedDatabase === db.name);
            const dbTables = tables[db.name] || [];
            const dbRoutines = routines[db.name] || [];
            const dbTriggers = triggers[db.name] || [];
            const isLoading = isLoadingTables[db.name];

            const procs = dbRoutines.filter((r) => r.routine_type === "PROCEDURE");
            const funcs = dbRoutines.filter((r) => r.routine_type === "FUNCTION");
            const totalRoutines = procs.length + funcs.length;

            const isTablesOpen = expandedFolders[`${db.name}-tables`] ?? true;
            const isRoutinesOpen = expandedFolders[`${db.name}-routines`] ?? false;
            const isProcsOpen = expandedFolders[`${db.name}-procs`] ?? true;
            const isFuncsOpen = expandedFolders[`${db.name}-funcs`] ?? true;
            const isTriggersOpen = expandedFolders[`${db.name}-triggers`] ?? false;
            const isToolsOpen = expandedFolders[`${db.name}-tools`] ?? false;

            const filteredTables = dbTables.filter((t) =>
              searchTerm.trim()
                ? t.name.toLowerCase().includes(searchTerm.toLowerCase())
                : true
            );
            const filteredProcs = procs.filter((p) =>
              searchTerm.trim()
                ? p.name.toLowerCase().includes(searchTerm.toLowerCase())
                : true
            );
            const filteredFuncs = funcs.filter((f) =>
              searchTerm.trim()
                ? f.name.toLowerCase().includes(searchTerm.toLowerCase())
                : true
            );
            const filteredTriggers = dbTriggers.filter((tr) =>
              searchTerm.trim()
                ? tr.name.toLowerCase().includes(searchTerm.toLowerCase())
                : true
            );

            return (
              <div key={db.name} className="flex flex-col">
                {/* Database item header */}
                <div
                  onClick={(e) => toggleDbExpand(db.name, e)}
                  onContextMenu={(e) =>
                    handleContextMenu(e, { type: "database", dbName: db.name })
                  }
                  className={`group flex items-center justify-between px-2 py-1.5 rounded cursor-pointer transition-colors text-xs ${
                    selectedDatabase === db.name
                      ? "bg-[#181d2a] text-white"
                      : "text-neutral-300 hover:bg-[#131620] hover:text-white"
                  }`}
                >
                  <div className="flex items-center space-x-2 truncate">
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                    )}
                    {isExpanded ? (
                      <FolderOpen className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                    ) : (
                      <Database className="w-3.5 h-3.5 text-neutral-400 group-hover:text-orange-400 shrink-0 transition-colors" />
                    )}
                    <span className="font-semibold truncate font-mono text-[11px]">
                      {db.name}
                    </span>
                  </div>

                  <div className="flex items-center space-x-1">
                    <span className="text-[10px] text-neutral-500 font-mono shrink-0 px-1 rounded bg-[#0d0f14]">
                      {db.tables_count}
                    </span>
                  </div>
                </div>

                {/* Database Sub-trees */}
                {isExpanded && (
                  <div className="ml-3 pl-2 border-l border-[#1c2230] my-1 space-y-0.5">
                    {isLoading ? (
                      <div className="flex items-center space-x-2 py-2 px-2 text-neutral-500 text-xs">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-400" />
                        <span>Cargando esquema...</span>
                      </div>
                    ) : (
                      <>
                        {/* 1. RESUMEN / DASHBOARD (Explicit Click Action) */}
                        {onOpenDashboard && (
                          <div
                            onClick={() => onOpenDashboard(db.name)}
                            title="Abrir Resumen y Métricas de la Base de Datos"
                            className="group flex items-center justify-between px-1.5 py-1 rounded text-[11px] text-neutral-300 hover:text-emerald-400 hover:bg-[#131622] cursor-pointer transition-colors"
                          >
                            <div className="flex items-center space-x-2 truncate">
                              <LayoutDashboard className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                              <span className="font-medium font-mono">Resumen</span>
                            </div>
                            <span className="text-[9px] text-neutral-500 font-mono opacity-0 group-hover:opacity-100">
                              Dashboard
                            </span>
                          </div>
                        )}

                        {/* 2. TABLAS FOLDER */}
                        <div className="flex flex-col">
                          <div
                            onClick={(e) => handleTablesFolderClick(db.name, e)}
                            className="group flex items-center justify-between px-1.5 py-1 rounded text-[11px] text-neutral-400 hover:text-white hover:bg-[#131622] cursor-pointer"
                          >
                            <div className="flex items-center space-x-1.5 truncate">
                              <span
                                onClick={(e) => toggleFolder(`${db.name}-tables`, e)}
                                className="p-0.5 hover:text-white transition-colors"
                              >
                                {isTablesOpen ? (
                                  <ChevronDown className="w-3 h-3 text-neutral-500" />
                                ) : (
                                  <ChevronRight className="w-3 h-3 text-neutral-500" />
                                )}
                              </span>
                              <Folder className="w-3.5 h-3.5 text-amber-500/80 shrink-0" />
                              <span className="font-semibold font-mono hover:text-amber-400 transition-colors">
                                Tablas ({filteredTables.length})
                              </span>
                            </div>
                            <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100">
                              {onOpenCreateTable && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onOpenCreateTable(db.name);
                                  }}
                                  title="Crear nueva tabla"
                                  className="p-0.5 rounded hover:bg-orange-600/30 text-orange-400 transition-colors"
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>

                          {isTablesOpen && (
                            <div className="ml-3 pl-1.5 border-l border-[#1a1f2e] space-y-0.5 mt-0.5">
                              {filteredTables.length === 0 ? (
                                <div className="py-1 px-1.5 flex items-center justify-between text-[10px] text-neutral-500">
                                  <span>Sin tablas</span>
                                  {onOpenCreateTable && !searchTerm.trim() && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onOpenCreateTable(db.name);
                                      }}
                                      className="text-orange-400 hover:text-orange-300 font-medium hover:underline"
                                    >
                                      + Crear tabla
                                    </button>
                                  )}
                                </div>
                              ) : (
                                filteredTables.map((table) => {
                                  const isView = table.table_type === "VIEW";
                                  const isCurrent = activeTable === `${db.name}.${table.name}`;

                                  return (
                                    <div
                                      key={table.name}
                                      onClick={() => onSelectTable(db.name, table)}
                                      onContextMenu={(e) =>
                                        handleContextMenu(e, {
                                          type: "table",
                                          dbName: db.name,
                                          tableName: table.name,
                                        })
                                      }
                                      className={`group flex items-center justify-between px-1.5 py-0.5 rounded text-xs cursor-pointer transition-colors ${
                                        isCurrent
                                          ? "bg-orange-600/20 text-orange-300 border-l-2 border-orange-500 pl-1"
                                          : "text-neutral-400 hover:bg-[#141824] hover:text-neutral-200"
                                      }`}
                                    >
                                      <div className="flex items-center space-x-1.5 truncate">
                                        {isView ? (
                                          <Eye className="w-3 h-3 text-sky-400 shrink-0" />
                                        ) : (
                                          <TableIcon className="w-3 h-3 text-amber-500/80 group-hover:text-amber-400 shrink-0" />
                                        )}
                                        <span className="truncate font-mono text-[11px]">
                                          {table.name}
                                        </span>
                                      </div>

                                      <div className="flex items-center space-x-1 shrink-0">
                                        {table.rows_count !== null &&
                                          table.rows_count !== undefined &&
                                          !isView && (
                                            <span className="text-[9px] text-neutral-500 font-mono flex items-center group-hover:hidden">
                                              <Hash className="w-2 h-2 opacity-60" />
                                              {table.rows_count.toLocaleString()}
                                            </span>
                                          )}
                                        {onOpenSqlExport && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              onOpenSqlExport(db.name, table.name);
                                            }}
                                            title={`Exportar tabla '${table.name}' a SQL`}
                                            className="hidden group-hover:flex p-0.5 rounded text-neutral-400 hover:text-rose-400 hover:bg-rose-950/40 transition-colors"
                                          >
                                            <FileCode2 className="w-3 h-3" />
                                          </button>
                                        )}
                                        {onDropTable && !isView && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setTableToDrop({ dbName: db.name, tableName: table.name });
                                            }}
                                            title={`Eliminar tabla '${table.name}' (DROP TABLE)`}
                                            className="hidden group-hover:flex p-0.5 rounded text-neutral-400 hover:text-red-400 hover:bg-red-950/40 transition-colors"
                                          >
                                            <Trash2 className="w-3 h-3" />
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          )}
                        </div>

                        {/* 3. RUTINAS (Procedures & Functions grouped) */}
                        <div className="flex flex-col">
                          <div
                            onClick={(e) => toggleFolder(`${db.name}-routines`, e)}
                            className="group flex items-center justify-between px-1.5 py-1 rounded text-[11px] text-neutral-400 hover:text-white hover:bg-[#131622] cursor-pointer"
                          >
                            <div className="flex items-center space-x-1.5 truncate">
                              <span
                                onClick={(e) => toggleFolder(`${db.name}-routines`, e)}
                                className="p-0.5 hover:text-white transition-colors"
                              >
                                {isRoutinesOpen ? (
                                  <ChevronDown className="w-3 h-3 text-neutral-500" />
                                ) : (
                                  <ChevronRight className="w-3 h-3 text-neutral-500" />
                                )}
                              </span>
                              <Settings className="w-3.5 h-3.5 text-orange-400/80 shrink-0" />
                              <span className="font-semibold font-mono">
                                Rutinas ({totalRoutines})
                              </span>
                            </div>
                          </div>

                          {isRoutinesOpen && (
                            <div className="ml-3 pl-1.5 border-l border-[#1a1f2e] space-y-1 mt-0.5">
                              {/* 3.1 PROCEDIMIENTOS */}
                              <div className="flex flex-col">
                                <div
                                  onClick={(e) => toggleFolder(`${db.name}-procs`, e)}
                                  className="group flex items-center justify-between px-1 py-0.5 rounded text-[10px] text-neutral-400 hover:text-white hover:bg-[#131622] cursor-pointer"
                                >
                                  <div className="flex items-center space-x-1 truncate">
                                    {isProcsOpen ? (
                                      <ChevronDown className="w-2.5 h-2.5 text-neutral-500" />
                                    ) : (
                                      <ChevronRight className="w-2.5 h-2.5 text-neutral-500" />
                                    )}
                                    <span className="font-mono font-medium">
                                      Procedures ({filteredProcs.length})
                                    </span>
                                  </div>
                                  {onOpenCreateRoutine && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onOpenCreateRoutine(db.name, "PROCEDURE");
                                      }}
                                      title="Crear nuevo procedimiento almacenado"
                                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-orange-600/30 text-orange-400"
                                    >
                                      <Plus className="w-2.5 h-2.5" />
                                    </button>
                                  )}
                                </div>

                                {isProcsOpen && (
                                  <div className="ml-2.5 pl-1 border-l border-[#1c2232] space-y-0.5">
                                    {filteredProcs.length === 0 ? (
                                      <div className="py-0.5 px-1 text-[9px] text-neutral-500 italic font-mono">
                                        Sin procedures
                                      </div>
                                    ) : (
                                      filteredProcs.map((proc) => {
                                        const isCurrent = activeRoutine === `${db.name}.${proc.name}`;
                                        return (
                                          <div
                                            key={proc.name}
                                            onClick={() =>
                                              onSelectRoutine &&
                                              onSelectRoutine(db.name, proc.name, "PROCEDURE")
                                            }
                                            onContextMenu={(e) =>
                                              handleContextMenu(e, {
                                                type: "routine",
                                                dbName: db.name,
                                                routineName: proc.name,
                                                routineType: "PROCEDURE",
                                              })
                                            }
                                            className={`group flex items-center justify-between px-1 py-0.5 rounded text-xs cursor-pointer transition-colors ${
                                              isCurrent
                                                ? "bg-orange-600/20 text-orange-300 border-l-2 border-orange-500 pl-1"
                                                : "text-neutral-400 hover:bg-[#141824] hover:text-neutral-200"
                                            }`}
                                          >
                                            <div className="flex items-center space-x-1.5 truncate">
                                              <Settings className="w-3 h-3 text-orange-400 shrink-0" />
                                              <span className="truncate font-mono text-[11px]">
                                                {proc.name}
                                              </span>
                                            </div>
                                          </div>
                                        );
                                      })
                                    )}
                                  </div>
                                )}
                              </div>

                              {/* 3.2 FUNCIONES */}
                              <div className="flex flex-col">
                                <div
                                  onClick={(e) => toggleFolder(`${db.name}-funcs`, e)}
                                  className="group flex items-center justify-between px-1 py-0.5 rounded text-[10px] text-neutral-400 hover:text-white hover:bg-[#131622] cursor-pointer"
                                >
                                  <div className="flex items-center space-x-1 truncate">
                                    {isFuncsOpen ? (
                                      <ChevronDown className="w-2.5 h-2.5 text-neutral-500" />
                                    ) : (
                                      <ChevronRight className="w-2.5 h-2.5 text-neutral-500" />
                                    )}
                                    <span className="font-mono font-medium">
                                      Functions ({filteredFuncs.length})
                                    </span>
                                  </div>
                                  {onOpenCreateRoutine && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onOpenCreateRoutine(db.name, "FUNCTION");
                                      }}
                                      title="Crear nueva función"
                                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-orange-600/30 text-orange-400"
                                    >
                                      <Plus className="w-2.5 h-2.5" />
                                    </button>
                                  )}
                                </div>

                                {isFuncsOpen && (
                                  <div className="ml-2.5 pl-1 border-l border-[#1c2232] space-y-0.5">
                                    {filteredFuncs.length === 0 ? (
                                      <div className="py-0.5 px-1 text-[9px] text-neutral-500 italic font-mono">
                                        Sin funciones
                                      </div>
                                    ) : (
                                      filteredFuncs.map((func) => {
                                        const isCurrent = activeRoutine === `${db.name}.${func.name}`;
                                        return (
                                          <div
                                            key={func.name}
                                            onClick={() =>
                                              onSelectRoutine &&
                                              onSelectRoutine(db.name, func.name, "FUNCTION")
                                            }
                                            onContextMenu={(e) =>
                                              handleContextMenu(e, {
                                                type: "routine",
                                                dbName: db.name,
                                                routineName: func.name,
                                                routineType: "FUNCTION",
                                              })
                                            }
                                            className={`group flex items-center justify-between px-1 py-0.5 rounded text-xs cursor-pointer transition-colors ${
                                              isCurrent
                                                ? "bg-purple-600/20 text-purple-300 border-l-2 border-purple-500 pl-1"
                                                : "text-neutral-400 hover:bg-[#141824] hover:text-neutral-200"
                                            }`}
                                          >
                                            <div className="flex items-center space-x-1.5 truncate">
                                              <FunctionSquare className="w-3 h-3 text-purple-400 shrink-0" />
                                              <span className="truncate font-mono text-[11px]">
                                                {func.name}
                                              </span>
                                            </div>
                                          </div>
                                        );
                                      })
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* 4. TRIGGERS FOLDER */}
                        <div className="flex flex-col">
                          <div
                            onClick={(e) => toggleFolder(`${db.name}-triggers`, e)}
                            className="group flex items-center justify-between px-1.5 py-1 rounded text-[11px] text-neutral-400 hover:text-white hover:bg-[#131622] cursor-pointer"
                          >
                            <div className="flex items-center space-x-1.5 truncate">
                              <span
                                onClick={(e) => toggleFolder(`${db.name}-triggers`, e)}
                                className="p-0.5 hover:text-white transition-colors"
                              >
                                {isTriggersOpen ? (
                                  <ChevronDown className="w-3 h-3 text-neutral-500" />
                                ) : (
                                  <ChevronRight className="w-3 h-3 text-neutral-500" />
                                )}
                              </span>
                              <Zap className="w-3.5 h-3.5 text-amber-400/80 shrink-0" />
                              <span className="font-semibold font-mono">
                                Triggers ({filteredTriggers.length})
                              </span>
                            </div>
                            {onOpenCreateTrigger && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenCreateTrigger(db.name);
                                }}
                                title="Crear nuevo trigger"
                                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-orange-600/30 text-orange-400"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            )}
                          </div>

                          {isTriggersOpen && (
                            <div className="ml-3 pl-1.5 border-l border-[#1a1f2e] space-y-0.5 mt-0.5">
                              {filteredTriggers.length === 0 ? (
                                <div className="py-1 px-1.5 text-[10px] text-neutral-500 italic">
                                  Sin triggers
                                </div>
                              ) : (
                                filteredTriggers.map((tr) => {
                                  const isCurrent = activeTrigger === `${db.name}.${tr.name}`;
                                  return (
                                    <div
                                      key={tr.name}
                                      onClick={() => onSelectTrigger && onSelectTrigger(db.name, tr.name)}
                                      onContextMenu={(e) =>
                                        handleContextMenu(e, {
                                          type: "trigger",
                                          dbName: db.name,
                                          triggerName: tr.name,
                                        })
                                      }
                                      className={`group flex items-center justify-between px-1.5 py-0.5 rounded text-xs cursor-pointer transition-colors ${
                                        isCurrent
                                          ? "bg-amber-600/20 text-amber-300 border-l-2 border-amber-500 pl-1"
                                          : "text-neutral-400 hover:bg-[#141824] hover:text-neutral-200"
                                      }`}
                                    >
                                      <div className="flex items-center space-x-1.5 truncate">
                                        <Zap className="w-3 h-3 text-amber-400 shrink-0" />
                                        <span className="truncate font-mono text-[11px]">
                                          {tr.name}
                                        </span>
                                      </div>
                                      <span className="text-[9px] text-neutral-500 font-mono">
                                        {tr.timing[0]}{tr.event[0]}
                                      </span>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          )}
                        </div>

                        {/* 5. HERRAMIENTAS (Collapsible Tools Section) */}
                        <div className="flex flex-col pt-1.5 mt-1 border-t border-[#181d29]">
                          <div
                            onClick={(e) => toggleFolder(`${db.name}-tools`, e)}
                            className="group flex items-center justify-between px-1.5 py-1 rounded text-[11px] text-neutral-400 hover:text-neutral-200 hover:bg-[#131622] cursor-pointer"
                          >
                            <div className="flex items-center space-x-1.5 truncate">
                              <span
                                onClick={(e) => toggleFolder(`${db.name}-tools`, e)}
                                className="p-0.5 hover:text-white transition-colors"
                              >
                                {isToolsOpen ? (
                                  <ChevronDown className="w-3 h-3 text-neutral-500" />
                                ) : (
                                  <ChevronRight className="w-3 h-3 text-neutral-500" />
                                )}
                              </span>
                              <Wrench className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                              <span className="font-semibold font-mono">Herramientas</span>
                            </div>
                          </div>

                          {isToolsOpen && (
                            <div className="ml-3 pl-1.5 border-l border-[#1a1f2e] space-y-0.5 mt-0.5">
                              {onOpenHealth && (
                                <div
                                  onClick={() => onOpenHealth(db.name)}
                                  className="group flex items-center space-x-2 px-1.5 py-1 rounded text-xs cursor-pointer text-neutral-400 hover:bg-[#141824] hover:text-emerald-400 transition-colors"
                                >
                                  <Activity className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                  <span className="truncate font-mono text-[11px]">Monitor de Salud</span>
                                </div>
                              )}

                              {onOpenSlowQuery && (
                                <div
                                  onClick={() => onOpenSlowQuery(db.name)}
                                  className="group flex items-center space-x-2 px-1.5 py-1 rounded text-xs cursor-pointer text-neutral-400 hover:bg-[#141824] hover:text-orange-400 transition-colors"
                                >
                                  <Flame className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                                  <span className="truncate font-mono text-[11px]">Rendimiento & Slow Log</span>
                                </div>
                              )}

                              {onOpenIndexAdvisor && (
                                <div
                                  onClick={() => onOpenIndexAdvisor(db.name)}
                                  className="group flex items-center space-x-2 px-1.5 py-1 rounded text-xs cursor-pointer text-neutral-400 hover:bg-[#141824] hover:text-amber-400 transition-colors"
                                >
                                  <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                  <span className="truncate font-mono text-[11px]">Asesor de Índices</span>
                                </div>
                              )}

                              {onOpenOperations && (
                                <div
                                  onClick={() => onOpenOperations(db.name)}
                                  className="group flex items-center space-x-2 px-1.5 py-1 rounded text-xs cursor-pointer text-neutral-400 hover:bg-[#141824] hover:text-cyan-400 transition-colors"
                                >
                                  <Wrench className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                                  <span className="truncate font-mono text-[11px]">Mantenimiento</span>
                                </div>
                              )}

                              {onOpenBackupRestore && (
                                <div
                                  onClick={() => onOpenBackupRestore(db.name)}
                                  className="group flex items-center space-x-2 px-1.5 py-1 rounded text-xs cursor-pointer text-neutral-400 hover:bg-[#141824] hover:text-orange-400 transition-colors"
                                >
                                  <Archive className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                                  <span className="truncate font-mono text-[11px]">Backup / Restore</span>
                                </div>
                              )}

                              {onOpenSchemaDiff && (
                                <div
                                  onClick={() => onOpenSchemaDiff(db.name)}
                                  className="group flex items-center space-x-2 px-1.5 py-1 rounded text-xs cursor-pointer text-neutral-400 hover:bg-[#141824] hover:text-indigo-400 transition-colors"
                                >
                                  <GitCompare className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                                  <span className="truncate font-mono text-[11px]">Schema Diff & Migrar</span>
                                </div>
                              )}

                              {onOpenSqlExport && (
                                <div
                                  onClick={() => onOpenSqlExport(db.name)}
                                  className="group flex items-center space-x-2 px-1.5 py-1 rounded text-xs cursor-pointer text-neutral-400 hover:bg-[#141824] hover:text-rose-400 transition-colors"
                                >
                                  <FileCode2 className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                                  <span className="truncate font-mono text-[11px]">Exportación SQL</span>
                                </div>
                              )}

                              {onOpenReports && (
                                <div
                                  onClick={() => onOpenReports(db.name)}
                                  className="group flex items-center space-x-2 px-1.5 py-1 rounded text-xs cursor-pointer text-neutral-400 hover:bg-[#141824] hover:text-sky-300 transition-colors"
                                >
                                  <FileText className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                                  <span className="truncate font-mono text-[11px]">Informes & Diccionario</span>
                                </div>
                              )}

                              {onOpenAgent && (
                                <div
                                  onClick={() => onOpenAgent(db.name)}
                                  className="group flex items-center space-x-2 px-1.5 py-1 rounded text-xs cursor-pointer text-purple-300 hover:bg-purple-950/40 hover:text-purple-200 transition-colors"
                                >
                                  <Bot className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                                  <span className="truncate font-mono text-[11px]">Agente IA</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Desktop Context Menu Popup */}
      {contextMenu && (
        <div
          ref={menuRef}
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          className="fixed z-50 min-w-[200px] bg-[#11141c] border border-[#232838] shadow-2xl rounded-lg py-1.5 text-xs font-mono text-neutral-300 backdrop-blur-md animate-in fade-in zoom-in-95 duration-100 select-none"
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.type === "database" && (
            <>
              <div className="px-3 py-1 text-[10px] uppercase font-bold text-neutral-500 tracking-wider border-b border-[#1c2230] mb-1 flex items-center justify-between">
                <span className="truncate max-w-[130px]">{contextMenu.dbName}</span>
                <span className="text-orange-400 font-normal lowercase">database</span>
              </div>

              {onOpenDashboard && (
                <button
                  onClick={() => {
                    onOpenDashboard(contextMenu.dbName);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#1b202e] hover:text-white transition-colors text-left"
                >
                  <LayoutDashboard className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Abrir Resumen (Dashboard)</span>
                </button>
              )}

              {onOpenTablesOverview && (
                <button
                  onClick={() => {
                    onOpenTablesOverview(contextMenu.dbName);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#1b202e] hover:text-white transition-colors text-left"
                >
                  <TableIcon className="w-3.5 h-3.5 text-amber-400" />
                  <span>Lista de Tablas & Espacio</span>
                </button>
              )}

              {onOpenCreateTable && (
                <button
                  onClick={() => {
                    onOpenCreateTable(contextMenu.dbName);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#1b202e] hover:text-white transition-colors text-left"
                >
                  <Plus className="w-3.5 h-3.5 text-orange-400" />
                  <span>Nueva Tabla...</span>
                </button>
              )}

              {onOpenImportExcel && (
                <button
                  onClick={() => {
                    onOpenImportExcel(contextMenu.dbName);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#1b202e] hover:text-white transition-colors text-left"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Importar Excel...</span>
                </button>
              )}

              {onOpenSqlExport && (
                <button
                  onClick={() => {
                    onOpenSqlExport(contextMenu.dbName);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#1b202e] hover:text-white transition-colors text-left"
                >
                  <FileCode2 className="w-3.5 h-3.5 text-rose-400" />
                  <span>Exportar Base de Datos (SQL)...</span>
                </button>
              )}

              <div className="my-1 border-t border-[#1c2230]" />

              {onOpenHealth && (
                <button
                  onClick={() => {
                    onOpenHealth(contextMenu.dbName);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#1b202e] hover:text-white transition-colors text-left"
                >
                  <Activity className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Monitor de Salud</span>
                </button>
              )}

              {onOpenOperations && (
                <button
                  onClick={() => {
                    onOpenOperations(contextMenu.dbName);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#1b202e] hover:text-white transition-colors text-left"
                >
                  <Wrench className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Mantenimiento</span>
                </button>
              )}
            </>
          )}

          {contextMenu.type === "table" && contextMenu.tableName && (
            <>
              <div className="px-3 py-1 text-[10px] uppercase font-bold text-neutral-500 tracking-wider border-b border-[#1c2230] mb-1 flex items-center justify-between">
                <span className="truncate max-w-[130px]">{contextMenu.tableName}</span>
                <span className="text-amber-400 font-normal lowercase">table</span>
              </div>

              <button
                onClick={() => {
                  const tbl = (tables[contextMenu.dbName] || []).find(
                    (t) => t.name === contextMenu.tableName
                  ) || { name: contextMenu.tableName!, table_type: "BASE TABLE" };
                  onSelectTable(contextMenu.dbName, tbl);
                  setContextMenu(null);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#1b202e] hover:text-white transition-colors text-left font-medium"
              >
                <TableIcon className="w-3.5 h-3.5 text-orange-400" />
                <span>Abrir Tabla</span>
              </button>

              {onOpenImportExcel && (
                <button
                  onClick={() => {
                    onOpenImportExcel(contextMenu.dbName, contextMenu.tableName);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#1b202e] hover:text-white transition-colors text-left"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Importar Excel...</span>
                </button>
              )}

              {onOpenSqlExport && (
                <button
                  onClick={() => {
                    onOpenSqlExport(contextMenu.dbName, contextMenu.tableName);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#1b202e] hover:text-white transition-colors text-left"
                >
                  <FileCode2 className="w-3.5 h-3.5 text-rose-400" />
                  <span>Exportar a SQL...</span>
                </button>
              )}

              <button
                onClick={() => {
                  if (contextMenu.tableName) {
                    navigator.clipboard.writeText(contextMenu.tableName);
                  }
                  setContextMenu(null);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#1b202e] hover:text-white transition-colors text-left"
              >
                <Copy className="w-3.5 h-3.5 text-neutral-400" />
                <span>Copiar Nombre</span>
              </button>

              {onDropTable && (
                <>
                  <div className="my-1 border-t border-[#1c2230]" />
                  <button
                    onClick={() => {
                      if (contextMenu.tableName) {
                        setTableToDrop({
                          dbName: contextMenu.dbName,
                          tableName: contextMenu.tableName,
                        });
                      }
                      setContextMenu(null);
                    }}
                    className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-red-950/40 text-red-400 hover:text-red-300 transition-colors text-left"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    <span>Eliminar Tabla (DROP)</span>
                  </button>
                </>
              )}
            </>
          )}

          {contextMenu.type === "routine" && contextMenu.routineName && (
            <>
              <div className="px-3 py-1 text-[10px] uppercase font-bold text-neutral-500 tracking-wider border-b border-[#1c2230] mb-1 flex items-center justify-between">
                <span className="truncate max-w-[130px]">{contextMenu.routineName}</span>
                <span className="text-purple-400 font-normal lowercase">
                  {contextMenu.routineType?.toLowerCase()}
                </span>
              </div>

              <button
                onClick={() => {
                  if (onSelectRoutine && contextMenu.routineName) {
                    onSelectRoutine(
                      contextMenu.dbName,
                      contextMenu.routineName,
                      contextMenu.routineType || "PROCEDURE"
                    );
                  }
                  setContextMenu(null);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#1b202e] hover:text-white transition-colors text-left"
              >
                <Edit3 className="w-3.5 h-3.5 text-orange-400" />
                <span>Abrir Editor DDL</span>
              </button>

              <button
                onClick={() => {
                  if (contextMenu.routineName) {
                    navigator.clipboard.writeText(contextMenu.routineName);
                  }
                  setContextMenu(null);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#1b202e] hover:text-white transition-colors text-left"
              >
                <Copy className="w-3.5 h-3.5 text-neutral-400" />
                <span>Copiar Nombre</span>
              </button>
            </>
          )}

          {contextMenu.type === "trigger" && contextMenu.triggerName && (
            <>
              <div className="px-3 py-1 text-[10px] uppercase font-bold text-neutral-500 tracking-wider border-b border-[#1c2230] mb-1 flex items-center justify-between">
                <span className="truncate max-w-[130px]">{contextMenu.triggerName}</span>
                <span className="text-amber-400 font-normal lowercase">trigger</span>
              </div>

              <button
                onClick={() => {
                  if (onSelectTrigger && contextMenu.triggerName) {
                    onSelectTrigger(contextMenu.dbName, contextMenu.triggerName);
                  }
                  setContextMenu(null);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#1b202e] hover:text-white transition-colors text-left"
              >
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>Abrir Definición</span>
              </button>

              <button
                onClick={() => {
                  if (contextMenu.triggerName) {
                    navigator.clipboard.writeText(contextMenu.triggerName);
                  }
                  setContextMenu(null);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#1b202e] hover:text-white transition-colors text-left"
              >
                <Copy className="w-3.5 h-3.5 text-neutral-400" />
                <span>Copiar Nombre</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* Confirmation modal for dropping tables */}
      <ConfirmModal
        isOpen={!!tableToDrop}
        title="Eliminar Tabla (DROP TABLE)"
        message={`¿Estás seguro de que deseas eliminar permanentemente la tabla '${tableToDrop?.tableName}' de la base de datos '${tableToDrop?.dbName}'?`}
        details="Esta acción ejecutará DROP TABLE en el servidor y eliminará todas sus filas, índices y definiciones asociadas."
        confirmText="Eliminar Tabla"
        variant="danger"
        onConfirm={() => {
          if (tableToDrop && onDropTable) {
            onDropTable(tableToDrop.dbName, tableToDrop.tableName);
          }
          setTableToDrop(null);
        }}
        onClose={() => setTableToDrop(null)}
      />
    </aside>
  );
};

