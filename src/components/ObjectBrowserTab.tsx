import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Columns3, FolderPlus, LayoutGrid, List, Pencil, Plus, RefreshCw, Search, SquarePen, Trash2 } from "lucide-react";
import type { RoutineMetadata, SqlFavorite, TableMetadata } from "../types/database";
import { useSchemaStore } from "../stores/schemaStore";
import { useUIStore } from "../stores/uiStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { FAVORITES_CHANGED_EVENT, favoritesStorage } from "../services/favoritesStorage";
import { dbService } from "../services/tauriDb";
import { ObjectIcon, OBJECT_LABELS, type DbObjectKind } from "./objectIcons";
import { openSavedQuery, savedQueryTabId } from "./SavedQueriesFolder";
import { ghostBtn, iconBtn } from "./ui/styles";
import type { BrowsableKind } from "./objectBrowser";
import { objectGroupsStorage, useObjectGroups } from "../services/objectGroupsStorage";
import {
  createFolder as createGroupFolder,
  deleteFolder as deleteGroupFolder,
  folderOf,
  getFolders,
  moveObject,
  renameFolder as renameGroupFolder,
  type GroupKind,
} from "../utils/objectGroups";


interface ObjectBrowserTabProps {
  database: string;
  kind: BrowsableKind;
  connectionId?: string;
  onOpenTable: (db: string, table: TableMetadata) => void;
  onCreateTable: (db: string) => void;
  onDropTable: (db: string, table: string) => Promise<void> | void;
  onOpenRoutine: (db: string, name: string, type: "PROCEDURE" | "FUNCTION") => void;
  onCreateRoutine: (db: string, type: "PROCEDURE" | "FUNCTION") => void;
}

/** One row of the browser, whatever the object kind. */
interface Item {
  key: string;
  name: string;
  kind: DbObjectKind;
  isFolder?: boolean;
  cells: Record<string, string | number | undefined>;
  table?: TableMetadata;
  routine?: RoutineMetadata;
  query?: SqlFavorite;
}

interface Column {
  id: string;
  label: string;
  align?: "right";
  width?: string;
  format?: (v: string | number | undefined) => string;
}

const formatBytes = (v: string | number | undefined) => {
  const n = Number(v ?? 0);
  if (!n) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
};
const formatNumber = (v: string | number | undefined) => (v === undefined || v === "" ? "—" : Number(v).toLocaleString());
const formatDate = (v: string | number | undefined) => {
  if (v === undefined || v === "") return "—";
  const d = typeof v === "number" ? new Date(v) : new Date(String(v).replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
};

const COLUMNS: Record<BrowsableKind, Column[]> = {
  tables: [
    { id: "rows", label: "Filas", align: "right", width: "w-28", format: formatNumber },
    { id: "size", label: "Tamaño", align: "right", width: "w-24", format: formatBytes },
    { id: "engine", label: "Motor", width: "w-24" },
    { id: "comment", label: "Comentario", width: "w-64" },
  ],
  views: [{ id: "comment", label: "Comentario", width: "w-64" }],
  functions: [
    { id: "returns", label: "Retorna", width: "w-32" },
    { id: "modified", label: "Modificada", width: "w-40", format: formatDate },
    { id: "definer", label: "Definer", width: "w-48" },
  ],
  procedures: [
    { id: "modified", label: "Modificado", width: "w-40", format: formatDate },
    { id: "definer", label: "Definer", width: "w-48" },
  ],
  queries: [
    { id: "modified", label: "Modificada", width: "w-40", format: formatDate },
    { id: "size", label: "Tamaño", align: "right", width: "w-24", format: formatBytes },
  ],
};

const VIEW_MODE_KEY = "pyro_object_browser_view_v1";
type ViewMode = "list" | "compact" | "icons";
const EMPTY_FOLDERS_KEY = "pyro_empty_query_folders_v1";

function readJson<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "") as T;
  } catch {
    return fallback;
  }
}

