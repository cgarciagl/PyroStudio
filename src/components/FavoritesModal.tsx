import React, { useState, useEffect, useMemo, useRef } from "react";
import { Plus, Search, Star, X } from "lucide-react";
import type { SqlFavorite } from "../types/database";
import {
  FavoriteConflictError,
  FAVORITES_CHANGED_EVENT,
  favoritesStorage,
  newFavoriteId,
  type FavoriteInput,
} from "../services/favoritesStorage";
import { useUIStore } from "../stores/uiStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { openSavedQuery } from "./SavedQueriesFolder";
import { ConfirmModal } from "./ConfirmModal";
import { useSqlDialect } from "../services/sqlDialect";
import { EmptyState } from "./ui/Modal";
import { ghostBtn, iconBtn, inputClass, modalBackdrop, modalHeader, modalTitle, selectClass } from "./ui/styles";
import { uid } from "../utils/uid";
import { errorText } from "../utils/errors";
import { FavoritesList, type FavoriteGroup } from "./favorites/FavoritesList";
import { FavoriteDetail } from "./favorites/FavoriteDetail";
import { FavoriteForm, type FavoriteFormValues } from "./favorites/FavoriteForm";
interface FavoritesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectQuery: (sql: string, runImmediately?: boolean) => void;
  initialQueryToSave?: string;
  /** Active connection/database: new queries are saved there by default. */
  defaultConnectionId?: string;
  defaultDatabase?: string;
  /** Folder for new queries (when created from inside a query folder). */
  defaultFolder?: string;
  /** Called after a successful save (e.g. to link the editor tab). */
  onSaved?: (fav: SqlFavorite) => void;
  /** Acoplado al panel derecho del editor en lugar de abrirse como modal. */
  docked?: boolean;
}

