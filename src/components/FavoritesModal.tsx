import React, { useState, useEffect, useMemo } from "react";
import {
  X,
  Star,
  Search,
  Plus,
  Trash2,
  Edit2,
  Copy,
  Check,
  Play,
  ArrowUpRight,
  Folder,
  Tag,
  Save,
  FolderInput,
} from "lucide-react";
import type { SqlFavorite } from "../types/database";
import {
  FavoriteConflictError,
  favoritesStorage,
  newFavoriteId,
  type FavoriteInput,
} from "../services/favoritesStorage";
import { useUIStore } from "../stores/uiStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { openSavedQuery } from "./SavedQueriesFolder";
import { ConfirmModal } from "./ConfirmModal";
import { iconBtn, modalBackdrop, modalHeader, primaryBtn } from "./ui/styles";

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
  const [formLinked, setFormLinked] = useState(false);
  const [formConnectionId, setFormConnectionId] = useState<string | undefined>(undefined);
  const [formDatabase, setFormDatabase] = useState("");
  const [favorites, setFavorites] = useState<SqlFavorite[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("Todos");
  const [searchTerm, setSearchTerm] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Inline rename / move (title + category; in a workspace the category is the folder).
  const [renaming, setRenaming] = useState<{ id: string; title: string; category: string } | null>(null);
  const [favoriteToDelete, setFavoriteToDelete] = useState<SqlFavorite | null>(null);

  // Edit / Create Form state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formCategory, setFormCategory] = useState("General");
  const [formSql, setFormSql] = useState("");
  const [formDesc, setFormDesc] = useState("");

  const refreshList = () => {
    setFavorites(favoritesStorage.getFavorites());
  };

  const workspaceVersion = useWorkspaceStore((s) => s.version);

  useEffect(() => {
    if (isOpen) refreshList();
  }, [workspaceVersion]);

  useEffect(() => {
    if (isOpen) {
      refreshList();
      if (initialQueryToSave && initialQueryToSave.trim()) {
        openCreateForm(initialQueryToSave);
      }
    }
  }, [isOpen, initialQueryToSave]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (renaming) {
          setRenaming(null);
        } else if (isFormOpen) {
          setIsFormOpen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isFormOpen, renaming, onClose]);

  const categories = useMemo(() => {
    return favoritesStorage.getCategories();
  }, [favorites]);

  const filteredFavorites = useMemo(() => {
    const found = favoritesStorage.searchFavorites(searchTerm, selectedCategory);
    return scope === "db" && canScope
      ? found.filter((f) => f.connectionId === defaultConnectionId && f.database === defaultDatabase)
      : found;
  }, [favorites, searchTerm, selectedCategory, scope, canScope, defaultConnectionId, defaultDatabase]);

  if (!isOpen) return null;

  const openCreateForm = (prefilledSql?: string) => {
    setEditingId(null);
    setFormTitle("");
    setFormCategory("General");
    setFormSql(prefilledSql || "");
    setFormDesc("");
    setFormLinked(canScope);
    setFormConnectionId(defaultConnectionId);
    setFormDatabase(defaultDatabase || "");
    setIsFormOpen(true);
  };

  const openEditForm = (fav: SqlFavorite) => {
    setEditingId(fav.id);
    setFormTitle(fav.title);
    setFormCategory(fav.category);
    setFormSql(fav.sql);
    setFormDesc(fav.description || "");
    setFormLinked(!!fav.connectionId);
    setFormConnectionId(fav.connectionId || defaultConnectionId);
    setFormDatabase(fav.database || defaultDatabase || "");
    setIsFormOpen(true);
  };

  const showStorageError = (title: string, e: unknown) => {
    useUIStore.getState().showAlert({
      title,
      message: e instanceof Error ? e.message : String(e),
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

  const commitRename = async (fav: SqlFavorite) => {
    if (!renaming || !renaming.title.trim()) return;
    const unchanged =
      renaming.title.trim() === fav.title && (renaming.category.trim() || "General") === fav.category;
    if (!unchanged) {
      await persistForm({
        ...fav,
        title: renaming.title,
        category: renaming.category,
      });
    }
    setRenaming(null);
  };

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !formSql.trim()) {
      return;
    }

    const linked = formLinked && !!formConnectionId && !!formDatabase.trim();
    void persistForm({
      id: editingId || newFavoriteId(),
      title: formTitle,
      category: formCategory,
      sql: formSql,
      description: formDesc,
      connectionId: linked ? formConnectionId : undefined,
      database: linked ? formDatabase.trim() : undefined,
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

  const handleCopy = (id: string, sql: string) => {
    navigator.clipboard.writeText(sql);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className={docked ? "h-full w-full" : modalBackdrop} onClick={docked ? undefined : onClose}>
      <div
        className={
          docked
            ? "@container h-full bg-surface flex flex-col overflow-hidden text-xs"
            : "@container bg-surface border border-line w-full max-w-4xl h-[85vh] rounded-xl shadow-modal flex flex-col overflow-hidden text-xs zoom-in-95"
        }
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={modalHeader}>
          <div className="flex items-center space-x-2.5 text-fg">
            <Star className="w-4 h-4 text-fg-muted" />
            <span className="font-semibold text-sm">Consultas favoritas y fragmentos SQL</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-elevated text-fg-muted font-mono">
              {filteredFavorites.length} de {favorites.length}
            </span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => openCreateForm()}
              className="flex items-center space-x-1 px-3 py-1.5 bg-accent hover:bg-accent-hover text-accent-fg rounded font-medium shadow-md transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Nuevo Favorito</span>
            </button>
            <button
              onClick={onClose}
              className={iconBtn}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Toolbar: Categories & Search */}
        <div className="px-5 py-2.5 bg-raised border-b border-line flex flex-wrap items-center justify-between gap-3 select-none">
          {/* Category Tabs */}
          <div className="flex items-center space-x-1.5 overflow-x-auto py-0.5 scrollbar-none shrink-0">
            {canScope && (
              <div className="flex items-center rounded-md border border-line mr-1 shrink-0">
                {(
                  [
                    ["db", defaultDatabase],
                    ["all", "Todas"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setScope(value)}
                    className={`px-2 py-1 text-[11px] whitespace-nowrap ${
                      scope === value ? "bg-hover text-fg font-medium" : "text-fg-muted hover:text-fg"
                    }`}
                    title={value === "db" ? "Consultas de esta base de datos" : "Todas las consultas guardadas"}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 rounded-md text-[11px] transition-colors flex items-center space-x-1 shrink-0 whitespace-nowrap ${
                  selectedCategory === cat
                    ? "text-warning border border-line font-semibold"
                    : "text-fg-muted hover:text-fg hover:bg-hover"
                }`}
              >
                <Folder className="w-3 h-3 opacity-60" />
                <span>{cat}</span>
              </button>
            ))}
          </div>

          {/* Search bar */}
          <div className="relative min-w-[220px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-fg-subtle" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar favoritos..."
              className="w-full bg-canvas border border-line focus:border-accent rounded pl-8 pr-3 py-1.5 text-xs text-fg focus:outline-none"
            />
          </div>
        </div>

        {/* Body (Form or Favorites List) */}
        <div className="flex-1 overflow-y-auto p-4 bg-canvas">
          {isFormOpen ? (
            <form
              onSubmit={handleSaveForm}
              className="bg-raised border border-line rounded-xl p-5 space-y-4 max-w-2xl mx-auto"
            >
              <div className="flex items-center justify-between border-b border-line pb-3">
                <h3 className="font-semibold text-fg text-sm flex items-center space-x-2">
                  <Star className="w-4 h-4 text-fg-muted" />
                  <span>{editingId ? "Editar Consulta Favorita" : "Guardar Nueva Consulta Favorita"}</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="p-1 rounded text-fg-muted hover:text-fg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 @lg:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] text-fg-muted">Título / Nombre *</label>
                  <input
                    type="text"
                    required
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder="Ej. Reporte mensual de ventas"
                    className="w-full bg-canvas border border-line focus:border-accent rounded px-3 py-1.5 text-xs text-fg focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-fg-muted">Categoría</label>
                  <input
                    type="text"
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                    placeholder="Ej. Reportes, Diagnóstico, Usuarios..."
                    className="w-full bg-canvas border border-line focus:border-accent rounded px-3 py-1.5 text-xs text-fg focus:outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-fg-muted">Descripción (opcional)</label>
                <input
                  type="text"
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="Detalles sobre qué hace esta consulta..."
                  className="w-full bg-canvas border border-line focus:border-accent rounded px-3 py-1.5 text-xs text-fg focus:outline-none"
                />
              </div>

              {formConnectionId && (
                <label className="flex items-center gap-2 text-[11px] text-fg-muted">
                  <input
                    type="checkbox"
                    checked={formLinked}
                    onChange={(e) => setFormLinked(e.target.checked)}
                    className="accent-[var(--pyro-accent)]"
                  />
                  <span>Guardar en la base de datos</span>
                  <input
                    type="text"
                    value={formDatabase}
                    disabled={!formLinked}
                    onChange={(e) => setFormDatabase(e.target.value)}
                    className="w-40 bg-canvas border border-line rounded px-2 py-0.5 text-xs text-fg font-mono focus:outline-none focus:border-accent disabled:opacity-50"
                  />
                  <span className="text-[11px]">(aparecerá en el explorador bajo esa base de datos)</span>
                </label>
              )}

              <div className="space-y-1">
                <label className="text-[11px] text-fg-muted">Sentencia SQL *</label>
                <textarea
                  required
                  rows={7}
                  value={formSql}
                  onChange={(e) => setFormSql(e.target.value)}
                  placeholder="SELECT * FROM ..."
                  className="w-full bg-canvas border border-line focus:border-accent rounded p-3 text-xs font-mono text-fg focus:outline-none resize-y"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-line">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="px-3 py-1.5 rounded border border-line-strong hover:bg-hover text-fg text-xs"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={primaryBtn}
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Guardar Favorito</span>
                </button>
              </div>
            </form>
          ) : filteredFavorites.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-fg-subtle space-y-2">
              <Star className="w-8 h-8 opacity-30 text-fg-muted" />
              <span>No se encontraron favoritos en esta categoría.</span>
              <button
                onClick={() => openCreateForm()}
                className="mt-2 text-xs text-warning hover:underline"
              >
                + Crear el primer favorito
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              <datalist id="fav-categories">
                {categories
                  .filter((c) => c !== "Todos")
                  .map((c) => (
                    <option key={c} value={c} />
                  ))}
              </datalist>
              {filteredFavorites.map((fav) => (
                <div
                  key={fav.id}
                  className="bg-raised border border-line hover:border-line-strong rounded-lg p-3 transition-colors flex flex-col space-y-2 group"
                >
                  {/* Card Header */}
                  <div className="flex items-center justify-between text-fg">
                    {renaming?.id === fav.id ? (
                      <form
                        className="flex items-center gap-1.5 flex-1 min-w-0 mr-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void commitRename(fav);
                        }}
                      >
                        <input
                          autoFocus
                          value={renaming.title}
                          onChange={(e) => setRenaming({ ...renaming, title: e.target.value })}
                          placeholder="Título"
                          aria-label="Título"
                          className="flex-1 min-w-0 px-2 py-0.5 text-xs bg-surface border border-line rounded focus:outline-none focus:border-accent"
                        />
                        <input
                          list="fav-categories"
                          value={renaming.category}
                          onChange={(e) => setRenaming({ ...renaming, category: e.target.value })}
                          placeholder="Categoría / carpeta"
                          aria-label="Categoría"
                          className="w-36 px-2 py-0.5 text-xs bg-surface border border-line rounded focus:outline-none focus:border-accent"
                        />
                        <button type="submit" className={primaryBtn}>
                          Guardar
                        </button>
                        <button type="button" onClick={() => setRenaming(null)} className="px-2 py-0.5 text-[11px] rounded text-fg-muted hover:text-fg">
                          Cancelar
                        </button>
                      </form>
                    ) : (
                      <div className="flex items-center space-x-2 min-w-0">
                        
                        <span className="font-semibold text-fg dark:text-fg text-xs truncate">{fav.title}</span>
                        <span className="flex items-center space-x-1 text-[11px] font-mono text-fg-muted shrink-0">
                          <Tag className="w-2.5 h-2.5" />
                          <span>{fav.database ?? fav.category}</span>
                        </span>
                        {favoritesStorage.workspaceQuery(fav.id) && (
                          <span
                            className="text-[11px] font-mono text-fg-subtle truncate"
                            title="Archivo en el espacio de trabajo"
                          >
                            {favoritesStorage.workspaceQuery(fav.id)!.relPath}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center space-x-1.5 opacity-90 group-hover:opacity-100">
                      <button
                        onClick={() => handleCopy(fav.id, fav.sql)}
                        title="Copiar SQL al portapapeles"
                        className="p-1 rounded hover:bg-hover text-fg-muted hover:text-fg transition-colors"
                      >
                        {copiedId === fav.id ? (
                          <Check className="w-3.5 h-3.5 text-success" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>

                      <button
                        onClick={() => setRenaming({ id: fav.id, title: fav.title, category: fav.category })}
                        title="Renombrar o mover a otra categoría"
                        className="p-1 rounded hover:bg-hover text-fg-muted hover:text-fg transition-colors"
                      >
                        <FolderInput className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => openEditForm(fav)}
                        title="Editar favorito"
                        className="p-1 rounded hover:bg-hover text-fg-muted hover:text-fg transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => {
                          openSavedQuery(fav, fav.database || defaultDatabase || "");
                          onClose();
                        }}
                        title="Abrir en su pestaña (los cambios se guardan con Ctrl+S)"
                        className="flex items-center space-x-1 px-2 py-0.5 rounded text-fg-muted hover:text-fg hover:bg-hover text-[11px] transition-colors"
                      >
                        <ArrowUpRight className="w-3 h-3" />
                        <span>Abrir</span>
                      </button>

                      <button
                        onClick={() => {
                          onSelectQuery(fav.sql, true);
                          onClose();
                        }}
                        title="Ejecutar consulta directamente"
                        className="flex items-center space-x-1 px-2 py-0.5 rounded bg-accent hover:bg-accent-hover text-accent-fg text-[11px] font-medium transition-colors"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>Ejecutar</span>
                      </button>

                      <button
                        onClick={() => handleDelete(fav)}
                        title="Eliminar favorito"
                        className="p-1 rounded hover:bg-hover text-fg-subtle hover:text-danger transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Description if any */}
                  {fav.description && (
                    <div className="text-[11px] text-fg-muted leading-relaxed">
                      {fav.description}
                    </div>
                  )}

                  {/* SQL Preview */}
                  <pre className="p-2.5 bg-canvas border border-line rounded font-mono text-[11px] text-fg whitespace-pre-wrap max-h-32 overflow-y-auto select-all">
                    {fav.sql}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        isOpen={!!favoriteToDelete}
        title="Eliminar Favorito SQL"
        message={`¿Seguro que deseas eliminar el snippet "${favoriteToDelete?.title}"?`}
        details={favoriteToDelete?.sql}
        confirmText="Eliminar Favorito"
        variant="danger"
        onConfirm={executeDeleteFavorite}
        onClose={() => setFavoriteToDelete(null)}
      />
    </div>
  );
};