export const ObjectBrowserTab: React.FC<ObjectBrowserTabProps> = ({
  database,
  kind,
  connectionId,
  onOpenTable,
  onCreateTable,
  onDropTable,
  onOpenRoutine,
  onCreateRoutine,
}) => {
  const tables = useSchemaStore((s) => s.tables[database]);
  const routines = useSchemaStore((s) => s.routines[database]);
  const loadSchemaObjects = useSchemaStore((s) => s.loadSchemaObjects);
  const workspaceVersion = useWorkspaceStore((s) => s.version);
  const [favVersion, setFavVersion] = useState(0);
  const [search, setSearch] = useState("");
  const [folder, setFolder] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 }>({ col: "name", dir: 1 });
  const [dropKey, setDropKey] = useState<string | null>(null);
  // "list" = details table, "compact" = names only flowing in columns, "icons" = large icons
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => readJson<Record<string, ViewMode>>(VIEW_MODE_KEY, {})[kind] ?? "list",
  );
  const emptyFoldersKey = `${connectionId}|${database}`;
  const [emptyFolders, setEmptyFolders] = useState<string[]>(
    () => readJson<Record<string, string[]>>(EMPTY_FOLDERS_KEY, {})[emptyFoldersKey] ?? [],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const groupKind: GroupKind | null = kind === "queries" ? null : kind;
  const groups = useObjectGroups(groupKind ? connectionId : undefined);
  /** Folders need a saved connection (they are stored per connection). */
  const supportsFolders = !!connectionId;

  useEffect(() => {
    const bump = () => setFavVersion((v) => v + 1);
    window.addEventListener(FAVORITES_CHANGED_EVENT, bump);
    return () => window.removeEventListener(FAVORITES_CHANGED_EVENT, bump);
  }, []);

  useEffect(() => {
    if (kind !== "queries" && !tables) void loadSchemaObjects(database);
  }, [kind, tables, database, loadSchemaObjects]);

  const saveEmptyFolders = (next: string[]) => {
    setEmptyFolders(next);
    try {
      const all = readJson<Record<string, string[]>>(EMPTY_FOLDERS_KEY, {});
      all[emptyFoldersKey] = next;
      localStorage.setItem(EMPTY_FOLDERS_KEY, JSON.stringify(all));
    } catch {
      /* per-computer convenience only */
    }
  };

  const queries = useMemo(
    () => (kind === "queries" ? favoritesStorage.forDatabase(connectionId, database) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, connectionId, database, favVersion, workspaceVersion],
  );

  /** All objects of this kind (no folders), with their folder. */
  const allItems: (Item & { folder: string | null })[] = useMemo(() => {
    switch (kind) {
      case "tables":
      case "views":
        return (tables ?? [])
          .filter((t) => (kind === "views") === (t.table_type === "VIEW"))
          .map((t) => ({
            key: t.name,
            name: t.name,
            kind,
            table: t,
            folder: folderOf(groups, database, kind, t.name),
            cells: { rows: t.rows_count, size: t.data_length, engine: t.engine, comment: t.comment },
          }));
      case "functions":
      case "procedures":
        return (routines ?? [])
          .filter((r) => r.routine_type === (kind === "functions" ? "FUNCTION" : "PROCEDURE"))
          .map((r) => ({
            key: r.name,
            name: r.name,
            kind,
            routine: r,
            folder: folderOf(groups, database, kind, r.name),
            cells: { returns: r.data_type, modified: r.last_altered, definer: r.definer },
          }));
      case "queries":
        return queries.map((q) => ({
          key: q.id,
          name: q.title,
          kind: "queries" as const,
          query: q,
          folder: q.folder || null,
          cells: { modified: q.updatedAt, size: new Blob([q.sql]).size },
        }));
    }
  }, [kind, tables, routines, queries, groups, database]);

  const folderNames: string[] = useMemo(() => {
    const names = groupKind
      ? Object.keys(getFolders(groups, database, groupKind))
      : [...queries.map((q) => q.folder).filter(Boolean), ...emptyFolders];
    return [...new Set(names as string[])].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [groupKind, groups, database, queries, emptyFolders]);

  const items: Item[] = useMemo(() => {
    const term = search.trim();
    // While searching, look through every folder.
    if (term) return allItems;
    const folderItems: Item[] =
      folder === null && supportsFolders
        ? folderNames.map((f) => ({
            key: `folder:${f}`,
            name: f,
            kind: "folder" as const,
            isFolder: true,
            cells: {},
          }))
        : [];
    return [...folderItems, ...allItems.filter((i) => i.folder === folder)];
  }, [allItems, folderNames, folder, search, supportsFolders]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term ? items.filter((i) => i.isFolder || i.name.toLowerCase().includes(term)) : items;
    const val = (i: Item) => (sort.col === "name" ? i.name.toLowerCase() : i.cells[sort.col] ?? "");
    return [...filtered].sort((a, b) => {
      if (!!a.isFolder !== !!b.isFolder) return a.isFolder ? -1 : 1;
      const va = val(a);
      const vb = val(b);
      const cmp =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" });
      return cmp * sort.dir;
    });
  }, [items, search, sort]);

  const selectedItem = visible.find((i) => i.key === selected) ?? null;
  const columns = COLUMNS[kind];
  const isQueries = kind === "queries";
  const routineType = kind === "functions" ? "FUNCTION" : "PROCEDURE";

  const ui = useUIStore.getState;
  const showError = (title: string, e: unknown) =>
    ui().showAlert({ title, message: e instanceof Error ? e.message : String(e), variant: "danger", icon: "alert" });

  // ─── Actions ──────────────────────────────────────────────────────────────
  const openItem = (item: Item | null) => {
    if (!item) return;
    if (item.isFolder) {
      setFolder(item.name);
      setSelected(null);
    } else if (item.table) onOpenTable(database, item.table);
    else if (item.routine) onOpenRoutine(database, item.routine.name, item.routine.routine_type);
    else if (item.query) openSavedQuery(item.query, database);
  };

  const createNew = () => {
    if (kind === "tables") onCreateTable(database);
    else if (kind === "functions" || kind === "procedures") onCreateRoutine(database, routineType);
    else if (isQueries) {
      ui().openTab({
        id: `query-${Date.now()}`,
        title: `Consulta · ${database}`,
        type: "query",
        database,
        queryContent: "",
        pendingFolder: folder ?? undefined,
      });
    }
  };

  const createFolder = async () => {
    let name = "Nueva carpeta";
    const taken = new Set(folderNames);
    for (let n = 2; taken.has(name); n++) name = `Nueva carpeta ${n}`;
    try {
      if (groupKind && connectionId) {
        await objectGroupsStorage.update(connectionId, (g) => createGroupFolder(g, database, groupKind, name));
      } else {
        saveEmptyFolders([...emptyFolders, name]);
      }
      setSelected(`folder:${name}`);
      setRenaming(`folder:${name}`);
      setDraft(name);
    } catch (e) {
      showError("No se pudo crear la carpeta", e);
    }
  };

  /** Moves any object (query or schema object) into a folder (null = root). */
  const moveToFolder = async (item: Item, target: string | null) => {
    if (item.query) return moveQuery(item.query, target);
    if (!groupKind || !connectionId) return;
    try {
      await objectGroupsStorage.update(connectionId, (g) => moveObject(g, database, groupKind, item.name, target));
    } catch (e) {
      showError("No se pudo mover el objeto", e);
    }
  };

  const moveQuery = async (q: SqlFavorite, target: string | null) => {
    if ((q.folder || null) === target) return;
    try {
      await favoritesStorage.persistFavorite({ ...q, folder: target ?? undefined });
      if (target) saveEmptyFolders(emptyFolders.filter((f) => f !== target));
    } catch (e) {
      showError("No se pudo mover la consulta", e);
    }
  };

  const commitRename = async (item: Item) => {
    const name = draft.trim();
    setRenaming(null);
    if (!name || name === item.name) return;
    try {
      if (item.isFolder && groupKind && connectionId) {
        await objectGroupsStorage.update(connectionId, (g) => renameGroupFolder(g, database, groupKind, item.name, name));
        setSelected(`folder:${name}`);
      } else if (item.isFolder) {
        const inside = queries.filter((q) => q.folder === item.name);
        for (const q of inside) await favoritesStorage.persistFavorite({ ...q, folder: name });
        saveEmptyFolders(emptyFolders.map((f) => (f === item.name ? name : f)));
        setSelected(`folder:${name}`);
      } else if (item.query) {
        await favoritesStorage.persistFavorite({ ...item.query, title: name });
        ui().renameTab(savedQueryTabId(item.query.id), name);
      }
    } catch (e) {
      showError("No se pudo renombrar", e);
    }
  };

  const deleteItem = (item: Item | null) => {
    if (!item) return;
    if (item.isFolder && groupKind && connectionId) {
      const count = getFolders(groups, database, groupKind)[item.name]?.length ?? 0;
      const remove = async () => {
        try {
          await objectGroupsStorage.update(connectionId, (g) => deleteGroupFolder(g, database, groupKind, item.name));
        } catch (e) {
          showError("No se pudo quitar la carpeta", e);
        }
      };
      if (!count) return void remove();
      ui().showConfirm({
        title: "Quitar carpeta",
        message: `La carpeta «${item.name}» agrupa ${count} objeto(s).`,
        details: "Solo se quita la carpeta: los objetos no se modifican y vuelven a la raíz.",
        variant: "warning",
        icon: "alert",
        confirmText: "Quitar carpeta",
        onConfirm: () => void remove(),
      });
      return;
    }
    if (item.isFolder) {
      const inside = queries.filter((q) => q.folder === item.name);
      if (!inside.length) {
        saveEmptyFolders(emptyFolders.filter((f) => f !== item.name));
        return;
      }
      ui().showConfirm({
        title: "Eliminar carpeta",
        message: `La carpeta «${item.name}» contiene ${inside.length} consulta(s).`,
        details: "Las consultas no se eliminan: se moverán a la raíz de la base de datos.",
        variant: "warning",
        icon: "alert",
        confirmText: "Quitar carpeta",
        onConfirm: async () => {
          for (const q of inside) await moveQuery(q, null);
          saveEmptyFolders(emptyFolders.filter((f) => f !== item.name));
        },
      });
      return;
    }
    const label =
      item.kind === "tables" ? "la tabla" : item.kind === "queries" ? "la consulta" : item.kind === "functions" ? "la función" : "el procedimiento";
    if (item.kind === "views") return; // views are dropped from SQL; not offered here
    ui().showConfirm({
      title: `Eliminar ${OBJECT_LABELS[item.kind].toLowerCase().replace(/s$/, "")}`,
      message: `¿Eliminar ${label} «${item.name}»${item.kind === "queries" ? "" : ` de ${database}`}?`,
      details: item.kind === "queries" ? undefined : "Esta acción ejecuta DROP en el servidor y no se puede deshacer.",
      variant: "danger",
      icon: "trash",
      confirmText: "Eliminar",
      onConfirm: async () => {
        try {
          if (item.query) await favoritesStorage.removeFavorite(item.query.id);
          else if (item.table) await onDropTable(database, item.name);
          else if (item.routine) {
            await dbService.dropRoutine(database, item.name, item.routine.routine_type);
            await loadSchemaObjects(database);
          }
          // Keep folders clean: forget the dropped object.
          if (groupKind && connectionId && folderOf(groups, database, groupKind, item.name)) {
            await objectGroupsStorage.update(connectionId, (g) => moveObject(g, database, groupKind, item.name, null));
          }
          setSelected(null);
        } catch (e) {
          showError("No se pudo eliminar", e);
        }
      },
    });
  };

  const startRename = (item: Item | null) => {
    if (!item || !(item.isFolder || item.query)) return; // schema objects are renamed with SQL
    setRenaming(item.key);
    setDraft(item.name);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (renaming || (e.target as HTMLElement).tagName === "INPUT") return;
    const idx = visible.findIndex((i) => i.key === selected);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = visible[Math.max(0, Math.min(visible.length - 1, idx + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) setSelected(next.key);
    } else if (e.key === "Enter") openItem(selectedItem);
    else if (e.key === "Delete") deleteItem(selectedItem);
    else if (e.key === "F2") startRename(selectedItem);
    else if (e.key === "Backspace" && folder !== null) setFolder(null);
  };

  const setMode = (mode: ViewMode) => {
    setViewMode(mode);
    try {
      const all = readJson<Record<string, string>>(VIEW_MODE_KEY, {});
      all[kind] = mode;
      localStorage.setItem(VIEW_MODE_KEY, JSON.stringify(all));
    } catch {
      /* ignore */
    }
  };

  // ─── Drag & drop (queries → folder / root) ────────────────────────────────
  const DRAG = "application/x-pyro-object";
  const dragProps = (item: Item) =>
    supportsFolders && !item.isFolder
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.setData(DRAG, item.key);
            e.dataTransfer.effectAllowed = "move";
          },
        }
      : {};
  const dropProps = (key: string, target: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG)) return;
      e.preventDefault();
      setDropKey(key);
    },
    onDragLeave: () => setDropKey((k) => (k === key ? null : k)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDropKey(null);
      const dragged = allItems.find((x) => x.key === e.dataTransfer.getData(DRAG));
      if (dragged) void moveToFolder(dragged, target);
    },
  });

  const nameCell = (item: Item, big = false) =>
    renaming === item.key ? (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onBlur={() => void commitRename(item)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commitRename(item);
          if (e.key === "Escape") setRenaming(null);
        }}
        className="w-full min-w-0 px-1 py-0.5 text-xs bg-surface border border-accent rounded text-fg focus:outline-none"
      />
    ) : (
      <span className={`truncate ${big ? "text-center w-full" : ""}`} title={item.query?.description || item.name}>
        {item.name}
      </span>
    );

  const canDelete = !!selectedItem && (selectedItem.isFolder || selectedItem.kind !== "views");
  const canRename = !!selectedItem && (selectedItem.isFolder || !!selectedItem.query);

  return (
    <div ref={containerRef} className="flex-1 flex flex-col min-h-0 bg-canvas outline-none" tabIndex={0} onKeyDown={onKeyDown}>
      {/* Toolbar */}
      <div className="px-3 py-1.5 border-b border-line bg-surface flex flex-wrap items-center gap-1 text-xs">
        <button className={ghostBtn} disabled={!selectedItem} onClick={() => openItem(selectedItem)} title="Abrir (Enter / doble clic)">
          <SquarePen className="w-3.5 h-3.5" />
          Abrir
        </button>
        {kind !== "views" && (
          <button className={ghostBtn} onClick={createNew}>
            <Plus className="w-3.5 h-3.5" />
            {isQueries ? "Nueva consulta" : kind === "tables" ? "Nueva tabla" : kind === "functions" ? "Nueva función" : "Nuevo procedimiento"}
          </button>
        )}
        {supportsFolders && folder === null && (
          <button className={ghostBtn} onClick={() => void createFolder()} title="Las carpetas solo organizan la vista; no modifican la base de datos">
            <FolderPlus className="w-3.5 h-3.5" />
            Nueva carpeta
          </button>
        )}
        {(isQueries || supportsFolders) && (
          <button className={ghostBtn} disabled={!canRename} onClick={() => startRename(selectedItem)} title="Renombrar (F2)">
            <Pencil className="w-3.5 h-3.5" />
            Renombrar
          </button>
        )}
        {(kind !== "views" || supportsFolders) && (
          <button
            className={`${ghostBtn} hover:text-danger`}
            disabled={!canDelete}
            onClick={() => deleteItem(selectedItem)}
            title="Eliminar (Supr)"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Eliminar
          </button>
        )}
        {supportsFolders && folder !== null && selectedItem && !selectedItem.isFolder && (
          <button className={ghostBtn} onClick={() => void moveToFolder(selectedItem, null)} title="Sacar de la carpeta">
            Sacar de «{folder}»
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar…"
              className="pl-7 pr-2 py-1 w-44 rounded bg-canvas border border-line text-fg placeholder:text-fg-muted focus:outline-none focus:border-accent"
            />
          </div>
          {!isQueries && (
            <button className={iconBtn} title="Refrescar" onClick={() => void loadSchemaObjects(database)}>
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
          <button className={`${iconBtn} ${viewMode === "list" ? "text-fg bg-hover" : ""}`} title="Detalles" onClick={() => setMode("list")}>
            <List className="w-3.5 h-3.5" />
          </button>
          <button className={`${iconBtn} ${viewMode === "compact" ? "text-fg bg-hover" : ""}`} title="Lista (solo nombres, por columnas)" onClick={() => setMode("compact")}>
            <Columns3 className="w-3.5 h-3.5" />
          </button>
          <button className={`${iconBtn} ${viewMode === "icons" ? "text-fg bg-hover" : ""}`} title="Iconos" onClick={() => setMode("icons")}>
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="px-3 py-1 flex items-center gap-1 text-[11px] text-fg-muted border-b border-line bg-surface">
        <ObjectIcon kind="database" open className="w-3 h-3" />
        <span>{database}</span>
        <ChevronRight className="w-3 h-3" />
        <button
          className={`flex items-center gap-1 rounded px-1 ${dropKey === "__root__" ? "bg-hover text-fg" : "hover:text-fg"}`}
          onClick={() => setFolder(null)}
          {...(supportsFolders && folder !== null ? dropProps("__root__", null) : {})}
        >
          <ObjectIcon kind={kind} className="w-3 h-3" />
          {OBJECT_LABELS[kind]}
        </button>
        {folder !== null && (
          <>
            <ChevronRight className="w-3 h-3" />
            <ObjectIcon kind="folder" open className="w-3 h-3" />
            <span className="text-fg">{folder}</span>
          </>
        )}
        <span className="ml-auto">{visible.length} elemento(s)</span>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto" onClick={() => setSelected(null)}>
        {(kind === "queries" ? !connectionId : !tables) ? (
          <div className="p-6 text-xs text-fg-muted">
            {kind === "queries" ? "Conéctese con una conexión guardada para ver sus consultas." : "Cargando…"}
          </div>
        ) : visible.length === 0 ? (
          <div className="p-6 text-xs text-fg-muted">
            {search
              ? "Sin coincidencias."
              : isQueries
              ? folder
                ? "Carpeta vacía. Arrastre elementos aquí desde la raíz."
                : "Sin consultas guardadas en esta base de datos. Cree una o use Ctrl+S en el editor."
              : `Sin ${OBJECT_LABELS[kind].toLowerCase()} en ${database}.`}
          </div>
        ) : viewMode === "list" ? (
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-surface z-10">
              <tr className="text-fg-muted text-[11px] border-b border-line">
                {[{ id: "name", label: "Nombre" } as Column, ...columns].map((c) => (
                  <th
                    key={c.id}
                    onClick={() => setSort((s) => ({ col: c.id, dir: s.col === c.id ? (-s.dir as 1 | -1) : 1 }))}
                    className={`py-1.5 px-3 font-medium cursor-pointer select-none hover:text-fg whitespace-nowrap ${
                      c.align === "right" ? "text-right" : "text-left"
                    } ${c.width ?? ""}`}
                  >
                    {c.label}
                    {sort.col === c.id && <span className="ml-1">{sort.dir === 1 ? "▲" : "▼"}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => {
                const isSel = selected === item.key;
                return (
                  <tr
                    key={item.key}
                    {...dragProps(item)}
                    {...(item.isFolder ? dropProps(item.key, item.name) : {})}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelected(item.key);
                      containerRef.current?.focus();
                    }}
                    onDoubleClick={() => openItem(item)}
                    className={`cursor-default ${
                      isSel ? "bg-accent/15 text-fg" : dropKey === item.key ? "bg-hover" : "hover:bg-hover"
                    }`}
                  >
                    <td className="py-1 px-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <ObjectIcon kind={item.kind} />
                        {nameCell(item)}
                      </div>
                    </td>
                    {columns.map((c) => (
                      <td
                        key={c.id}
                        className={`py-1 px-3 text-fg-muted whitespace-nowrap truncate max-w-xs ${
                          c.align === "right" ? "text-right font-mono" : ""
                        }`}
                      >
                        {item.isFolder ? "" : c.format ? c.format(item.cells[c.id]) : item.cells[c.id] ?? ""}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : viewMode === "compact" ? (
          <div className="p-2 text-xs" style={{ columnWidth: "15rem", columnGap: "0.75rem" }}>
            {visible.map((item) => {
              const isSel = selected === item.key;
              return (
                <div
                  key={item.key}
                  {...dragProps(item)}
                  {...(item.isFolder ? dropProps(item.key, item.name) : {})}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected(item.key);
                    containerRef.current?.focus();
                  }}
                  onDoubleClick={() => openItem(item)}
                  className={`flex items-center gap-2 min-w-0 px-2 py-1 rounded break-inside-avoid cursor-default ${
                    isSel ? "bg-accent/15 text-fg" : dropKey === item.key ? "bg-hover" : "hover:bg-hover text-fg"
                  }`}
                >
                  <ObjectIcon kind={item.kind} className="w-3.5 h-3.5 shrink-0" />
                  <div className="flex-1 min-w-0 flex">{nameCell(item)}</div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-3 grid gap-1" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))" }}>
            {visible.map((item) => {
              const isSel = selected === item.key;
              return (
                <div
                  key={item.key}
                  {...dragProps(item)}
                  {...(item.isFolder ? dropProps(item.key, item.name) : {})}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected(item.key);
                    containerRef.current?.focus();
                  }}
                  onDoubleClick={() => openItem(item)}
                  className={`flex flex-col items-center gap-1.5 p-2 rounded-md text-xs cursor-default ${
                    isSel ? "bg-accent/15 text-fg" : dropKey === item.key ? "bg-hover" : "hover:bg-hover text-fg"
                  }`}
                >
                  <ObjectIcon kind={item.kind} className="w-8 h-8" />
                  <div className="w-full min-w-0 flex justify-center">{nameCell(item, true)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ObjectBrowserTab;