export const FavoritesModal: React.FC<FavoritesModalProps> = ({
  isOpen,
  onClose,
  onSelectQuery,
  initialQueryToSave,
  defaultConnectionId,
  defaultDatabase,
  defaultFolder,
  onSaved,
  docked = false,
}) => {
  const canScope = !!(defaultConnectionId && defaultDatabase);
  const [scope, setScope] = useState<"db" | "all">(canScope ? "db" : "all");
  const [favorites, setFavorites] = useState<SqlFavorite[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("Todos");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [favoriteToDelete, setFavoriteToDelete] = useState<SqlFavorite | null>(null);

  // Create / edit form, shown in the detail pane (the list stays visible).
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formConnectionId, setFormConnectionId] = useState<string | undefined>(undefined);
  const [form, setForm] = useState<FavoriteFormValues>({
    title: "",
    category: "General",
    description: "",
    sql: "",
    linked: false,
    database: "",
  });

  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const refreshList = () => {
    setFavorites(favoritesStorage.getFavorites());
  };

  const workspaceVersion = useWorkspaceStore((s) => s.version);

  useEffect(() => {
    if (isOpen) refreshList();
  }, [workspaceVersion]);

  // Saved/renamed/deleted elsewhere (explorer, Ctrl+S in another tab): keep the list fresh.
  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener(FAVORITES_CHANGED_EVENT, refreshList);
    return () => window.removeEventListener(FAVORITES_CHANGED_EVENT, refreshList);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      refreshList();
      if (initialQueryToSave && initialQueryToSave.trim()) {
        openCreateForm(initialQueryToSave);
      } else {
        // Focus the search box so the user can type right away (not the editor).
        setTimeout(() => searchRef.current?.focus(), 0);
      }
    }
  }, [isOpen, initialQueryToSave]);

  /** Escape closes one layer at a time: form, then search, then the panel. */
  const handleEscape = () => {
    if (isFormOpen) setIsFormOpen(false);
    else if (searchTerm) setSearchTerm("");
    else onClose();
  };

  // Escape with the focus outside the panel (modal just opened). Docked beside the
  // editor, Escape typed in the editor (e.g. to close the autocomplete) is ignored.
  useEffect(() => {
    if (!isOpen || docked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !panelRef.current?.contains(document.activeElement)) handleEscape();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, docked, isFormOpen, searchTerm, onClose]);

  const isThisDb = (f: SqlFavorite) =>
    f.connectionId === defaultConnectionId && f.database === defaultDatabase;

  // Queries written for another engine are hidden (SHOW PROCESSLIST cannot run on SQLite).
  const engine = useSqlDialect().engine;
  const inScope = (f: SqlFavorite) =>
    favoritesStorage.fitsActiveEngine(f, engine) &&
    (!(scope === "db" && canScope) || !f.connectionId || isThisDb(f));

  /** Only categories that have queries in the current scope (empty chips were noise). */
  const categories = useMemo(() => {
    const used = new Set(favorites.filter(inScope).map((f) => f.category));
    return favoritesStorage.getCategories().filter((c) => c === "Todos" || used.has(c));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favorites, scope, canScope, defaultConnectionId, defaultDatabase, engine]);

  /** Every category, for the rename datalist. */
  const allCategories = useMemo(() => favoritesStorage.getCategories(), [favorites]);

  const scopeTotal = useMemo(
    () => favorites.filter(inScope).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [favorites, scope, canScope, defaultConnectionId, defaultDatabase, engine]
  );

  // A category that vanished from the scope would leave the list empty with no chip selected.
  useEffect(() => {
    if (!categories.includes(selectedCategory)) setSelectedCategory("Todos");
  }, [categories, selectedCategory]);

  const filteredFavorites = useMemo(() => {
    // While searching, look in every category: the chip should not hide matches.
    const found = favoritesStorage.searchFavorites(
      searchTerm,
      searchTerm.trim() ? "Todos" : selectedCategory
    );
    // "This database" also includes general queries (not tied to any database, e.g. the
    // built-in diagnostics like SHOW PROCESSLIST); queries of other databases are hidden.
    const scoped = found.filter(inScope);
    // Queries of this database first, then the general ones.
    return [...scoped].sort((a, b) => Number(isThisDb(b)) - Number(isThisDb(a)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favorites, searchTerm, selectedCategory, scope, canScope, defaultConnectionId, defaultDatabase, engine]);


  /**
   * List sections. Browsing (no search, all categories): built-in diagnostics first as
   * "Acceso rápido", then the user's queries by category. Searching or filtering: every
   * match grouped by category.
   */
  const groups = useMemo<FavoriteGroup[]>(() => {
    const browsing = !searchTerm.trim() && selectedCategory === "Todos";
    const quick = browsing ? filteredFavorites.filter((f) => favoritesStorage.isPreset(f.id)) : [];
    const rest = browsing ? filteredFavorites.filter((f) => !favoritesStorage.isPreset(f.id)) : filteredFavorites;
    const byCategory = new Map<string, SqlFavorite[]>();
    for (const f of rest) byCategory.set(f.category, [...(byCategory.get(f.category) ?? []), f]);
    const out: FavoriteGroup[] = [];
    if (quick.length) out.push({ key: "__quick__", label: "Acceso rápido", quick: true, items: quick });
    for (const [cat, items] of byCategory) out.push({ key: cat, label: cat, items });
    return out;
  }, [filteredFavorites, searchTerm, selectedCategory]);

  /** Visual order of the rows, for ↑/↓ and Enter. */
  const ordered = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const selected = ordered.find((f) => f.id === selectedId) ?? ordered[0] ?? null;

  // Keep the selected row visible while moving with the keyboard.
  useEffect(() => {
    if (!selected) return;
    panelRef.current
      ?.querySelector(`[data-favorite-id="${CSS.escape(selected.id)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected?.id]);


  if (!isOpen) return null;

  function openCreateForm(prefilledSql?: string) {
    setEditingId(null);
    setForm({
      title: "",
      category: "General",
      description: "",
      sql: prefilledSql || "",
      linked: canScope,
      database: defaultDatabase || "",
    });
    setFormConnectionId(defaultConnectionId);
    setIsFormOpen(true);
  }

  const openEditForm = (fav: SqlFavorite) => {
    setEditingId(fav.id);
    setForm({
      title: fav.title,
      category: fav.category,
      description: fav.description || "",
      sql: fav.sql,
      linked: !!fav.connectionId,
      database: fav.database || defaultDatabase || "",
    });
    setFormConnectionId(fav.connectionId || defaultConnectionId);
    setIsFormOpen(true);
  };

  const showStorageError = (title: string, e: unknown) => {
    useUIStore.getState().showAlert({
      title,
      message: errorText(e),
      variant: "danger",
      icon: "alert",
    });
  };

  const persistForm = async (input: FavoriteInput, mode?: "overwrite" | "copy") => {
    try {
      await favoritesStorage.persistFavorite(input, mode);
      setIsFormOpen(false);
      refreshList();
      if (mode !== "copy" && input.id) {
        const saved = favoritesStorage.getFavorites().find((f) => f.id === input.id);
        if (saved) onSaved?.(saved);
        // Show what was just saved.
        setSelectedId(input.id);
      }
    } catch (e) {
      if (e instanceof FavoriteConflictError) {
        // External edit detected (other computer / text editor): never overwrite silently.
        useUIStore.getState().showConfirm({
          title: "La consulta cambió fuera de PyroStudio",
          message:
            "El archivo .sql se modificó en disco desde que lo abrió (otro equipo o un editor externo).",
          details:
            "«Sobrescribir» reemplaza la versión del disco con la suya. «Guardar como copia» conserva ambas versiones; después puede recargar la lista para ver la externa.",
          variant: "warning",
          icon: "alert",
          confirmText: "Sobrescribir",
          cancelText: "Guardar como copia",
          onConfirm: () => void persistForm(input, "overwrite"),
          onCancel: () => void persistForm(input, "copy"),
        });
        return;
      }
      showStorageError("No se pudo guardar la consulta", e);
    }
  };

  const renameFavorite = async (fav: SqlFavorite, title: string, category: string) => {
    const unchanged = title.trim() === fav.title && (category.trim() || "General") === fav.category;
    if (!unchanged) await persistForm({ ...fav, title, category });
  };

  const handleSaveForm = () => {
    const linked = form.linked && !!formConnectionId && !!form.database.trim();
    void persistForm({
      id: editingId || newFavoriteId(),
      title: form.title,
      category: form.category,
      sql: form.sql,
      description: form.description,
      connectionId: linked ? formConnectionId : undefined,
      database: linked ? form.database.trim() : undefined,
      folder: linked
        ? editingId
          ? favorites.find((f) => f.id === editingId)?.folder
          : defaultFolder
        : undefined,
    });
  };

  const handleDelete = (fav: SqlFavorite) => {
    setFavoriteToDelete(fav);
  };

  const executeDeleteFavorite = async () => {
    if (!favoriteToDelete) return;
    try {
      setFavorites(await favoritesStorage.removeFavorite(favoriteToDelete.id));
    } catch (e) {
      showStorageError(
        e instanceof FavoriteConflictError
          ? "La consulta cambió en disco; recargue antes de eliminarla"
          : "No se pudo eliminar la consulta",
        e
      );
      refreshList();
    }
    setFavoriteToDelete(null);
  };

  const runHere = (sql: string) => {
    onSelectQuery(sql, true);
    onClose();
  };

  const runInNewTab = (fav: SqlFavorite) => {
    useUIStore.getState().openTab({
      id: `query-${uid()}`,
      title: fav.title,
      type: "query",
      database: (isThisDb(fav) ? fav.database : undefined) || defaultDatabase || fav.database || "",
      queryContent: fav.sql,
      autoRun: true,
    });
    onClose();
  };

  /** Built-in queries cannot be deleted inside a workspace (they live in the app). */
  const canDelete = (fav: SqlFavorite) =>
    !(favoritesStorage.isPreset(fav.id) && !favoritesStorage.workspaceQuery(fav.id) && useWorkspaceStore.getState().isFolderMode());

  const metaOf = (fav: SqlFavorite): string[] => {
    const meta = [fav.category, fav.database ? `Base de datos ${fav.database}` : "Cualquier base de datos"];
    if (favoritesStorage.isPreset(fav.id)) meta.push("Integrada en PyroStudio");
    return meta;
  };

  const moveSelection = (delta: number) => {
    if (!ordered.length) return;
    const i = selected ? ordered.findIndex((f) => f.id === selected.id) : -1;
    const next = ordered[Math.max(0, Math.min(ordered.length - 1, i + delta))];
    setSelectedId(next.id);
  };

  const categoryNames = allCategories.filter((c) => c !== "Todos");
  const searching = searchTerm.trim() !== "";

  return (
    <div className={docked ? "h-full w-full" : modalBackdrop} onClick={docked ? undefined : onClose}>
      <div
        data-favorites-panel
        className={
          docked
            ? "@container h-full bg-surface flex flex-col overflow-hidden text-xs"
            : "@container bg-surface border border-line w-full max-w-4xl h-[85vh] rounded-xl shadow-modal flex flex-col overflow-hidden text-xs zoom-in-95"
        }
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Keys typed here must not trigger the editor's shortcuts (Alt+X, Ctrl+S…).
          // That also keeps them from reaching window listeners, so Escape is handled here.
          e.stopPropagation();
          if (e.key === "Escape" && !e.defaultPrevented) {
            e.preventDefault();
            handleEscape();
          }
        }}
        ref={panelRef}
        role={docked ? "complementary" : "dialog"}
        aria-label="Consultas guardadas"
      >
        {/* Header: what this is, how many, create, close */}
        <div className={modalHeader}>
          <div className="flex items-baseline gap-2 min-w-0">
            <h2 className={modalTitle}>Consultas guardadas</h2>
            <span className="text-[11px] text-fg-muted tabular-nums shrink-0">
              {searching || selectedCategory !== "Todos"
                ? `${filteredFavorites.length} de ${scopeTotal}`
                : `${scopeTotal} ${scopeTotal === 1 ? "consulta" : "consultas"}`}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => openCreateForm()} className={ghostBtn} title="Guardar una consulta nueva">
              <Plus className="w-3.5 h-3.5" /> Nueva
            </button>
            <button type="button" onClick={onClose} className={iconBtn} aria-label="Cerrar" title="Cerrar (Esc)">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Find: search first, then where and which category */}
        <div data-view-toolbar className="px-3 py-2 border-b border-line flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[12rem]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none" />
            <input
              ref={searchRef}
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  moveSelection(e.key === "ArrowDown" ? 1 : -1);
                  return;
                }
                // Enter: run the selected query here; Ctrl/Cmd+Enter: in a new tab.
                if (e.key !== "Enter" || !selected || isFormOpen) return;
                e.preventDefault();
                if (e.ctrlKey || e.metaKey) runInNewTab(selected);
                else runHere(selected.sql);
              }}
              aria-label="Buscar consultas"
              aria-controls="favorites-list"
              placeholder="Buscar por título, SQL o descripción"
              className={`${inputClass} pl-8 h-8`}
            />
          </div>
          {canScope && (
            <div role="radiogroup" aria-label="Ámbito" className="flex items-center h-8 rounded-md border border-line p-0.5 shrink-0">
              {(
                [
                  ["db", defaultDatabase, "Consultas de esta base de datos y las generales"],
                  ["all", "Todas", "Consultas de cualquier base de datos"],
                ] as const
              ).map(([value, label, hint]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={scope === value}
                  onClick={() => setScope(value)}
                  title={hint}
                  className={`h-full px-2 rounded text-[11px] max-w-[10rem] truncate ${
                    scope === value ? "bg-hover text-fg font-medium" : "text-fg-muted hover:text-fg"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {categories.length > 2 && (
            <select
              aria-label="Categoría"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              disabled={searching}
              title={searching ? "La búsqueda incluye todas las categorías" : "Filtrar por categoría"}
              className={`${selectClass} w-auto max-w-[11rem] h-8 py-0`}
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c === "Todos" ? "Todas las categorías" : c}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* List + detail: side by side when there is room, stacked in the narrow dock */}
        <div className="flex-1 min-h-0 flex flex-col @2xl:flex-row">
          <div
            id="favorites-list"
            className={`overflow-y-auto border-b border-line @2xl:border-b-0 @2xl:border-r @2xl:w-[42%] @2xl:flex-none @2xl:max-h-none ${
              // Stacked (narrow dock): the list gets the room, unless a form needs it.
              isFormOpen ? "max-h-[35%] shrink-0" : "flex-1 min-h-0"
            }`}
          >
            {ordered.length === 0 ? (
              <EmptyState
                icon={<Star className="w-6 h-6" />}
                title={searching ? "Sin coincidencias" : "Aún no hay consultas guardadas aquí"}
                description={
                  searching
                    ? scope === "db" && canScope
                      ? `Nada coincide en ${defaultDatabase} ni en las consultas generales.`
                      : "Pruebe con otra palabra del título o del SQL."
                    : "Guarde la consulta del editor con Ctrl+S o cree una nueva."
                }
                action={
                  searching && scope === "db" && canScope ? (
                    <button type="button" onClick={() => setScope("all")} className={ghostBtn}>
                      Buscar en todas las bases de datos
                    </button>
                  ) : !searching ? (
                    <button type="button" onClick={() => openCreateForm()} className={ghostBtn}>
                      <Plus className="w-3.5 h-3.5" /> Nueva consulta
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <FavoritesList
                groups={groups}
                selectedId={selected?.id ?? null}
                isThisDb={isThisDb}
                onSelect={(f) => setSelectedId(f.id)}
                onRun={(f) => runHere(f.sql)}
                onRunInNewTab={runInNewTab}
              />
            )}
          </div>

          <div
            className={`min-w-0 bg-surface flex flex-col @2xl:flex-1 @2xl:min-h-0 @2xl:max-h-none ${
              isFormOpen ? "flex-1 min-h-0" : "max-h-[55%]"
            }`}
          >
            {isFormOpen ? (
              <FavoriteForm
                mode={editingId ? "edit" : "create"}
                values={form}
                canLink={!!formConnectionId}
                categories={categoryNames}
                onChange={setForm}
                onSubmit={handleSaveForm}
                onCancel={() => setIsFormOpen(false)}
              />
            ) : selected ? (
              <FavoriteDetail
                fav={selected}
                meta={metaOf(selected)}
                filePath={favoritesStorage.workspaceQuery(selected.id)?.relPath}
                canDelete={canDelete(selected)}
                categories={categoryNames}
                onRun={() => runHere(selected.sql)}
                onRunInNewTab={() => runInNewTab(selected)}
                onOpen={() => {
                  openSavedQuery(selected, selected.database || defaultDatabase || "");
                  onClose();
                }}
                onEdit={() => openEditForm(selected)}
                onDelete={() => handleDelete(selected)}
                onRename={(title, category) => renameFavorite(selected, title, category)}
              />
            ) : null}
          </div>
        </div>

        {/* Keyboard hints, for discoverability */}
        <div className="px-3 py-1.5 border-t border-line text-[11px] text-fg-subtle flex flex-wrap gap-x-3 gap-y-0.5">
          <span><kbd className="font-mono">↑↓</kbd> elegir</span>
          <span><kbd className="font-mono">Enter</kbd> ejecutar</span>
          <span><kbd className="font-mono">Ctrl+Enter</kbd> en pestaña nueva</span>
          <span><kbd className="font-mono">Esc</kbd> {searching ? "limpiar búsqueda" : "cerrar"}</span>
        </div>
      </div>

      <ConfirmModal
        isOpen={!!favoriteToDelete}
        title="Eliminar consulta guardada"
        message={`¿Eliminar «${favoriteToDelete?.title}»? Esta acción no se puede deshacer.`}
        details={favoriteToDelete?.sql}
        confirmText="Eliminar"
        variant="danger"
        onConfirm={executeDeleteFavorite}
        onClose={() => setFavoriteToDelete(null)}
      />
    </div>
  );
};
