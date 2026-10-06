import React, { useState } from "react";
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
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedDbs, setExpandedDbs] = useState<Record<string, boolean>>({});
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [tableToDrop, setTableToDrop] = useState<{ dbName: string; tableName: string } | null>(null);

  React.useEffect(() => {
    if (selectedDatabase) {
      setExpandedDbs((prev) => ({ ...prev, [selectedDatabase]: true }));
      setExpandedFolders((prev) => ({ ...prev, [`${selectedDatabase}-tables`]: true }));
    } else {
      setExpandedDbs({});
      setExpandedFolders({});
    }
  }, [selectedDatabase]);

  const toggleExpand = (dbName: string) => {
    const isNowExpanded = !expandedDbs[dbName];
    setExpandedDbs((prev) => ({ ...prev, [dbName]: isNowExpanded }));
    onSelectDatabase(dbName);
    if (isNowExpanded) {
      // Expand tables subfolder by default
      setExpandedFolders((prev) => ({ ...prev, [`${dbName}-tables`]: true }));
    }
    // Open / focus database dashboard in main workspace
    if (onOpenDashboard) {
      onOpenDashboard(dbName);
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
      [`${dbName}-tables`]: true,
    }));
    onSelectDatabase(dbName);
    if (onOpenTablesOverview) {
      onOpenTablesOverview(dbName);
    }
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
            className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-[#11141c] border border-[#202636] rounded text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-orange-500/60 transition-colors"
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

            const isTablesOpen = expandedFolders[`${db.name}-tables`] ?? true;
            const isProcsOpen = expandedFolders[`${db.name}-procs`] ?? false;
            const isFuncsOpen = expandedFolders[`${db.name}-funcs`] ?? false;
            const isTriggersOpen = expandedFolders[`${db.name}-triggers`] ?? false;

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
                  onClick={() => toggleExpand(db.name)}
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
                    <span className="font-medium truncate font-mono text-[11px]">
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
                  <div className="ml-3 pl-2 border-l border-[#1c2230] my-1 space-y-1">
                    {isLoading ? (
                      <div className="flex items-center space-x-2 py-2 px-2 text-neutral-500 text-xs">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-400" />
                        <span>Cargando esquema...</span>
                      </div>
                    ) : (
                      <>
                        {/* 0. DIAGNÓSTICO & HERRAMIENTAS */}
                        <div className="flex flex-col mb-1.5 pb-1 border-b border-[#181d29]">
                          <div className="grid grid-cols-2 gap-1">
                            {onOpenDashboard && (
                              <button
                                type="button"
                                onClick={() => onOpenDashboard(db.name)}
                                title="Dashboard de la base de datos"
                                className="flex items-center space-x-1 px-1.5 py-1 rounded bg-[#121620] hover:bg-[#1b2130] text-[10px] text-emerald-400 font-medium transition-colors"
                              >
                                <LayoutDashboard className="w-3 h-3 shrink-0" />
                                <span className="truncate">Dashboard</span>
                              </button>
                            )}
                            {onOpenHealth && (
                              <button
                                type="button"
                                onClick={() => onOpenHealth(db.name)}
                                title="Monitor de salud y auditoría"
                                className="flex items-center space-x-1 px-1.5 py-1 rounded bg-[#121620] hover:bg-[#1b2130] text-[10px] text-emerald-400 font-medium transition-colors"
                              >
                                <Activity className="w-3 h-3 shrink-0" />
                                <span className="truncate">Salud BD</span>
                              </button>
                            )}
                            {onOpenSlowQuery && (
                              <button
                                type="button"
                                onClick={() => onOpenSlowQuery(db.name)}
                                title="Slow Query Analyzer y EXPLAIN Visual"
                                className="flex items-center space-x-1 px-1.5 py-1 rounded bg-[#121620] hover:bg-[#1b2130] text-[10px] text-orange-400 font-medium transition-colors"
                              >
                                <Flame className="w-3 h-3 shrink-0" />
                                <span className="truncate">Slow Query</span>
                              </button>
                            )}
                            {onOpenIndexAdvisor && (
                              <button
                                type="button"
                                onClick={() => onOpenIndexAdvisor(db.name)}
                                title="Index Advisor"
                                className="flex items-center space-x-1 px-1.5 py-1 rounded bg-[#121620] hover:bg-[#1b2130] text-[10px] text-amber-400 font-medium transition-colors"
                              >
                                <Sparkles className="w-3 h-3 shrink-0" />
                                <span className="truncate">Advisor</span>
                              </button>
                            )}
                            {onOpenSchemaDiff && (
                              <button
                                type="button"
                                onClick={() => onOpenSchemaDiff(db.name)}
                                title="Schema Diff & Migrations"
                                className="flex items-center space-x-1 px-1.5 py-1 rounded bg-[#121620] hover:bg-[#1b2130] text-[10px] text-indigo-400 font-medium transition-colors"
                              >
                                <GitCompare className="w-3 h-3 shrink-0" />
                                <span className="truncate">Diff / Migrar</span>
                              </button>
                            )}
                            {onOpenOperations && (
                              <button
                                type="button"
                                onClick={() => onOpenOperations(db.name)}
                                title="Mantenimiento y operaciones de tablas"
                                className="flex items-center space-x-1 px-1.5 py-1 rounded bg-[#121620] hover:bg-[#1b2130] text-[10px] text-cyan-400 font-medium transition-colors"
                              >
                                <Wrench className="w-3 h-3 shrink-0" />
                                <span className="truncate">Mantenimiento</span>
                              </button>
                            )}
                            {onOpenSqlExport && (
                              <button
                                type="button"
                                onClick={() => onOpenSqlExport(db.name)}
                                title="Exportar base de datos a SQL (.sql Dump)"
                                className="flex items-center space-x-1 px-1.5 py-1 rounded bg-[#121620] hover:bg-[#1b2130] text-[10px] text-rose-400 font-medium transition-colors"
                              >
                                <FileCode2 className="w-3 h-3 shrink-0" />
                                <span className="truncate">Exportar SQL</span>
                              </button>
                            )}
                            {onOpenBackupRestore && (
                              <button
                                type="button"
                                onClick={() => onOpenBackupRestore(db.name)}
                                title="Respaldar y Restaurar base de datos"
                                className="flex items-center space-x-1 px-1.5 py-1 rounded bg-[#121620] hover:bg-[#1b2130] text-[10px] text-orange-400 font-medium transition-colors"
                              >
                                <Archive className="w-3 h-3 shrink-0" />
                                <span className="truncate">Respaldo / Restore</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {/* 1. TABLAS FOLDER */}
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
                              {onOpenSqlExport && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onOpenSqlExport(db.name);
                                  }}
                                  title="Exportar base de datos completa a SQL"
                                  className="p-0.5 rounded hover:bg-rose-600/30 text-rose-400 transition-colors"
                                >
                                  <FileCode2 className="w-3 h-3" />
                                </button>
                              )}
                              {onOpenImportExcel && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onOpenImportExcel(db.name);
                                  }}
                                  title="Importar archivo Excel (.xlsx / .xls)"
                                  className="p-0.5 rounded hover:bg-emerald-600/30 text-emerald-400 transition-colors"
                                >
                                  <FileSpreadsheet className="w-3 h-3" />
                                </button>
                              )}
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
                                <div className="py-1 px-1.5 text-[10px] text-neutral-500 italic">
                                  Sin tablas
                                </div>
                              ) : (
                                filteredTables.map((table) => {
                                  const isView = table.table_type === "VIEW";
                                  const isCurrent = activeTable === `${db.name}.${table.name}`;

                                  return (
                                    <div
                                      key={table.name}
                                      onClick={() => onSelectTable(db.name, table)}
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

                        {/* 2. PROCEDIMIENTOS FOLDER */}
                        <div className="flex flex-col">
                          <div
                            onClick={(e) => toggleFolder(`${db.name}-procs`, e)}
                            className="group flex items-center justify-between px-1.5 py-1 rounded text-[11px] text-neutral-400 hover:text-white hover:bg-[#131622] cursor-pointer"
                          >
                            <div className="flex items-center space-x-1.5 truncate">
                              {isProcsOpen ? (
                                <ChevronDown className="w-3 h-3 text-neutral-500" />
                              ) : (
                                <ChevronRight className="w-3 h-3 text-neutral-500" />
                              )}
                              <Settings className="w-3.5 h-3.5 text-orange-400/80" />
                              <span className="font-semibold font-mono">Procedimientos ({filteredProcs.length})</span>
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
                                <Plus className="w-3 h-3" />
                              </button>
                            )}
                          </div>

                          {isProcsOpen && (
                            <div className="ml-3 pl-1.5 border-l border-[#1a1f2e] space-y-0.5 mt-0.5">
                              {filteredProcs.length === 0 ? (
                                <div className="py-1 px-1.5 text-[10px] text-neutral-500 italic">
                                  Sin procedimientos
                                </div>
                              ) : (
                                filteredProcs.map((proc) => {
                                  const isCurrent = activeRoutine === `${db.name}.${proc.name}`;
                                  return (
                                    <div
                                      key={proc.name}
                                      onClick={() => onSelectRoutine && onSelectRoutine(db.name, proc.name, "PROCEDURE")}
                                      className={`group flex items-center justify-between px-1.5 py-0.5 rounded text-xs cursor-pointer transition-colors ${
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

                        {/* 3. FUNCIONES FOLDER */}
                        <div className="flex flex-col">
                          <div
                            onClick={(e) => toggleFolder(`${db.name}-funcs`, e)}
                            className="group flex items-center justify-between px-1.5 py-1 rounded text-[11px] text-neutral-400 hover:text-white hover:bg-[#131622] cursor-pointer"
                          >
                            <div className="flex items-center space-x-1.5 truncate">
                              {isFuncsOpen ? (
                                <ChevronDown className="w-3 h-3 text-neutral-500" />
                              ) : (
                                <ChevronRight className="w-3 h-3 text-neutral-500" />
                              )}
                              <FunctionSquare className="w-3.5 h-3.5 text-purple-400/80" />
                              <span className="font-semibold font-mono">Funciones ({filteredFuncs.length})</span>
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
                                <Plus className="w-3 h-3" />
                              </button>
                            )}
                          </div>

                          {isFuncsOpen && (
                            <div className="ml-3 pl-1.5 border-l border-[#1a1f2e] space-y-0.5 mt-0.5">
                              {filteredFuncs.length === 0 ? (
                                <div className="py-1 px-1.5 text-[10px] text-neutral-500 italic">
                                  Sin funciones
                                </div>
                              ) : (
                                filteredFuncs.map((func) => {
                                  const isCurrent = activeRoutine === `${db.name}.${func.name}`;
                                  return (
                                    <div
                                      key={func.name}
                                      onClick={() => onSelectRoutine && onSelectRoutine(db.name, func.name, "FUNCTION")}
                                      className={`group flex items-center justify-between px-1.5 py-0.5 rounded text-xs cursor-pointer transition-colors ${
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

                        {/* 4. TRIGGERS FOLDER */}
                        <div className="flex flex-col">
                          <div
                            onClick={(e) => toggleFolder(`${db.name}-triggers`, e)}
                            className="group flex items-center justify-between px-1.5 py-1 rounded text-[11px] text-neutral-400 hover:text-white hover:bg-[#131622] cursor-pointer"
                          >
                            <div className="flex items-center space-x-1.5 truncate">
                              {isTriggersOpen ? (
                                <ChevronDown className="w-3 h-3 text-neutral-500" />
                              ) : (
                                <ChevronRight className="w-3 h-3 text-neutral-500" />
                              )}
                              <Zap className="w-3.5 h-3.5 text-amber-400/80" />
                              <span className="font-semibold font-mono">Triggers ({filteredTriggers.length})</span>
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
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

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
