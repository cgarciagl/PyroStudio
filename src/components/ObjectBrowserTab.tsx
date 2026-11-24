import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronRight,
  Columns3,
  Copy,
  FolderInput,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  SquarePen,
  Trash2,
} from "lucide-react";
import type { RoutineMetadata, SqlFavorite, TableMetadata } from "../types/database";
import { useSchemaStore } from "../stores/schemaStore";
import { useUIStore } from "../stores/uiStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { FAVORITES_CHANGED_EVENT, favoritesStorage } from "../services/favoritesStorage";
import { dbService } from "../services/tauriDb";
import { ObjectIcon, OBJECT_LABELS, type DbObjectKind } from "./objectIcons";
import { openSavedQuery, savedQueryTabId } from "./SavedQueriesFolder";
import { ghostBtn, iconBtn, menuIcon, menuItem, menuPanel, menuSeparator } from "./ui/styles";
import { objectBrowserTabId, setObjectBrowserSelection, type BrowsableKind } from "./objectBrowser";
import { TableContextMenu, type TableMenuActions } from "./TableContextMenu";
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
import { uid } from "../utils/uid";


interface ObjectBrowserTabProps {
  database: string;
  kind: BrowsableKind;
  connectionId?: string;
  onOpenTable: (db: string, table: TableMetadata) => void;
  onCreateTable: (db: string) => void;
  onDropTable: (db: string, table: string) => Promise<void> | void;
  onOpenRoutine: (db: string, name: string, type: "PROCEDURE" | "FUNCTION") => void;
  onCreateRoutine: (db: string, type: "PROCEDURE" | "FUNCTION") => void;
  /** Extra actions of the table context menu (same menu as the explorer's). */
  tableMenu?: Omit<TableMenuActions, "onOpen" | "onDrop">;
}

