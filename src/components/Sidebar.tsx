import React, { useState, useRef, useEffect, useMemo, useLayoutEffect } from "react";
import {
  Database,
  Table as TableIcon,
  ChevronDown,
  ChevronRight,
  Search,
  Hash,
  Loader2,
  Plus,
  Settings,
  Zap,
  FileSpreadsheet,
  Trash2,
  LayoutDashboard,
  Wrench,
  FileCode2,
  FileText,
  Copy,
  Edit3,
  PanelLeftClose,
  Binary,
  Calendar,
  ToggleLeft,
  ToggleRight,
  Play,
} from "lucide-react";
import type { DbTool } from "./dbTools";
import { TableContextMenu } from "./TableContextMenu";
import type {
  DatabaseSchema,
  TableMetadata,
  RoutineMetadata,
  TriggerMetadata,
  SequenceMetadata,
  EventMetadata,
} from "../types/database";
import { ConfirmModal } from "./ConfirmModal";
import { QueriesNode } from "./SavedQueriesFolder";
import { fileName } from "./connectionTransport";
import { useObjectGroups } from "../services/objectGroupsStorage";
import { getFolders, type GroupKind } from "../utils/objectGroups";
import { ObjectIcon, type DbObjectKind } from "./objectIcons";
import { openObjectBrowser, type BrowsableKind } from "./objectBrowser";
import { useConnectionStore } from "../stores/connectionStore";
import { activeSavedConnectionId } from "../types/database";
import { useSchemaStore } from "../stores/schemaStore";
import { useCapabilitiesStore } from "../stores/capabilitiesStore";

interface SidebarProps {
  width?: number;
  onCollapse?: () => void;
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
  onNewQueryTab?: (sql?: string, dbName?: string) => void;
  activeTable?: string;
  activeRoutine?: string;
  activeTrigger?: string;
  isDbListLoading: boolean;
  onOpenCreateDatabase?: () => void;
  onOpenCreateTable?: (dbName: string) => void;
  onOpenImportExcel?: (dbName: string, tableName?: string) => void;
  onOpenSqlExport?: (dbName: string, tableName?: string) => void;
  onDropTable?: (dbName: string, tableName: string) => void;
  onRenameTable?: (dbName: string, tableName: string) => void;
  onDuplicateTable?: (dbName: string, tableName: string) => void;
  onOpenCreateRoutine?: (
    dbName: string,
    routineType: "PROCEDURE" | "FUNCTION"
  ) => void;
  onOpenCreateTrigger?: (dbName: string, tableName?: string) => void;
  onOpenDashboard?: (dbName: string) => void;
  /** Database-scoped tools listed in each database's Herramientas section. */
  dbTools?: DbTool[];
}

interface ContextMenuState {
  x: number;
  y: number;
  type: "database" | "table" | "routine" | "trigger" | "sequence" | "event";
  dbName: string;
  tableName?: string;
  routineName?: string;
  routineType?: "PROCEDURE" | "FUNCTION";
  triggerName?: string;
  sequenceName?: string;
  eventName?: string;
  eventStatus?: string;
}

/** Minimum gap between a context menu and the window edges, in px. */
const CONTEXT_MENU_MARGIN = 10;