/** One row of the browser, whatever the object kind. */
interface Item {
  key: string;
  name: string;
  kind: DbObjectKind;
  isFolder?: boolean;
  folder?: string | null;
  folderCount?: number;
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
const formatNumber = (v: string | number | null | undefined) => (v == null || v === "" ? "—" : Number(v).toLocaleString());
const formatDate = (v: string | number | undefined) => {
  if (v === undefined || v === "") return "—";
  const d = typeof v === "number" ? new Date(v) : new Date(String(v).replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
};

const COLUMNS: Record<BrowsableKind, Column[]> = {
  tables: [
    { id: "rows", label: "objectBrowser.cols.rows", align: "right", width: "w-28", format: formatNumber },
    { id: "size", label: "objectBrowser.cols.size", align: "right", width: "w-24", format: formatBytes },
    { id: "engine", label: "objectBrowser.cols.engine", width: "w-24" },
    { id: "comment", label: "objectBrowser.cols.comment", width: "w-64" },
  ],
  views: [{ id: "comment", label: "objectBrowser.cols.comment", width: "w-64" }],
  functions: [
    { id: "returns", label: "objectBrowser.cols.returns", width: "w-32" },
    { id: "modified", label: "objectBrowser.cols.modified", width: "w-40", format: formatDate },
    { id: "definer", label: "objectBrowser.cols.definer", width: "w-48" },
  ],
  procedures: [
    { id: "modified", label: "objectBrowser.cols.modifiedMasc", width: "w-40", format: formatDate },
    { id: "definer", label: "objectBrowser.cols.definer", width: "w-48" },
  ],
  queries: [
    { id: "modified", label: "objectBrowser.cols.modified", width: "w-40", format: formatDate },
    { id: "size", label: "objectBrowser.cols.size", align: "right", width: "w-24", format: formatBytes },
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
  tableMenu,
}) => {
  const { t } = useTranslation("objects");
  const tables = useSchemaStore((s) => s.tables[database]);
  const routines = useSchemaStore((s) => s.routines[database]);
  const loadSchemaObjects = useSchemaStore((s) => s.loadSchemaObjects);
  const workspaceVersion = useWorkspaceStore((s) => s.version);
  const [favVersion, setFavVersion] = useState(0);
  const [search, setSearch] = useState("");
  const [folder, setFolder] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [lastSelectedKey, setLastSelectedKey] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 }>({ col: "name", dir: 1 });
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [isDraggingItem, setIsDraggingItem] = useState(false);
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; item: Item } | null>(null);
  // "list" = details table, "compact" = names only flowing in columns, "icons" = large icons
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => readJson<Record<string, ViewMode>>(VIEW_MODE_KEY, {})[kind] ?? "list",
  );
  const emptyFoldersKey = `${connectionId}|${database}`;
  const [emptyFolders, setEmptyFolders] = useState<string[]>(
    () => readJson<Record<string, string[]>>(EMPTY_FOLDERS_KEY, {})[emptyFoldersKey] ?? [],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const moveMenuRef = useRef<HTMLDivElement>(null);
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
          cells: { modified: q.updatedAt, size: new Blob([q.sql]).size, folder: q.folder || "—" },
        }));
    }
  }, [kind, tables, routines, queries, groups, database]);

  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of allItems) {
      if (item.folder) counts.set(item.folder, (counts.get(item.folder) ?? 0) + 1);
    }
    return counts;
  }, [allItems]);

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
        ? folderNames.map((f) => {
            const count = folderCounts.get(f) ?? 0;
            return {
              key: `folder:${f}`,
              name: f,
              kind: "folder" as const,
              isFolder: true,
              folderCount: count,
              cells: { modified: t("objectBrowser.elementCount", { count }) },
            };
          })
        : [];
    return [...folderItems, ...allItems.filter((i) => i.folder === folder)];
  }, [allItems, folderNames, folderCounts, folder, search, supportsFolders]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? items.filter(
          (i) =>
            i.isFolder ||
            i.name.toLowerCase().includes(term) ||
            (i.query &&
              (i.query.sql.toLowerCase().includes(term) ||
                (i.query.description ?? "").toLowerCase().includes(term))),
        )
      : items;
    const matchPriority = (i: Item): number => {
      if (!term) return 0;
      if (i.name.toLowerCase().includes(term)) return 0;
      if ((i.query?.description ?? "").toLowerCase().includes(term)) return 1;
      return 2; // SQL content only match -> last
    };
    const val = (i: Item) => (sort.col === "name" ? i.name.toLowerCase() : i.cells[sort.col] ?? "");
    return [...filtered].sort((a, b) => {
      if (!!a.isFolder !== !!b.isFolder) return a.isFolder ? -1 : 1;
      if (term) {
        const pa = matchPriority(a);
        const pb = matchPriority(b);
        if (pa !== pb) return pa - pb;
      }
      const va = val(a);
      const vb = val(b);
      const cmp =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" });
      return cmp * sort.dir;
    });
  }, [items, search, sort]);

  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const selectedItems = useMemo(() => visible.filter((i) => selectedSet.has(i.key)), [visible, selectedSet]);
  const selectedItem = selectedItems.length === 1 ? selectedItems[0] : null;
  const selectedNonFolders = useMemo(() => selectedItems.filter((i) => !i.isFolder), [selectedItems]);

  const setSingleSelection = (key: string | null) => {
    setSelectedKeys(key ? [key] : []);
    setLastSelectedKey(key);
  };

  const handleRowSelect = (item: Item, e: React.MouseEvent) => {
    e.stopPropagation();
    setMenu(null);
    setMoveMenuOpen(false);
    if (e.ctrlKey || e.metaKey) {
      setSelectedKeys((prev) => (prev.includes(item.key) ? prev.filter((k) => k !== item.key) : [...prev, item.key]));
      setLastSelectedKey(item.key);
    } else if (e.shiftKey && lastSelectedKey) {
      const a = visible.findIndex((i) => i.key === lastSelectedKey);
      const b = visible.findIndex((i) => i.key === item.key);
      if (a !== -1 && b !== -1) {
        const [start, end] = a < b ? [a, b] : [b, a];
        setSelectedKeys(visible.slice(start, end + 1).map((i) => i.key));
      } else {
        setSingleSelection(item.key);
      }
    } else {
      setSingleSelection(item.key);
    }
    containerRef.current?.focus();
  };

  // Close toolbar "Mover a…" dropdown on outside click
  useEffect(() => {
    if (!moveMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (moveMenuRef.current && !moveMenuRef.current.contains(e.target as Node)) {
        setMoveMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [moveMenuOpen]);

  // Close custom context menu on outside click / Escape
  useEffect(() => {
    if (!menu || menu.item.table) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // Lets "Nueva consulta" start from the table selected here.
  const tabId = objectBrowserTabId(database, kind);
  const selectedTableName = selectedItem?.table?.name ?? null;
  useEffect(() => {
    setObjectBrowserSelection(tabId, selectedTableName);
  }, [tabId, selectedTableName]);
  useEffect(() => () => setObjectBrowserSelection(tabId, null), [tabId]);
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
      setSingleSelection(null);
    } else if (item.table) onOpenTable(database, item.table);
    else if (item.routine) onOpenRoutine(database, item.routine.name, item.routine.routine_type);
    else if (item.query) openSavedQuery(item.query, database);
  };

  const createNew = () => {
    if (kind === "tables") onCreateTable(database);
    else if (kind === "functions" || kind === "procedures") onCreateRoutine(database, routineType);
    else if (isQueries) {
      ui().openTab({
        id: `query-${uid()}`,
        title: t("objectBrowser.queryTabTitle", { database }),
        type: "query",
        database,
        queryContent: "",
        pendingFolder: folder ?? undefined,
      });
    }
  };

  const nextAvailableFolderName = () => {
    let name = t("objectBrowser.newFolderDefault");
    const taken = new Set(folderNames);
    for (let n = 2; taken.has(name); n++) name = t("objectBrowser.newFolderNumbered", { n });
    return name;
  };

  const createFolder = async (moveItemsAfter?: Item[]) => {
    const name = nextAvailableFolderName();
    try {
      if (groupKind && connectionId) {
        await objectGroupsStorage.update(connectionId, (g) => createGroupFolder(g, database, groupKind, name));
      } else {
        saveEmptyFolders([...emptyFolders, name]);
      }
      if (moveItemsAfter && moveItemsAfter.length > 0) {
        await moveItemsToFolder(moveItemsAfter, name);
      }
      if (folder === null) {
        setSingleSelection(`folder:${name}`);
        setRenaming(`folder:${name}`);
        setDraft(name);
      }
    } catch (e) {
      showError(t("objectBrowser.createFolderError"), e);
    }
  };

  /** Moves one or more objects (queries or schema objects) into a folder (null = root). */
  const moveItemsToFolder = async (targets: Item[], targetFolder: string | null) => {
    const movable = targets.filter((t) => !t.isFolder && (t.folder ?? null) !== targetFolder);
    if (!movable.length) return;
    setMoveMenuOpen(false);
    setMenu(null);
    try {
      for (const item of movable) {
        if (item.query) {
          await favoritesStorage.persistFavorite({ ...item.query, folder: targetFolder ?? undefined });
        } else if (groupKind && connectionId) {
          await objectGroupsStorage.update(connectionId, (g) =>
            moveObject(g, database, groupKind, item.name, targetFolder),
          );
        }
      }
      if (targetFolder && !groupKind) {
        saveEmptyFolders(emptyFolders.filter((f) => f !== targetFolder));
      }
      setSingleSelection(null);
    } catch (e) {
      showError(t("objectBrowser.moveError"), e);
    }
  };

  const duplicateQuery = async (q: SqlFavorite) => {
    setMenu(null);
    try {
      const copyTitle = t("objectBrowser.copySuffix", { title: q.title });
      await favoritesStorage.persistFavorite({
        id: `fav-${uid()}`,
        title: copyTitle,
        sql: q.sql,
        category: q.category,
        description: q.description,
        connectionId: q.connectionId ?? connectionId,
        database: q.database ?? database,
        folder: q.folder,
      });
    } catch (e) {
      showError(t("objectBrowser.duplicateQueryError"), e);
    }
  };

  const commitRename = async (item: Item) => {
    const name = draft.trim();
    setRenaming(null);
    if (!name || name === item.name) return;
    try {
      if (item.isFolder && groupKind && connectionId) {
        await objectGroupsStorage.update(connectionId, (g) => renameGroupFolder(g, database, groupKind, item.name, name));
        setSingleSelection(`folder:${name}`);
      } else if (item.isFolder) {
        const inside = queries.filter((q) => q.folder === item.name);
        for (const q of inside) await favoritesStorage.persistFavorite({ ...q, folder: name });
        saveEmptyFolders(emptyFolders.map((f) => (f === item.name ? name : f)));
        setSingleSelection(`folder:${name}`);
      } else if (item.query) {
        await favoritesStorage.persistFavorite({ ...item.query, title: name });
        ui().renameTab(savedQueryTabId(item.query.id), name);
      }
    } catch (e) {
      showError(t("objectBrowser.renameError"), e);
    }
  };

  const deleteItems = (targets: Item[]) => {
    if (!targets.length) return;
    if (targets.length === 1) {
      const item = targets[0];
      if (item.isFolder && groupKind && connectionId) {
        const count = getFolders(groups, database, groupKind)[item.name]?.length ?? 0;
        const remove = async () => {
          try {
            await objectGroupsStorage.update(connectionId, (g) => deleteGroupFolder(g, database, groupKind, item.name));
          } catch (e) {
            showError(t("objectBrowser.removeFolderError"), e);
          }
        };
        if (!count) return void remove();
        ui().showConfirm({
          title: t("objectBrowser.removeFolderTitle"),
          message: t("objectBrowser.removeFolderMsg", { name: item.name, count }),
          details: t("objectBrowser.removeFolderDetails"),
          variant: "warning",
          icon: "alert",
          confirmText: t("objectBrowser.removeFolderConfirm"),
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
          title: t("objectBrowser.deleteFolderTitle"),
          message: t("objectBrowser.deleteFolderMsg", { name: item.name, count: inside.length }),
          details: t("objectBrowser.deleteFolderDetails"),
          variant: "warning",
          icon: "alert",
          confirmText: t("objectBrowser.removeFolderConfirm"),
          onConfirm: async () => {
            for (const q of inside) {
              await favoritesStorage.persistFavorite({ ...q, folder: undefined });
            }
            saveEmptyFolders(emptyFolders.filter((f) => f !== item.name));
          },
        });
        return;
      }
    }

    const deletable = targets.filter((t) => !t.isFolder && t.kind !== "views");
    if (!deletable.length) return;

    const single = deletable.length === 1 ? deletable[0] : null;
    const label =
      kind === "tables"
        ? t("objectBrowser.targetLabels.tables")
        : kind === "queries"
        ? t("objectBrowser.targetLabels.queries")
        : kind === "functions"
        ? t("objectBrowser.targetLabels.functions")
        : t("objectBrowser.targetLabels.procedures");
    const dbPart = kind === "queries" ? "" : t("objectBrowser.fromDbPart", { database });

    ui().showConfirm({
      title: single
        ? t("objectBrowser.deleteSingleTitle", { kind: OBJECT_LABELS[single.kind].toLowerCase().replace(/s$/, "") })
        : t("objectBrowser.deleteMultiTitle", { count: deletable.length }),
      message: single
        ? t("objectBrowser.deleteSingleMsg", {
            label,
            name: single.name,
            dbPart: single.kind === "queries" ? "" : t("objectBrowser.fromDbPart", { database }),
          })
        : t("objectBrowser.deleteMultiMsg", { count: deletable.length, dbPart }),
      details: kind === "queries" ? undefined : t("objectBrowser.dropServerDetails"),
      variant: "danger",
      icon: "trash",
      confirmText: t("objectBrowser.deleteConfirm"),
      onConfirm: async () => {
        try {
          for (const item of deletable) {
            if (item.query) await favoritesStorage.removeFavorite(item.query.id);
            else if (item.table) await onDropTable(database, item.name);
            else if (item.routine) {
              await dbService.dropRoutine(database, item.name, item.routine.routine_type);
            }
            if (groupKind && connectionId && folderOf(groups, database, groupKind, item.name)) {
              await objectGroupsStorage.update(connectionId, (g) => moveObject(g, database, groupKind, item.name, null));
            }
          }
          if (kind === "functions" || kind === "procedures") {
            await loadSchemaObjects(database);
          }
          setSingleSelection(null);
        } catch (e) {
          showError(t("objectBrowser.deleteError"), e);
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
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      const nonFolderKeys = visible.filter((i) => !i.isFolder).map((i) => i.key);
      setSelectedKeys(nonFolderKeys.length ? nonFolderKeys : visible.map((i) => i.key));
      return;
    }
    const anchorKey = selectedKeys[selectedKeys.length - 1] ?? null;
    const idx = visible.findIndex((i) => i.key === anchorKey);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = visible[Math.max(0, Math.min(visible.length - 1, idx + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) setSingleSelection(next.key);
    } else if (e.key === "Enter") openItem(selectedItem);
    else if (e.key === "Delete") deleteItems(selectedItems);
    else if (e.key === "F2") startRename(selectedItem);
    else if (e.key === "Backspace" && folder !== null) {
      setFolder(null);
      setSingleSelection(null);
    }
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

  // ─── Drag & drop (queries / objects → folder / root) ──────────────────────
  const DRAG = "application/x-pyro-object";
  const dragProps = (item: Item) =>
    supportsFolders && !item.isFolder
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            const keysToDrag =
              selectedSet.has(item.key) && selectedNonFolders.length > 1
                ? selectedNonFolders.map((i) => i.key)
                : [item.key];
            e.dataTransfer.setData(DRAG, JSON.stringify(keysToDrag));
            e.dataTransfer.effectAllowed = "move";
            setIsDraggingItem(true);
          },
          onDragEnd: () => {
            setIsDraggingItem(false);
            setDropKey(null);
          },
        }
      : {};
  const dropProps = (key: string, target: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDropKey(key);
    },
    onDragLeave: () => setDropKey((k) => (k === key ? null : k)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDropKey(null);
      setIsDraggingItem(false);
      const raw = e.dataTransfer.getData(DRAG);
      let keys: string[] = [];
      try {
        const parsed = JSON.parse(raw);
        keys = Array.isArray(parsed) ? parsed : [raw];
      } catch {
        if (raw) keys = [raw];
      }
      const draggedItems = allItems.filter((x) => keys.includes(x.key));
      if (draggedItems.length > 0) void moveItemsToFolder(draggedItems, target);
    },
  });

  const openMenu = (e: React.MouseEvent, item: Item) => {
    if (!item.table && !item.query && !item.isFolder) return;
    e.preventDefault();
    e.stopPropagation();
    if (!selectedSet.has(item.key)) {
      setSingleSelection(item.key);
    }
    setMoveMenuOpen(false);
    setMenu({ x: e.clientX, y: e.clientY, item });
  };

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

  const canDelete =
    selectedItems.length > 0 &&
    selectedItems.some((i) => i.isFolder || i.kind !== "views");
  const canRename = !!selectedItem && (selectedItem.isFolder || !!selectedItem.query);
  const canMove = supportsFolders && selectedNonFolders.length > 0;
  const availableTargetFolders = folderNames.filter((f) => f !== folder);

  const activeColumns: Column[] = useMemo(() => {
    if (isQueries && search.trim()) {
      return [{ id: "folder", label: "objectBrowser.cols.folder", width: "w-40" }, ...columns];
    }
    return columns;
  }, [isQueries, search, columns]);

  return (
    <div ref={containerRef} className="pyro-view pyro-object-browser flex-1 flex flex-col min-h-0 bg-canvas outline-none" data-object-browser-view={kind} tabIndex={0} onKeyDown={onKeyDown}>
      {/* Toolbar */}
      <div className="px-3 py-1.5 border-b border-line bg-surface flex flex-wrap items-center gap-1 text-xs" data-object-browser-toolbar data-view-toolbar>
        <button className={ghostBtn} disabled={!selectedItem} onClick={() => openItem(selectedItem)} title={t("objectBrowser.openTitle")}>
          <SquarePen className="w-3.5 h-3.5" />
          {t("objectBrowser.openBtn")}
        </button>
        {kind !== "views" && (
          <button className={ghostBtn} onClick={createNew}>
            <Plus className="w-3.5 h-3.5" />
            {isQueries
              ? t("objectBrowser.newQuery")
              : kind === "tables"
              ? t("objectBrowser.newTable")
              : kind === "functions"
              ? t("objectBrowser.newFunction")
              : t("objectBrowser.newProcedure")}
          </button>
        )}
        {supportsFolders && folder === null && (
          <button className={ghostBtn} onClick={() => void createFolder()} title={t("objectBrowser.newFolderTitle")}>
            <FolderPlus className="w-3.5 h-3.5" />
            {t("objectBrowser.newFolderBtn")}
          </button>
        )}
        {canMove && (
          <div ref={moveMenuRef} className="relative">
            <button
              className={ghostBtn}
              onClick={() => setMoveMenuOpen((o) => !o)}
              title={t("objectBrowser.moveToTitle")}
            >
              <FolderInput className="w-3.5 h-3.5" />
              <span>{t("objectBrowser.moveToBtn")}{selectedNonFolders.length > 1 ? ` (${selectedNonFolders.length})` : ""}</span>
            </button>
            {moveMenuOpen && (
              <div className={`${menuPanel} left-0 right-auto min-w-[210px] max-h-72 overflow-y-auto`}>
                {folder !== null && (
                  <button
                    type="button"
                    className={menuItem}
                    onClick={() => void moveItemsToFolder(selectedNonFolders, null)}
                  >
                    <FolderOpen className={menuIcon} />
                    <span>{t("objectBrowser.rootLabel", { kind: OBJECT_LABELS[kind] })}</span>
                  </button>
                )}
                {availableTargetFolders.length > 0 && folder !== null && <div className={menuSeparator} />}
                {availableTargetFolders.map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={menuItem}
                    onClick={() => void moveItemsToFolder(selectedNonFolders, f)}
                  >
                    <ObjectIcon kind="folder" className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{f}</span>
                  </button>
                ))}
                {(availableTargetFolders.length > 0 || folder !== null) && <div className={menuSeparator} />}
                <button
                  type="button"
                  className={menuItem}
                  onClick={() => {
                    setMoveMenuOpen(false);
                    void createFolder(selectedNonFolders);
                  }}
                >
                  <FolderPlus className={menuIcon} />
                  <span>{t("objectBrowser.newFolderEllipsis")}</span>
                </button>
              </div>
            )}
          </div>
        )}
        {isQueries && selectedItem?.query && (
          <button
            className={ghostBtn}
            onClick={() => void duplicateQuery(selectedItem.query!)}
            title={t("objectBrowser.duplicateTitle")}
          >
            <Copy className="w-3.5 h-3.5" />
            {t("objectBrowser.duplicateBtn")}
          </button>
        )}
        {(isQueries || supportsFolders) && (
          <button className={ghostBtn} disabled={!canRename} onClick={() => startRename(selectedItem)} title={t("objectBrowser.renameTitle")}>
            <Pencil className="w-3.5 h-3.5" />
            {t("objectBrowser.renameBtn")}
          </button>
        )}
        {(kind !== "views" || supportsFolders) && (
          <button
            className={`${ghostBtn} hover:text-danger`}
            disabled={!canDelete}
            onClick={() => deleteItems(selectedItems)}
            title={t("objectBrowser.deleteTitle")}
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t("objectBrowser.deleteConfirm")}{selectedItems.length > 1 ? ` (${selectedItems.length})` : ""}
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("objectBrowser.searchPlaceholder")}
              className="pl-7 pr-2 py-1 w-44 rounded bg-canvas border border-line text-fg placeholder:text-fg-muted focus:outline-none focus:border-accent"
            />
          </div>
          {!isQueries && (
            <button className={iconBtn} title={t("objectBrowser.refreshTitle")} onClick={() => void loadSchemaObjects(database)}>
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
          <button className={`${iconBtn} ${viewMode === "list" ? "text-fg bg-hover" : ""}`} title={t("objectBrowser.viewDetailsTitle")} onClick={() => setMode("list")}>
            <List className="w-3.5 h-3.5" />
          </button>
          <button className={`${iconBtn} ${viewMode === "compact" ? "text-fg bg-hover" : ""}`} title={t("objectBrowser.viewCompactTitle")} onClick={() => setMode("compact")}>
            <Columns3 className="w-3.5 h-3.5" />
          </button>
          <button className={`${iconBtn} ${viewMode === "icons" ? "text-fg bg-hover" : ""}`} title={t("objectBrowser.viewIconsTitle")} onClick={() => setMode("icons")}>
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="px-3 py-1 flex items-center gap-1 text-[11px] text-fg-muted border-b border-line bg-surface" data-object-browser-breadcrumb>
        <ObjectIcon kind="database" open className="w-3 h-3" />
        <span>{database}</span>
        <ChevronRight className="w-3 h-3" />
        <button
          className={`flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors ${
            dropKey === "__root__"
              ? "bg-accent-soft text-fg ring-1 ring-accent/50"
              : isDraggingItem && folder !== null
              ? "bg-hover text-fg ring-1 ring-dashed ring-line"
              : "hover:text-fg"
          }`}
          onClick={() => {
            setFolder(null);
            setSingleSelection(null);
          }}
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
        <span className="ml-auto">
          {selectedItems.length > 1 ? t("objectBrowser.selectedCount", { count: selectedItems.length }) : ""}
          {t("objectBrowser.elementsTotal", { count: visible.length })}
        </span>
      </div>

      {/* Content */}
      <div
        className="flex-1 min-h-0 overflow-auto"
        data-object-browser-content
        data-view-content
        onClick={() => {
          setSingleSelection(null);
          setMenu(null);
          setMoveMenuOpen(false);
        }}
      >
        {(kind === "queries" ? !connectionId : !tables) ? (
          <div className="p-6 text-xs text-fg-muted">
            {kind === "queries" ? t("objectBrowser.connectSavedForQueries") : t("objectBrowser.loading")}
          </div>
        ) : visible.length === 0 ? (
          <div className="p-6 text-xs text-fg-muted">
            {search
              ? t("objectBrowser.noMatches")
              : isQueries
              ? folder
                ? t("objectBrowser.emptyFolderHint")
                : t("objectBrowser.noSavedQueries")
              : t("objectBrowser.emptyKind", { kind: OBJECT_LABELS[kind].toLowerCase(), database })}
          </div>
        ) : viewMode === "list" ? (
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-surface z-10">
              <tr className="text-fg-muted text-[11px] border-b border-line">
                {[{ id: "name", label: "objectBrowser.cols.name" } as Column, ...activeColumns].map((c) => (
                  <th
                    key={c.id}
                    onClick={() => setSort((s) => ({ col: c.id, dir: s.col === c.id ? (-s.dir as 1 | -1) : 1 }))}
                    className={`py-1.5 px-3 font-medium cursor-pointer select-none hover:text-fg whitespace-nowrap ${
                      c.align === "right" ? "text-right" : "text-left"
                    } ${c.width ?? ""}`}
                  >
                    {t(c.label, { defaultValue: c.label })}
                    {sort.col === c.id && <span className="ml-1">{sort.dir === 1 ? "▲" : "▼"}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => {
                const isSel = selectedSet.has(item.key);
                const isDropTarget = dropKey === item.key;
                return (
                  <tr
                    key={item.key}
                    {...dragProps(item)}
                    {...(item.isFolder ? dropProps(item.key, item.name) : {})}
                    onClick={(e) => handleRowSelect(item, e)}
                    onDoubleClick={() => openItem(item)}
                    onContextMenu={(e) => openMenu(e, item)}
                    className={`cursor-default transition-colors ${
                      isDropTarget
                        ? "bg-accent-soft text-fg ring-1 ring-inset ring-accent/50"
                        : isSel
                        ? "bg-accent-soft text-fg"
                        : "hover:bg-hover"
                    }`}
                  >
                    <td className="py-1 px-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <ObjectIcon kind={item.kind} />
                        {nameCell(item)}
                      </div>
                    </td>
                    {activeColumns.map((c) => (
                      <td
                        key={c.id}
                        className={`py-1 px-3 text-fg-muted whitespace-nowrap truncate max-w-xs ${
                          c.align === "right" ? "text-right font-mono" : ""
                        }`}
                      >
                        {item.isFolder
                          ? c.id === "modified"
                            ? item.cells.modified
                            : ""
                          : c.format
                          ? c.format(item.cells[c.id])
                          : item.cells[c.id] ?? ""}
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
              const isSel = selectedSet.has(item.key);
              const isDropTarget = dropKey === item.key;
              return (
                <div
                  key={item.key}
                  {...dragProps(item)}
                  {...(item.isFolder ? dropProps(item.key, item.name) : {})}
                  onClick={(e) => handleRowSelect(item, e)}
                  onDoubleClick={() => openItem(item)}
                  onContextMenu={(e) => openMenu(e, item)}
                  className={`flex items-center gap-2 min-w-0 px-2 py-1 rounded break-inside-avoid cursor-default transition-colors ${
                    isDropTarget
                      ? "bg-accent-soft text-fg ring-1 ring-inset ring-accent/50"
                      : isSel
                      ? "bg-accent-soft text-fg"
                      : "hover:bg-hover text-fg"
                  }`}
                >
                  <ObjectIcon kind={item.kind} className="w-3.5 h-3.5 shrink-0" />
                  <div className="flex-1 min-w-0 flex">{nameCell(item)}</div>
                  {item.isFolder && typeof item.folderCount === "number" && (
                    <span className="text-[11px] text-fg-muted font-mono shrink-0">{item.folderCount}</span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-3 grid gap-1" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))" }}>
            {visible.map((item) => {
              const isSel = selectedSet.has(item.key);
              const isDropTarget = dropKey === item.key;
              return (
                <div
                  key={item.key}
                  {...dragProps(item)}
                  {...(item.isFolder ? dropProps(item.key, item.name) : {})}
                  onClick={(e) => handleRowSelect(item, e)}
                  onDoubleClick={() => openItem(item)}
                  onContextMenu={(e) => openMenu(e, item)}
                  className={`flex flex-col items-center gap-1.5 p-2 rounded-md text-xs cursor-default transition-colors ${
                    isDropTarget
                      ? "bg-accent-soft text-fg ring-1 ring-inset ring-accent/50"
                      : isSel
                      ? "bg-accent-soft text-fg"
                      : "hover:bg-hover text-fg"
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

      {isQueries && selectedItem?.query && (
        <div
          className="border-t border-line bg-surface px-3 py-2 shrink-0 flex flex-col gap-1.5"
          data-query-preview
        >
          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <ObjectIcon kind="queries" className="w-3.5 h-3.5 shrink-0" />
              <span className="font-medium text-fg truncate">{selectedItem.query.title}</span>
              {selectedItem.query.folder && (
                <span className="text-[11px] text-fg-muted truncate">· {selectedItem.query.folder}</span>
              )}
              {selectedItem.query.description && (
                <span className="text-[11px] text-fg-muted truncate">— {selectedItem.query.description}</span>
              )}
            </div>
            <button
              type="button"
              className={ghostBtn}
              onClick={() => openItem(selectedItem)}
            >
              <SquarePen className="w-3.5 h-3.5" />
              <span>{t("objectBrowser.openBtn")}</span>
            </button>
          </div>
          <pre className="max-h-28 overflow-auto rounded border border-line bg-canvas px-2.5 py-2 text-[11px] font-mono text-fg-muted whitespace-pre-wrap break-words leading-relaxed">
            {selectedItem.query.sql.trim() || t("objectBrowser.emptyQuerySql")}
          </pre>
        </div>
      )}

      {menu?.item.table && (
        <TableContextMenu
          x={menu.x}
          y={menu.y}
          dbName={database}
          tableName={menu.item.name}
          isView={menu.item.table.table_type === "VIEW"}
          onClose={() => setMenu(null)}
          {...tableMenu}
          onOpen={() => openItem(menu.item)}
          onDrop={() => deleteItems([menu.item])}
        />
      )}

      {menu && !menu.item.table && (
        <div
          style={{ left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - 300) }}
          className="fixed z-50 min-w-[210px] max-h-80 overflow-y-auto rounded-lg border border-line bg-raised shadow-pop py-1 text-xs"
          onClick={(e) => e.stopPropagation()}
        >
          {menu.item.isFolder ? (
            <>
              <button type="button" className={menuItem} onClick={() => { openItem(menu.item); setMenu(null); }}>
                <FolderOpen className={menuIcon} />
                <span>{t("objectBrowser.openFolder")}</span>
              </button>
              <button type="button" className={menuItem} onClick={() => { startRename(menu.item); setMenu(null); }}>
                <Pencil className={menuIcon} />
                <span>{t("objectBrowser.renameBtn")}</span>
              </button>
              <div className={menuSeparator} />
              <button
                type="button"
                className={`${menuItem} text-danger`}
                onClick={() => {
                  const target = menu.item;
                  setMenu(null);
                  deleteItems([target]);
                }}
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                <span>{t("objectBrowser.deleteFolder")}</span>
              </button>
            </>
          ) : menu.item.query ? (
            <>
              {selectedNonFolders.length <= 1 && (
                <>
                  <button type="button" className={menuItem} onClick={() => { openItem(menu.item); setMenu(null); }}>
                    <SquarePen className={menuIcon} />
                    <span>{t("objectBrowser.openQuery")}</span>
                  </button>
                  <button type="button" className={menuItem} onClick={() => void duplicateQuery(menu.item.query!)}>
                    <Copy className={menuIcon} />
                    <span>{t("objectBrowser.duplicateBtn")}</span>
                  </button>
                  <button type="button" className={menuItem} onClick={() => { startRename(menu.item); setMenu(null); }}>
                    <Pencil className={menuIcon} />
                    <span>{t("objectBrowser.renameBtn")}</span>
                  </button>
                </>
              )}
              {supportsFolders && (
                <>
                  {selectedNonFolders.length <= 1 && <div className={menuSeparator} />}
                  <div className="px-3 py-1 text-[11px] text-fg-muted">
                    {t("objectBrowser.moveToFolderHeader", {
                      countPart: selectedNonFolders.length > 1 ? `(${selectedNonFolders.length}) ` : "",
                    })}
                  </div>
                  {(folder !== null || menu.item.folder) && (
                    <button
                      type="button"
                      className={menuItem}
                      onClick={() =>
                        void moveItemsToFolder(
                          selectedNonFolders.length > 1 ? selectedNonFolders : [menu.item],
                          null,
                        )
                      }
                    >
                      <FolderOpen className={menuIcon} />
                      <span>{t("objectBrowser.rootLabel", { kind: OBJECT_LABELS[kind] })}</span>
                    </button>
                  )}
                  {folderNames
                    .filter((f) => f !== (menu.item.folder ?? folder))
                    .map((f) => (
                      <button
                        key={f}
                        type="button"
                        className={menuItem}
                        onClick={() =>
                          void moveItemsToFolder(
                            selectedNonFolders.length > 1 ? selectedNonFolders : [menu.item],
                            f,
                          )
                        }
                      >
                        <ObjectIcon kind="folder" className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{f}</span>
                      </button>
                    ))}
                  <button
                    type="button"
                    className={menuItem}
                    onClick={() => {
                      const targets = selectedNonFolders.length > 1 ? selectedNonFolders : [menu.item];
                      setMenu(null);
                      void createFolder(targets);
                    }}
                  >
                    <FolderPlus className={menuIcon} />
                    <span>{t("objectBrowser.newFolderEllipsis")}</span>
                  </button>
                </>
              )}
              <div className={menuSeparator} />
              <button
                type="button"
                className={`${menuItem} text-danger`}
                onClick={() => {
                  const targets = selectedItems.length > 1 ? selectedItems : [menu.item];
                  setMenu(null);
                  deleteItems(targets);
                }}
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                <span>{t("objectBrowser.deleteConfirm")}{selectedItems.length > 1 ? ` (${selectedItems.length})` : ""}</span>
              </button>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default ObjectBrowserTab;