export const Sidebar: React.FC<SidebarProps> = ({
  width,
  onCollapse,
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
  onNewQueryTab,
  activeTable,
  activeRoutine,
  activeTrigger,
  isDbListLoading,
  onOpenCreateDatabase,
  onOpenCreateTable,
  onOpenImportExcel,
  onOpenSqlExport,
  onDropTable,
  onRenameTable,
  onDuplicateTable,
  onOpenCreateRoutine,
  onOpenCreateTrigger,
  onOpenDashboard,
  dbTools = [],
}) => {
  const {
    sequences = {},
    events = {},
    dropSequence,
    dropEvent,
    toggleEvent,
  } = useSchemaStore();
  const { isSupported, supportsFeature } = useCapabilitiesStore();

  const [searchTerm, setSearchTerm] = useState("");
  const normalizedSearch = useMemo(() => searchTerm.trim().toLowerCase(), [searchTerm]);
  const [expandedDbs, setExpandedDbs] = useState<Record<string, boolean>>({});
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [tableToDrop, setTableToDrop] = useState<{ dbName: string; tableName: string } | null>(null);
  const [sequenceToDrop, setSequenceToDrop] = useState<{ dbName: string; sequenceName: string } | null>(null);
  const [eventToDrop, setEventToDrop] = useState<{ dbName: string; eventName: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Automatically expand selected database and its tables subfolder when selected externally
  useEffect(() => {
    if (selectedDatabase) {
      setExpandedDbs((prev) => ({ ...prev, [selectedDatabase]: true }));
      setExpandedFolders((prev) => ({ ...prev, [`${selectedDatabase}-tables`]: true }));
    }
  }, [selectedDatabase]);

  // Keep the whole context menu on screen: measure it before paint and shift it up/left
  // as needed (it opens upward from the click point when there is no room below).
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!contextMenu || !el) return;
    const margin = CONTEXT_MENU_MARGIN;
    const { width, height } = el.getBoundingClientRect();
    const fitsBelow = contextMenu.y + height + margin <= window.innerHeight;
    const top = fitsBelow ? contextMenu.y : contextMenu.y - height;
    el.style.left = `${Math.max(margin, Math.min(contextMenu.x, window.innerWidth - width - margin))}px`;
    el.style.top = `${Math.max(margin, Math.min(top, window.innerHeight - height - margin))}px`;
    el.style.visibility = "visible";
  }, [contextMenu]);

  // Close context menu on outside click or Escape
  useEffect(() => {
    // The table menu (TableContextMenu) closes itself.
    if (!contextMenu || contextMenu.type === "table") return;

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
    // Only the active database can be expanded; clicking another one asks to activate it.
    if (dbName !== selectedDatabase) {
      onSelectDatabase(dbName);
      return;
    }
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

  const handleContextMenu = (
    e: React.MouseEvent,
    menuData: Omit<ContextMenuState, "x" | "y">
  ) => {
    e.preventDefault();
    e.stopPropagation();

    // Real placement happens in the layout effect below, once the menu's size is known.
    setContextMenu({ ...menuData, x: e.clientX, y: e.clientY });
  };

  const filteredDatabases = useMemo(() => {
    if (!normalizedSearch) return databases;
    return databases.filter((db) => {
      if (db.name.toLowerCase().includes(normalizedSearch)) return true;
      const dbTables = tables[db.name];
      if (dbTables && dbTables.some((t) => t.name.toLowerCase().includes(normalizedSearch))) return true;
      const dbRoutines = routines[db.name];
      if (dbRoutines && dbRoutines.some((r) => r.name.toLowerCase().includes(normalizedSearch))) return true;
      const dbTriggers = triggers[db.name];
      if (dbTriggers && dbTriggers.some((tr) => tr.name.toLowerCase().includes(normalizedSearch))) return true;
      return false;
    });
  }, [databases, tables, routines, triggers, normalizedSearch]);

  const renderTableRow = (dbName: string, table: TableMetadata) => {
    const isView = table.table_type === "VIEW";
                                  const isCurrent = activeTable === `${dbName}.${table.name}`;

                                  return (
                                    <div
                                      key={table.name}
                                      onClick={() => onSelectTable(dbName, table)}
                                      onContextMenu={(e) =>
                                        handleContextMenu(e, {
                                          type: "table",
                                          dbName: dbName,
                                          tableName: table.name,
                                        })
                                      }
                                      className={`group flex items-center justify-between px-1.5 py-0.5 rounded text-xs cursor-pointer transition-colors ${
                                        isCurrent
                                          ? "bg-hover text-fg border-l-2 border-accent pl-1"
                                          : "text-fg-muted hover:bg-hover hover:text-fg"
                                      }`}
                                    >
                                      <div className="flex items-center space-x-1.5 truncate">
                                        {isView ? (
                                          <ObjectIcon kind="views" className="w-3 h-3" />
                                        ) : (
                                          <ObjectIcon kind="tables" className="w-3 h-3" />
                                        )}
                                        <span className="truncate font-mono text-[11px]">
                                          {table.name}
                                        </span>
                                      </div>

                                      <div className="flex items-center space-x-1 shrink-0">
                                        {table.rows_count !== null &&
                                          table.rows_count !== undefined &&
                                          !isView && (
                                            <span className="text-[11px] text-fg-subtle font-mono flex items-center group-hover:hidden">
                                              <Hash className="w-2 h-2 opacity-60" />
                                              {table.rows_count.toLocaleString()}
                                            </span>
                                          )}
                                        {onOpenCreateTrigger && !isView && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              onOpenCreateTrigger(dbName, table.name);
                                            }}
                                            title={`Crear nuevo trigger para tabla '${table.name}'`}
                                            className="hidden group-hover:flex p-0.5 rounded text-fg-muted hover:text-fg hover:bg-hover transition-colors"
                                          >
                                            <Zap className="w-3 h-3" />
                                          </button>
                                        )}
                                        {onOpenSqlExport && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              onOpenSqlExport(dbName, table.name);
                                            }}
                                            title={`Exportar tabla '${table.name}' a SQL`}
                                            className="hidden group-hover:flex p-0.5 rounded text-fg-muted hover:text-fg hover:bg-hover transition-colors"
                                          >
                                            <FileCode2 className="w-3 h-3" />
                                          </button>
                                        )}
                                        {onDropTable && !isView && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setTableToDrop({ dbName: dbName, tableName: table.name });
                                            }}
                                            title={`Eliminar tabla '${table.name}' (DROP TABLE)`}
                                            className="hidden group-hover:flex p-0.5 rounded text-fg-muted hover:text-danger hover:bg-hover transition-colors"
                                          >
                                            <Trash2 className="w-3 h-3" />
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  );
  };

  const renderRoutineRow = (dbName: string, routine: { name: string }, routineType: "PROCEDURE" | "FUNCTION") => {
    const isCurrent = activeRoutine === `${dbName}.${routine.name}`;
                                        return (
                                          <div
                                            key={routine.name}
                                            onClick={() =>
                                              onSelectRoutine &&
                                              onSelectRoutine(dbName, routine.name, routineType)
                                            }
                                            onContextMenu={(e) =>
                                              handleContextMenu(e, {
                                                type: "routine",
                                                dbName: dbName,
                                                routineName: routine.name,
                                                routineType: routineType,
                                              })
                                            }
                                            className={`group flex items-center justify-between px-1 py-0.5 rounded text-xs cursor-pointer transition-colors ${
                                              isCurrent
                                                ? "bg-hover text-fg border-l-2 border-accent pl-1"
                                                : "text-fg-muted hover:bg-hover hover:text-fg"
                                            }`}
                                          >
                                            <div className="flex items-center space-x-1.5 truncate">
                                              <ObjectIcon kind={routineType === "FUNCTION" ? "functions" : "procedures"} className="w-3 h-3" />
                                              <span className="truncate font-mono text-[11px]">
                                                {routine.name}
                                              </span>
                                            </div>
                                          </div>
                                        );
  };

  /** Tree node header: chevron toggles, label opens the object browser. */
  const renderNodeHeader = (opts: {
    dbName: string;
    folderKey: string;
    kind: DbObjectKind;
    label: string;
    count: number;
    isOpen: boolean;
    browse?: BrowsableKind;
    onCreate?: () => void;
    createTitle?: string;
  }) => (
    <div
      onClick={(e) => {
        if (opts.browse) {
          e.stopPropagation();
          onSelectDatabase(opts.dbName);
          openObjectBrowser(opts.dbName, opts.browse);
        } else {
          toggleFolder(opts.folderKey, e);
        }
      }}
      title={opts.browse ? `Abrir ${opts.label.toLowerCase()} de ${opts.dbName}` : undefined}
      className="group flex items-center justify-between px-1.5 py-1 rounded text-[11px] text-fg-muted hover:text-fg hover:bg-hover cursor-pointer"
    >
      <div className="flex items-center gap-1.5 truncate">
        <span onClick={(e) => toggleFolder(opts.folderKey, e)} className="p-0.5 hover:text-fg" title={opts.isOpen ? "Contraer" : "Expandir"}>
          {opts.isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
        <ObjectIcon kind={opts.kind} />
        <span className="font-medium">
          {opts.label} <span className="text-fg-muted font-normal">{opts.count}</span>
        </span>
      </div>
      {opts.onCreate && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            opts.onCreate?.();
          }}
          title={opts.createTitle}
          className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-hover"
        >
          <Plus className="w-3 h-3" />
        </button>
      )}
    </div>
  );

  /** Children of a node, with the connection's object folders as collapsible sub-nodes. */
  const renderGroupedChildren = (
    isOpen: boolean,
    empty: string,
    dbName: string,
    kind: GroupKind,
    entries: { name: string; row: React.ReactNode }[] | (() => { name: string; row: React.ReactNode }[]),
  ) => {
    if (!isOpen) return null;
    const resolvedEntries = typeof entries === "function" ? entries() : entries;
    const folders = getFolders(objectGroups, dbName, kind);
    const folderNames = Object.keys(folders).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    const grouped = new Set(folderNames.flatMap((f) => folders[f]));
    const loose = resolvedEntries.filter((e) => !grouped.has(e.name)).map((e) => e.row);
    const folderRows = folderNames.map((f) => {
      const key = `${dbName}-${kind}-group-${f}`;
      const members = resolvedEntries.filter((e) => folders[f].includes(e.name));
      // While filtering, folders with matches open by themselves and the rest hide.
      if (normalizedSearch && !members.length) return null;
      const open = (expandedFolders[key] ?? false) || (!!normalizedSearch && members.length > 0);
      return (
        <div key={key} className="flex flex-col">
          <div
            onClick={(e) => toggleFolder(key, e)}
            className="flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11px] text-fg-muted hover:text-fg hover:bg-hover cursor-pointer"
          >
            {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            <ObjectIcon kind="folder" open={open} />
            <span className="truncate">{f}</span>
            <span className="ml-auto text-[11px]">{members.length}</span>
          </div>
          {open && (
            <div className="ml-3 pl-1.5 border-l border-line space-y-0.5">
              {members.length ? members.map((m) => m.row) : <div className="px-1.5 text-[11px] text-fg-muted">Vacía</div>}
            </div>
          )}
        </div>
      );
    });
    return renderChildren(true, empty, [...folderRows.filter(Boolean), ...loose]);
  };

  const renderChildren = (isOpen: boolean, empty: string, rows: React.ReactNode[]) =>
    isOpen ? (
      <div className="ml-3 pl-1.5 border-l border-line space-y-0.5 mt-0.5">
        {rows.length ? rows : <div className="py-0.5 px-1.5 text-[11px] text-fg-muted">{empty}</div>}
      </div>
    ) : null;

  const activeConnectionId = useConnectionStore((s) => activeSavedConnectionId(s.connectionStatus.config));
  const databaseFile = useConnectionStore((s) => s.connectionStatus.config?.file_path);
  const objectGroups = useObjectGroups(activeConnectionId);

  return (
    <aside
      style={{ width: width ? `${width}px` : undefined }}
      className={`pyro-explorer w-full flex flex-col h-full select-none shrink-0 transition-colors border-r bg-canvas border-line text-fg`}
    >
      {/* Top Header */}
      <div
        data-explorer-header className={`p-3 border-b flex items-center justify-between border-line bg-transparent`}
      >
        <div
          className={`flex items-center space-x-2 text-xs font-semibold text-fg`}
        >
          <span>Explorador</span>
        </div>
        <div className="flex items-center space-x-1.5">
          {onCollapse && (
            <button
              onClick={onCollapse}
              title="Ocultar explorador lateral (Ctrl+B)"
              className={`p-1 rounded transition-colors text-fg-muted hover:text-fg hover:bg-hover`}
            >
              <PanelLeftClose className="w-3.5 h-3.5" />
            </button>
          )}
          {onOpenCreateDatabase && (
            <button
              onClick={onOpenCreateDatabase}
              title="Crear nueva base de datos"
              className="p-1 rounded hover:bg-hover text-fg-muted hover:text-fg transition-colors flex items-center space-x-0.5"
            >
              <Database className="w-3.5 h-3.5" />
              <Plus className="w-2.5 h-2.5 -ml-1 text-fg-muted" />
            </button>
          )}
          {selectedDatabase && onOpenCreateTable && (
            <button
              onClick={() => onOpenCreateTable(selectedDatabase)}
              title={`Crear nueva tabla en '${selectedDatabase}'`}
              className="p-1 rounded hover:bg-hover text-fg-muted hover:text-fg transition-colors flex items-center space-x-0.5"
            >
              <TableIcon className="w-3.5 h-3.5" />
              <Plus className="w-2.5 h-2.5 -ml-1 text-fg-muted" />
            </button>
          )}
        </div>
      </div>

      {/* Filter / Search Box */}
      <div
        className={`p-2 border-b border-line`}
      >
        <div data-explorer-search className="relative">
          <Search
            className={`w-3.5 h-3.5 absolute left-2.5 top-2.5 text-fg-subtle`}
          />
          <input
            type="text"
            placeholder="Filtrar tablas, rutinas..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`w-full pl-8 pr-2.5 py-1.5 text-xs rounded transition-colors font-mono focus:outline-none focus:border-accent/60 border bg-surface border-line text-fg placeholder:text-fg-subtle`}
          />
        </div>
      </div>

      {/* Database Tree */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {/* File-based engines (SQLite): the file is the root, its schemas the children. */}
        {databaseFile && (
          <div
            title={databaseFile}
            className="flex items-center gap-2 px-2 py-1.5 text-[11px] font-semibold font-mono text-fg"
          >
            <FileText className="w-3.5 h-3.5 text-fg-muted shrink-0" />
            <span className="truncate">{fileName(databaseFile)}</span>
          </div>
        )}
        <div className={databaseFile ? "ml-3 pl-2 border-l border-line space-y-1" : "space-y-1"}>
        {isDbListLoading ? (
          <div className="flex flex-col items-center justify-center py-10 space-y-2 text-fg-subtle">
            <Loader2 className="w-5 h-5 animate-spin text-fg-muted" />
            <span className="text-xs">Cargando bases de datos...</span>
          </div>
        ) : filteredDatabases.length === 0 ? (
          <div className="text-center py-8 px-3 text-xs text-fg-subtle">
            {databases.length === 0
              ? "Sin conexión activa. Haz clic en 'Conectar'."
              : "No se encontraron coincidencias."}
          </div>
        ) : (
          filteredDatabases.map((db) => {
            const isActiveDb = selectedDatabase === db.name;
            const isExpanded = isActiveDb && (expandedDbs[db.name] ?? true);
            const dbTables = tables[db.name] || [];
            const dbRoutines = routines[db.name] || [];
            const dbTriggers = triggers[db.name] || [];
            const dbSequences = sequences[db.name] || [];
            const dbEvents = events[db.name] || [];
            const isLoading = isLoadingTables[db.name];

            const isTablesOpen = (expandedFolders[`${db.name}-tables`] ?? false) || !!normalizedSearch;
            const isViewsOpen = (expandedFolders[`${db.name}-views`] ?? false) || !!normalizedSearch;
            const isProcsOpen = (expandedFolders[`${db.name}-procs`] ?? false) || !!normalizedSearch;
            const isFuncsOpen = (expandedFolders[`${db.name}-funcs`] ?? false) || !!normalizedSearch;
            const isTriggersOpen = (expandedFolders[`${db.name}-triggers`] ?? false) || !!normalizedSearch;
            const isSequencesOpen = (expandedFolders[`${db.name}-sequences`] ?? false) || !!normalizedSearch;
            const isEventsOpen = (expandedFolders[`${db.name}-events`] ?? false) || !!normalizedSearch;
            const isToolsOpen = expandedFolders[`${db.name}-tools`] ?? false;

            let baseTables: TableMetadata[] = [];
            let views: TableMetadata[] = [];
            let filteredProcs: RoutineMetadata[] = [];
            let filteredFuncs: RoutineMetadata[] = [];
            let filteredTriggers: TriggerMetadata[] = [];
            let filteredSequences: SequenceMetadata[] = [];
            let filteredEvents: EventMetadata[] = [];

            if (isExpanded) {
              if (normalizedSearch) {
                for (const t of dbTables) {
                  if (t.name.toLowerCase().includes(normalizedSearch)) {
                    if (t.table_type === "VIEW") views.push(t);
                    else baseTables.push(t);
                  }
                }
                for (const r of dbRoutines) {
                  if (r.name.toLowerCase().includes(normalizedSearch)) {
                    if (r.routine_type === "PROCEDURE") filteredProcs.push(r);
                    else if (r.routine_type === "FUNCTION") filteredFuncs.push(r);
                  }
                }
                filteredTriggers = dbTriggers.filter((tr) => tr.name.toLowerCase().includes(normalizedSearch));
                filteredSequences = dbSequences.filter((s) => s.name.toLowerCase().includes(normalizedSearch));
                filteredEvents = dbEvents.filter((ev) => ev.name.toLowerCase().includes(normalizedSearch));
              } else {
                for (const t of dbTables) {
                  if (t.table_type === "VIEW") views.push(t);
                  else baseTables.push(t);
                }
                for (const r of dbRoutines) {
                  if (r.routine_type === "PROCEDURE") filteredProcs.push(r);
                  else if (r.routine_type === "FUNCTION") filteredFuncs.push(r);
                }
                filteredTriggers = dbTriggers;
                filteredSequences = dbSequences;
                filteredEvents = dbEvents;
              }
            }

            return (
              <div key={db.name} className="flex flex-col">
                {/* Database item header */}
                <div
                  onClick={(e) => toggleDbExpand(db.name, e)}
                  onContextMenu={(e) =>
                    handleContextMenu(e, { type: "database", dbName: db.name })
                  }
                  title={isActiveDb ? "Base de datos activa" : `Clic para activar '${db.name}'`}
                  className={`group flex items-center justify-between px-2 py-1.5 rounded cursor-pointer transition-colors text-xs border-l-2 ${
                    isActiveDb
                      ? "border-accent bg-hover text-fg font-semibold"
                      : "border-transparent text-fg-muted hover:bg-hover hover:text-fg"
                  }`}
                >
                  <div className="flex items-center space-x-2 truncate">
                    {isActiveDb ? (
                      isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5 text-fg-muted shrink-0" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-fg-muted shrink-0" />
                      )
                    ) : (
                      <span className="w-3.5 shrink-0" />
                    )}
                    <ObjectIcon kind="database" open={isExpanded} />
                    <span className={`truncate font-mono text-[11px] ${isActiveDb ? "font-semibold" : ""}`}>
                      {db.name}
                    </span>
                  </div>

                  <div className="flex items-center space-x-1">
                    <span
                      className={`text-[11px] font-mono shrink-0 px-1 rounded text-fg-subtle bg-canvas`}
                    >
                      {db.tables_count}
                    </span>
                  </div>
                </div>

                {/* Database Sub-trees */}
                {isExpanded && (
                  <div
                    className={`ml-3 pl-2 my-1 space-y-0.5 border-l border-line`}
                  >
                    {isLoading ? (
                      <div className="flex items-center space-x-2 py-2 px-2 text-fg-subtle text-xs">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-fg-muted" />
                        <span>Cargando esquema...</span>
                      </div>
                    ) : (
                      <>
                        {/* 1. RESUMEN / DASHBOARD (Explicit Click Action) */}
                        {onOpenDashboard && (
                          <div
                            onClick={() => onOpenDashboard(db.name)}
                            title="Abrir Resumen y Métricas de la Base de Datos"
                            className="group flex items-center justify-between px-1.5 py-1 rounded text-[11px] text-fg hover:text-fg hover:bg-hover cursor-pointer transition-colors"
                          >
                            <div className="flex items-center space-x-2 truncate">
                              <LayoutDashboard className="w-3.5 h-3.5 text-fg-muted shrink-0" />
                              <span className="font-medium font-mono">Resumen</span>
                            </div>
                            <span className="text-[11px] text-fg-subtle font-mono opacity-0 group-hover:opacity-100">
                              Panel
                            </span>
                          </div>
                        )}

                        {/* TABLAS */}
                        <div className="flex flex-col">
                          {renderNodeHeader({
                            dbName: db.name,
                            folderKey: `${db.name}-tables`,
                            kind: "tables",
                            label: "Tablas",
                            count: baseTables.length,
                            isOpen: isTablesOpen,
                            browse: "tables",
                            onCreate: onOpenCreateTable ? () => onOpenCreateTable(db.name) : undefined,
                            createTitle: "Nueva tabla",
                          })}
                          {renderGroupedChildren(isTablesOpen, "Sin tablas", db.name, "tables", () => baseTables.map((t) => ({ name: t.name, row: renderTableRow(db.name, t) })))}
                        </div>

                        {/* VISTAS */}
                        <div className="flex flex-col">
                          {renderNodeHeader({
                            dbName: db.name,
                            folderKey: `${db.name}-views`,
                            kind: "views",
                            label: "Vistas",
                            count: views.length,
                            isOpen: isViewsOpen,
                            browse: "views",
                          })}
                          {renderGroupedChildren(isViewsOpen, "Sin vistas", db.name, "views", () => views.map((t) => ({ name: t.name, row: renderTableRow(db.name, t) })))}
                        </div>

                        {/* FUNCIONES */}
                        {supportsFeature("routines") && (
                        <div className="flex flex-col">
                          {renderNodeHeader({
                            dbName: db.name,
                            folderKey: `${db.name}-funcs`,
                            kind: "functions",
                            label: "Funciones",
                            count: filteredFuncs.length,
                            isOpen: isFuncsOpen,
                            browse: "functions",
                            onCreate: onOpenCreateRoutine ? () => onOpenCreateRoutine(db.name, "FUNCTION") : undefined,
                            createTitle: "Nueva función",
                          })}
                          {renderGroupedChildren(isFuncsOpen, "Sin funciones", db.name, "functions", () => filteredFuncs.map((f) => ({ name: f.name, row: renderRoutineRow(db.name, f, "FUNCTION") })))}
                        </div>
                        )}

                        {/* PROCEDIMIENTOS */}
                        {supportsFeature("routines") && (
                        <div className="flex flex-col">
                          {renderNodeHeader({
                            dbName: db.name,
                            folderKey: `${db.name}-procs`,
                            kind: "procedures",
                            label: "Procedimientos",
                            count: filteredProcs.length,
                            isOpen: isProcsOpen,
                            browse: "procedures",
                            onCreate: onOpenCreateRoutine ? () => onOpenCreateRoutine(db.name, "PROCEDURE") : undefined,
                            createTitle: "Nuevo procedimiento",
                          })}
                          {renderGroupedChildren(isProcsOpen, "Sin procedimientos", db.name, "procedures", () => filteredProcs.map((r) => ({ name: r.name, row: renderRoutineRow(db.name, r, "PROCEDURE") })))}
                        </div>
                        )}

                        {/* CONSULTAS (one node; the list lives in the object browser) */}
                        <QueriesNode
                          connectionId={activeConnectionId}
                          database={db.name}
                          onOpen={() => {
                            onSelectDatabase(db.name);
                            openObjectBrowser(db.name, "queries");
                          }}
                        />

                        {/* 4. TRIGGERS FOLDER */}
                        <div className="flex flex-col">
                          <div
                            onClick={(e) => toggleFolder(`${db.name}-triggers`, e)}
                            className="group flex items-center justify-between px-1.5 py-1 rounded text-[11px] text-fg-muted hover:text-fg hover:bg-hover cursor-pointer"
                          >
                            <div className="flex items-center space-x-1.5 truncate">
                              <span
                                onClick={(e) => toggleFolder(`${db.name}-triggers`, e)}
                                className="p-0.5 hover:text-fg transition-colors"
                              >
                                {isTriggersOpen ? (
                                  <ChevronDown className="w-3 h-3 text-fg-subtle" />
                                ) : (
                                  <ChevronRight className="w-3 h-3 text-fg-subtle" />
                                )}
                              </span>
                              <ObjectIcon kind="triggers" />
                              <span className="font-medium">
                                Triggers <span className="text-fg-muted font-normal">{filteredTriggers.length}</span>
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
                                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-hover text-fg-muted"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            )}
                          </div>

                          {isTriggersOpen && (
                            <div className="ml-3 pl-1.5 border-l border-line space-y-0.5 mt-0.5">
                              {filteredTriggers.length === 0 ? (
                                <div className="py-1 px-1.5 text-[11px] text-fg-subtle italic">
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
                                          ? "bg-hover text-fg border-l-2 border-accent pl-1"
                                          : "text-fg-muted hover:bg-hover hover:text-fg"
                                      }`}
                                    >
                                      <div className="flex items-center space-x-1.5 truncate">
                                        <Zap className="w-3 h-3 text-fg-muted shrink-0" />
                                        <span className="truncate font-mono text-[11px]">
                                          {tr.name}
                                        </span>
                                      </div>
                                      <span className="text-[11px] text-fg-subtle font-mono">
                                        {tr.timing[0]}{tr.event[0]}
                                      </span>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          )}
                        </div>

                        {/* 5. SECUENCIAS (MariaDB Sequences) */}
                        {supportsFeature("sequences") && isSupported("sequences") && (
                          <div className="flex flex-col">
                            <div
                              onClick={(e) => toggleFolder(`${db.name}-sequences`, e)}
                              className="group flex items-center justify-between px-1.5 py-1 rounded text-[11px] text-fg-muted hover:text-fg hover:bg-hover cursor-pointer"
                            >
                              <div className="flex items-center space-x-1.5 truncate">
                                <span
                                  onClick={(e) => toggleFolder(`${db.name}-sequences`, e)}
                                  className="p-0.5 hover:text-fg transition-colors"
                                >
                                  {isSequencesOpen ? (
                                    <ChevronDown className="w-3 h-3 text-fg-subtle" />
                                  ) : (
                                    <ChevronRight className="w-3 h-3 text-fg-subtle" />
                                  )}
                                </span>
                                <ObjectIcon kind="sequences" />
                                <span className="font-medium">
                                  Secuencias <span className="text-fg-muted font-normal">{filteredSequences.length}</span>
                                </span>
                              </div>
                            </div>

                            {isSequencesOpen && (
                              <div className="ml-3 pl-1.5 border-l border-line space-y-0.5 mt-0.5">
                                {filteredSequences.length === 0 ? (
                                  <div className="py-1 px-1.5 text-[11px] text-fg-subtle italic">
                                    Sin secuencias
                                  </div>
                                ) : (
                                  filteredSequences.map((seq) => (
                                    <div
                                      key={seq.name}
                                      onClick={() => {
                                        onNewQueryTab?.(
                                          `SELECT NEXT VALUE FOR \`${db.name}\`.\`${seq.name}\` AS next_value;`,
                                          db.name
                                        );
                                      }}
                                      onContextMenu={(e) =>
                                        handleContextMenu(e, {
                                          type: "sequence",
                                          dbName: db.name,
                                          sequenceName: seq.name,
                                        })
                                      }
                                      className="group flex items-center justify-between px-1.5 py-0.5 rounded text-xs cursor-pointer transition-colors text-fg-muted hover:bg-hover hover:text-fg"
                                    >
                                      <div className="flex items-center space-x-1.5 truncate">
                                        <Binary className="w-3 h-3 text-fg-muted shrink-0" />
                                        <span className="truncate font-mono text-[11px]">
                                          {seq.name}
                                        </span>
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* 6. EVENTOS PROGRAMADOS (Event Scheduler) */}
                        {supportsFeature("events") && isSupported("eventScheduler") && (
                          <div className="flex flex-col">
                            <div
                              onClick={(e) => toggleFolder(`${db.name}-events`, e)}
                              className="group flex items-center justify-between px-1.5 py-1 rounded text-[11px] text-fg-muted hover:text-fg hover:bg-hover cursor-pointer"
                            >
                              <div className="flex items-center space-x-1.5 truncate">
                                <span
                                  onClick={(e) => toggleFolder(`${db.name}-events`, e)}
                                  className="p-0.5 hover:text-fg transition-colors"
                                >
                                  {isEventsOpen ? (
                                    <ChevronDown className="w-3 h-3 text-fg-subtle" />
                                  ) : (
                                    <ChevronRight className="w-3 h-3 text-fg-subtle" />
                                  )}
                                </span>
                                <ObjectIcon kind="events" />
                                <span className="font-semibold font-mono">
                                  Eventos ({filteredEvents.length})
                                </span>
                              </div>
                            </div>

                            {isEventsOpen && (
                              <div className="ml-3 pl-1.5 border-l border-line space-y-0.5 mt-0.5">
                                {filteredEvents.length === 0 ? (
                                  <div className="py-1 px-1.5 text-[11px] text-fg-subtle italic">
                                    Sin eventos programados
                                  </div>
                                ) : (
                                  filteredEvents.map((ev) => (
                                    <div
                                      key={ev.name}
                                      onClick={() => {
                                        onNewQueryTab?.(
                                          `SHOW CREATE EVENT \`${db.name}\`.\`${ev.name}\`;`,
                                          db.name
                                        );
                                      }}
                                      onContextMenu={(e) =>
                                        handleContextMenu(e, {
                                          type: "event",
                                          dbName: db.name,
                                          eventName: ev.name,
                                          eventStatus: ev.status,
                                        })
                                      }
                                      className="group flex items-center justify-between px-1.5 py-0.5 rounded text-xs cursor-pointer transition-colors text-fg-muted hover:bg-hover hover:text-fg"
                                    >
                                      <div className="flex items-center space-x-1.5 truncate">
                                        <Calendar className="w-3 h-3 text-fg-muted shrink-0" />
                                        <span className="truncate font-mono text-[11px]">
                                          {ev.name}
                                        </span>
                                      </div>
                                      <span
                                        className={`text-[11px] font-mono px-1 rounded ${
                                          ev.status === "ENABLED"
                                            ? "text-fg-muted bg-hover"
                                            : "text-fg-subtle bg-surface"
                                        }`}
                                      >
                                        {ev.status === "ENABLED" ? "activo" : "pausado"}
                                      </span>
                                    </div>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* 7. HERRAMIENTAS (Collapsible Tools Section) */}
                        <div className="flex flex-col pt-1.5 mt-1 border-t border-line">
                          <div
                            onClick={(e) => toggleFolder(`${db.name}-tools`, e)}
                            className="group flex items-center justify-between px-1.5 py-1 rounded text-[11px] text-fg-muted hover:text-fg hover:bg-hover cursor-pointer"
                          >
                            <div className="flex items-center space-x-1.5 truncate">
                              <span
                                onClick={(e) => toggleFolder(`${db.name}-tools`, e)}
                                className="p-0.5 hover:text-fg transition-colors"
                              >
                                {isToolsOpen ? (
                                  <ChevronDown className="w-3 h-3 text-fg-subtle" />
                                ) : (
                                  <ChevronRight className="w-3 h-3 text-fg-subtle" />
                                )}
                              </span>
                              <Wrench className="w-3.5 h-3.5 text-fg-muted shrink-0" />
                              <span className="font-medium">Herramientas</span>
                            </div>
                          </div>

                          {isToolsOpen && (
                            <div className="ml-3 pl-1.5 border-l border-line space-y-0.5 mt-0.5">
                              {dbTools.map((tool) => (
                                <div
                                  key={tool.id}
                                  onClick={() => tool.run(db.name)}
                                  title={tool.hint}
                                  className="group flex items-center space-x-2 px-1.5 py-1 rounded text-xs cursor-pointer text-fg-muted hover:bg-hover hover:text-fg transition-colors"
                                >
                                  <tool.icon className="w-3.5 h-3.5 text-fg-muted shrink-0" />
                                  <span className="truncate font-mono text-[11px]">{tool.label}</span>
                                </div>
                              ))}
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
      </div>

      {/* Desktop Context Menu Popup */}
      {contextMenu?.type === "table" && contextMenu.tableName && (
        <TableContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          dbName={contextMenu.dbName}
          tableName={contextMenu.tableName}
          isView={(tables[contextMenu.dbName] || []).some((t) => t.name === contextMenu.tableName && t.table_type === "VIEW")}
          onClose={() => setContextMenu(null)}
          onOpen={(db, name) =>
            onSelectTable(db, (tables[db] || []).find((t) => t.name === name) || { name, table_type: "BASE TABLE" })
          }
          onNewQuery={onNewQueryTab}
          onCreateTrigger={onOpenCreateTrigger}
          onImport={onOpenImportExcel}
          onExport={onOpenSqlExport}
          onRename={onRenameTable}
          onDuplicate={onDuplicateTable}
          onDrop={onDropTable ? (dbName, tableName) => setTableToDrop({ dbName, tableName }) : undefined}
        />
      )}

      {contextMenu && contextMenu.type !== "table" && (
        <div
          ref={menuRef}
          style={{
            top: contextMenu.y,
            left: contextMenu.x,
            visibility: "hidden",
            maxHeight: `calc(100vh - ${CONTEXT_MENU_MARGIN * 2}px)`,
          }}
          className="fixed z-50 min-w-[200px] overflow-y-auto bg-surface border border-line shadow-modal rounded-lg py-1.5 text-xs font-mono text-fg animate-in fade-in zoom-in-95 duration-100 select-none"
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.type === "database" && (() => {
            // Inactive databases only offer activation and non-tab actions.
            const isActiveDbMenu = contextMenu.dbName === selectedDatabase;
            // The menu's own actions come first; the shared tools follow. SQL export is
            // already one of the menu's own actions.
            const menuTools = dbTools.filter((t) => t.id !== "sqlExport");
            return (
            <>
              <div className="px-3 py-1 text-[11px] font-medium text-fg-subtle border-b border-line mb-1 flex items-center justify-between">
                <span className="truncate max-w-[130px]">{contextMenu.dbName}</span>
                <span className="text-fg-muted font-normal lowercase">database</span>
              </div>

              {!isActiveDbMenu && (
                <button
                  onClick={() => {
                    onSelectDatabase(contextMenu.dbName);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-hover hover:text-fg transition-colors text-left"
                >
                  <Database className="w-3.5 h-3.5 text-fg-muted" />
                  <span>Activar esta base de datos</span>
                </button>
              )}



              {onOpenCreateDatabase && (
                <button
                  onClick={() => {
                    onOpenCreateDatabase();
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-hover hover:text-fg transition-colors text-left"
                >
                  <Database className="w-3.5 h-3.5 text-fg-muted" />
                  <span>Nueva Base de Datos...</span>
                </button>
              )}

              {isActiveDbMenu && onOpenCreateTable && (
                <button
                  onClick={() => {
                    onOpenCreateTable(contextMenu.dbName);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-hover hover:text-fg transition-colors text-left"
                >
                  <Plus className="w-3.5 h-3.5 text-fg-muted" />
                  <span>Nueva Tabla...</span>
                </button>
              )}

              {isActiveDbMenu && onOpenCreateTrigger && (
                <button
                  onClick={() => {
                    onOpenCreateTrigger(contextMenu.dbName);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-hover hover:text-fg transition-colors text-left"
                >
                  <Zap className="w-3.5 h-3.5 text-fg-muted" />
                  <span>Nuevo Trigger...</span>
                </button>
              )}

              {isActiveDbMenu && onOpenCreateRoutine && (
                <button
                  onClick={() => {
                    onOpenCreateRoutine(contextMenu.dbName, "PROCEDURE");
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-hover hover:text-fg transition-colors text-left"
                >
                  <Settings className="w-3.5 h-3.5 text-fg-muted" />
                  <span>Nueva Rutina (Procedimiento)...</span>
                </button>
              )}

              {isActiveDbMenu && onOpenImportExcel && (
                <button
                  onClick={() => {
                    onOpenImportExcel(contextMenu.dbName);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-hover hover:text-fg transition-colors text-left"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-fg-muted" />
                  <span>Importar Excel, CSV o JSON...</span>
                </button>
              )}

              {onOpenSqlExport && (
                <button
                  onClick={() => {
                    onOpenSqlExport(contextMenu.dbName);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-hover hover:text-fg transition-colors text-left"
                >
                  <FileCode2 className="w-3.5 h-3.5 text-fg-muted" />
                  <span>Exportar Base de Datos (SQL)...</span>
                </button>
              )}

              {isActiveDbMenu && menuTools.length > 0 && (
                <>
                  <div className="my-1 border-t border-line" />
                  {menuTools.map((tool) => (
                    <button
                      key={tool.id}
                      onClick={() => {
                        tool.run(contextMenu.dbName);
                        setContextMenu(null);
                      }}
                      title={tool.hint}
                      className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-hover hover:text-fg transition-colors text-left"
                    >
                      <tool.icon className="w-3.5 h-3.5 text-fg-muted" />
                      <span>{tool.label}</span>
                    </button>
                  ))}
                </>
              )}




            </>
            );
          })()}

          {contextMenu.type === "routine" && contextMenu.routineName && (
            <>
              <div className="px-3 py-1 text-[11px] font-medium text-fg-subtle border-b border-line mb-1 flex items-center justify-between">
                <span className="truncate max-w-[130px]">{contextMenu.routineName}</span>
                <span className="text-fg-muted font-normal lowercase">
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
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-hover hover:text-fg transition-colors text-left"
              >
                <Edit3 className="w-3.5 h-3.5 text-fg-muted" />
                <span>Abrir Editor DDL</span>
              </button>

              <button
                onClick={() => {
                  if (contextMenu.routineName) {
                    navigator.clipboard.writeText(contextMenu.routineName);
                  }
                  setContextMenu(null);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-hover hover:text-fg transition-colors text-left"
              >
                <Copy className="w-3.5 h-3.5 text-fg-muted" />
                <span>Copiar Nombre</span>
              </button>
            </>
          )}

          {contextMenu.type === "trigger" && contextMenu.triggerName && (
            <>
              <div className="px-3 py-1 text-[11px] font-medium text-fg-subtle border-b border-line mb-1 flex items-center justify-between">
                <span className="truncate max-w-[130px]">{contextMenu.triggerName}</span>
                <span className="text-fg-muted font-normal lowercase">trigger</span>
              </div>

              <button
                onClick={() => {
                  if (onSelectTrigger && contextMenu.triggerName) {
                    onSelectTrigger(contextMenu.dbName, contextMenu.triggerName);
                  }
                  setContextMenu(null);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-hover hover:text-fg transition-colors text-left"
              >
                <Zap className="w-3.5 h-3.5 text-fg-muted" />
                <span>Abrir Definición</span>
              </button>

              <button
                onClick={() => {
                  if (contextMenu.triggerName) {
                    navigator.clipboard.writeText(contextMenu.triggerName);
                  }
                  setContextMenu(null);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-hover hover:text-fg transition-colors text-left"
              >
                <Copy className="w-3.5 h-3.5 text-fg-muted" />
                <span>Copiar Nombre</span>
              </button>
            </>
          )}

          {contextMenu.type === "sequence" && contextMenu.sequenceName && (
            <>
              <div className="px-3 py-1 text-[11px] font-medium text-fg-subtle border-b border-line mb-1 flex items-center justify-between">
                <span className="truncate max-w-[130px]">{contextMenu.sequenceName}</span>
                <span className="text-fg-muted font-normal lowercase">secuencia</span>
              </div>

              <button
                onClick={() => {
                  onNewQueryTab?.(
                    `SELECT NEXT VALUE FOR \`${contextMenu.dbName}\`.\`${contextMenu.sequenceName}\` AS next_val;`,
                    contextMenu.dbName
                  );
                  setContextMenu(null);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-hover hover:text-fg transition-colors text-left"
              >
                <Play className="w-3.5 h-3.5 text-fg-muted" />
                <span>Obtener Siguiente Valor (NEXT VALUE FOR)</span>
              </button>

              <button
                onClick={() => {
                  onNewQueryTab?.(
                    `SHOW CREATE SEQUENCE \`${contextMenu.dbName}\`.\`${contextMenu.sequenceName}\`;`,
                    contextMenu.dbName
                  );
                  setContextMenu(null);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-hover hover:text-fg transition-colors text-left"
              >
                <FileCode2 className="w-3.5 h-3.5 text-fg-muted" />
                <span>Ver Definición DDL</span>
              </button>

              <button
                onClick={() => {
                  if (contextMenu.sequenceName) {
                    navigator.clipboard.writeText(contextMenu.sequenceName);
                  }
                  setContextMenu(null);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-hover hover:text-fg transition-colors text-left"
              >
                <Copy className="w-3.5 h-3.5 text-fg-muted" />
                <span>Copiar Nombre</span>
              </button>

              <div className="my-1 border-t border-line" />

              <button
                onClick={() => {
                  if (contextMenu.sequenceName) {
                    setSequenceToDrop({
                      dbName: contextMenu.dbName,
                      sequenceName: contextMenu.sequenceName,
                    });
                  }
                  setContextMenu(null);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-hover text-danger hover:text-danger transition-colors text-left"
              >
                <Trash2 className="w-3.5 h-3.5 text-danger" />
                <span>Eliminar Secuencia (DROP SEQUENCE)</span>
              </button>
            </>
          )}

          {contextMenu.type === "event" && contextMenu.eventName && (
            <>
              <div className="px-3 py-1 text-[11px] font-medium text-fg-subtle border-b border-line mb-1 flex items-center justify-between">
                <span className="truncate max-w-[130px]">{contextMenu.eventName}</span>
                <span className="text-fg-muted font-normal lowercase">evento</span>
              </div>

              <button
                onClick={() => {
                  onNewQueryTab?.(
                    `SHOW CREATE EVENT \`${contextMenu.dbName}\`.\`${contextMenu.eventName}\`;`,
                    contextMenu.dbName
                  );
                  setContextMenu(null);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-hover hover:text-fg transition-colors text-left"
              >
                <FileCode2 className="w-3.5 h-3.5 text-fg-muted" />
                <span>Ver Definición DDL</span>
              </button>

              <button
                onClick={async () => {
                  const shouldEnable = contextMenu.eventStatus !== "ENABLED";
                  await toggleEvent(contextMenu.dbName, contextMenu.eventName!, shouldEnable);
                  setContextMenu(null);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-hover hover:text-fg transition-colors text-left"
              >
                {contextMenu.eventStatus === "ENABLED" ? (
                  <>
                    <ToggleLeft className="w-3.5 h-3.5 text-fg-muted" />
                    <span>Deshabilitar Evento</span>
                  </>
                ) : (
                  <>
                    <ToggleRight className="w-3.5 h-3.5 text-fg-muted" />
                    <span>Habilitar Evento</span>
                  </>
                )}
              </button>

              <button
                onClick={() => {
                  if (contextMenu.eventName) {
                    navigator.clipboard.writeText(contextMenu.eventName);
                  }
                  setContextMenu(null);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-hover hover:text-fg transition-colors text-left"
              >
                <Copy className="w-3.5 h-3.5 text-fg-muted" />
                <span>Copiar Nombre</span>
              </button>

              <div className="my-1 border-t border-line" />

              <button
                onClick={() => {
                  if (contextMenu.eventName) {
                    setEventToDrop({
                      dbName: contextMenu.dbName,
                      eventName: contextMenu.eventName,
                    });
                  }
                  setContextMenu(null);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-hover text-danger hover:text-danger transition-colors text-left"
              >
                <Trash2 className="w-3.5 h-3.5 text-danger" />
                <span>Eliminar Evento (DROP EVENT)</span>
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

      {/* Confirmation modal for dropping sequences */}
      <ConfirmModal
        isOpen={!!sequenceToDrop}
        title="Eliminar Secuencia (DROP SEQUENCE)"
        message={`¿Estás seguro de que deseas eliminar permanentemente la secuencia '${sequenceToDrop?.sequenceName}' de la base de datos '${sequenceToDrop?.dbName}'?`}
        details="Esta acción ejecutará DROP SEQUENCE en el servidor MariaDB."
        confirmText="Eliminar Secuencia"
        variant="danger"
        onConfirm={async () => {
          if (sequenceToDrop) {
            await dropSequence(sequenceToDrop.dbName, sequenceToDrop.sequenceName);
          }
          setSequenceToDrop(null);
        }}
        onClose={() => setSequenceToDrop(null)}
      />

      {/* Confirmation modal for dropping events */}
      <ConfirmModal
        isOpen={!!eventToDrop}
        title="Eliminar Evento Programado (DROP EVENT)"
        message={`¿Estás seguro de que deseas eliminar permanentemente el evento '${eventToDrop?.eventName}' de la base de datos '${eventToDrop?.dbName}'?`}
        details="Esta acción ejecutará DROP EVENT en el servidor MariaDB."
        confirmText="Eliminar Evento"
        variant="danger"
        onConfirm={async () => {
          if (eventToDrop) {
            await dropEvent(eventToDrop.dbName, eventToDrop.eventName);
          }
          setEventToDrop(null);
        }}
        onClose={() => setEventToDrop(null)}
      />
    </aside>
  );
};

