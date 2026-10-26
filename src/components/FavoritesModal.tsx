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
} from "lucide-react";
import type { SqlFavorite } from "../types/database";
import {
  FavoriteConflictError,
  favoritesStorage,
  type FavoriteInput,
} from "../services/favoritesStorage";
import { useUIStore } from "../stores/uiStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { ConfirmModal } from "./ConfirmModal";

interface FavoritesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectQuery: (sql: string, runImmediately?: boolean) => void;
  initialQueryToSave?: string;
}

export const FavoritesModal: React.FC<FavoritesModalProps> = ({
  isOpen,
  onClose,
  onSelectQuery,
  initialQueryToSave,
}) => {
  const [favorites, setFavorites] = useState<SqlFavorite[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("Todos");
  const [searchTerm, setSearchTerm] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
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
        if (isFormOpen) {
          setIsFormOpen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isFormOpen, onClose]);

  const categories = useMemo(() => {
    return favoritesStorage.getCategories();
  }, [favorites]);

  const filteredFavorites = useMemo(() => {
    return favoritesStorage.searchFavorites(searchTerm, selectedCategory);
  }, [favorites, searchTerm, selectedCategory]);

  if (!isOpen) return null;

  const openCreateForm = (prefilledSql?: string) => {
    setEditingId(null);
    setFormTitle("");
    setFormCategory("General");
    setFormSql(prefilledSql || "");
    setFormDesc("");
    setIsFormOpen(true);
  };

  const openEditForm = (fav: SqlFavorite) => {
    setEditingId(fav.id);
    setFormTitle(fav.title);
    setFormCategory(fav.category);
    setFormSql(fav.sql);
    setFormDesc(fav.description || "");
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

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !formSql.trim()) {
      return;
    }

    void persistForm({
      id: editingId || undefined,
      title: formTitle,
      category: formCategory,
      sql: formSql,
      description: formDesc,
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-line w-full max-w-4xl h-[85vh] rounded-xl shadow-2xl flex flex-col overflow-hidden text-xs pyro-ember zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 bg-raised border-b border-line flex items-center justify-between">
          <div className="flex items-center space-x-2.5 text-neutral-200">
            <Star className="w-4 h-4 text-amber-400 fill-amber-400/20" />
            <span className="font-semibold text-sm">Consultas Favoritas & Snippets SQL</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-elevated text-neutral-400 font-mono">
              {filteredFavorites.length} de {favorites.length}
            </span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => openCreateForm()}
              className="flex items-center space-x-1 px-3 py-1.5 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white rounded font-medium shadow-md transition-all active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Nuevo Favorito</span>
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded-md text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Toolbar: Categories & Search */}
        <div className="px-5 py-2.5 bg-raised border-b border-line flex flex-wrap items-center justify-between gap-3 select-none">
          {/* Category Tabs */}
          <div className="flex items-center space-x-1.5 overflow-x-auto py-0.5 scrollbar-none shrink-0">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 rounded-md text-[11px] transition-colors flex items-center space-x-1 shrink-0 whitespace-nowrap ${
                  selectedCategory === cat
                    ? "bg-amber-600/30 text-amber-300 border border-amber-500/50 font-semibold"
                    : "text-neutral-400 hover:text-white hover:bg-hover"
                }`}
              >
                <Folder className="w-3 h-3 opacity-60" />
                <span>{cat}</span>
              </button>
            ))}
          </div>

          {/* Search bar */}
          <div className="relative min-w-[220px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-neutral-500" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar favoritos..."
              className="w-full bg-canvas border border-line focus:border-amber-500 rounded pl-8 pr-3 py-1.5 text-xs text-neutral-200 focus:outline-none"
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
                <h3 className="font-semibold text-neutral-200 text-sm flex items-center space-x-2">
                  <Star className="w-4 h-4 text-amber-400" />
                  <span>{editingId ? "Editar Consulta Favorita" : "Guardar Nueva Consulta Favorita"}</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="p-1 rounded text-neutral-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] text-neutral-400">Título / Nombre *</label>
                  <input
                    type="text"
                    required
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder="Ej. Reporte mensual de ventas"
                    className="w-full bg-canvas border border-line focus:border-amber-500 rounded px-3 py-1.5 text-xs text-neutral-200 focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-neutral-400">Categoría</label>
                  <input
                    type="text"
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                    placeholder="Ej. Reportes, Diagnóstico, Usuarios..."
                    className="w-full bg-canvas border border-line focus:border-amber-500 rounded px-3 py-1.5 text-xs text-neutral-200 focus:outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-neutral-400">Descripción (opcional)</label>
                <input
                  type="text"
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="Detalles sobre qué hace esta consulta..."
                  className="w-full bg-canvas border border-line focus:border-amber-500 rounded px-3 py-1.5 text-xs text-neutral-200 focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-neutral-400">Sentencia SQL *</label>
                <textarea
                  required
                  rows={7}
                  value={formSql}
                  onChange={(e) => setFormSql(e.target.value)}
                  placeholder="SELECT * FROM ..."
                  className="w-full bg-canvas border border-line focus:border-amber-500 rounded p-3 text-xs font-mono text-slate-900 dark:text-amber-200 focus:outline-none resize-y"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-line">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="px-3 py-1.5 rounded border border-line-strong hover:bg-hover text-neutral-300 text-xs"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex items-center space-x-1.5 px-4 py-1.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white rounded text-xs font-semibold shadow-md active:scale-95"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Guardar Favorito</span>
                </button>
              </div>
            </form>
          ) : filteredFavorites.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-neutral-500 space-y-2">
              <Star className="w-8 h-8 opacity-30 text-amber-400" />
              <span>No se encontraron favoritos en esta categoría.</span>
              <button
                onClick={() => openCreateForm()}
                className="mt-2 text-xs text-amber-400 hover:underline"
              >
                + Crear el primer favorito
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {filteredFavorites.map((fav) => (
                <div
                  key={fav.id}
                  className="bg-raised border border-line hover:border-line-strong rounded-lg p-3 transition-colors flex flex-col space-y-2 group"
                >
                  {/* Card Header */}
                  <div className="flex items-center justify-between text-neutral-300">
                    <div className="flex items-center space-x-2">
                      <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400/20 shrink-0" />
                      <span className="font-semibold text-slate-900 dark:text-neutral-100 text-xs">{fav.title}</span>
                      <span className="flex items-center space-x-1 text-[10px] font-mono text-amber-300 bg-amber-950/30 border border-amber-800/40 px-1.5 py-0.2 rounded">
                        <Tag className="w-2.5 h-2.5" />
                        <span>{fav.category}</span>
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center space-x-1.5 opacity-90 group-hover:opacity-100">
                      <button
                        onClick={() => handleCopy(fav.id, fav.sql)}
                        title="Copiar SQL al portapapeles"
                        className="p-1 rounded hover:bg-hover text-neutral-400 hover:text-white transition-colors"
                      >
                        {copiedId === fav.id ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>

                      <button
                        onClick={() => openEditForm(fav)}
                        title="Editar favorito"
                        className="p-1 rounded hover:bg-hover text-neutral-400 hover:text-white transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => {
                          onSelectQuery(fav.sql, false);
                          onClose();
                        }}
                        title="Cargar consulta en el editor"
                        className="flex items-center space-x-1 px-2 py-0.5 rounded bg-elevated hover:bg-hover text-neutral-200 border border-line-strong text-[11px] font-medium transition-colors"
                      >
                        <ArrowUpRight className="w-3 h-3 text-orange-400" />
                        <span>Cargar</span>
                      </button>

                      <button
                        onClick={() => {
                          onSelectQuery(fav.sql, true);
                          onClose();
                        }}
                        title="Ejecutar consulta directamente"
                        className="flex items-center space-x-1 px-2 py-0.5 rounded bg-amber-600/30 hover:bg-amber-600/50 text-amber-300 border border-amber-500/40 text-[11px] font-semibold transition-colors"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>Ejecutar</span>
                      </button>

                      <button
                        onClick={() => handleDelete(fav)}
                        title="Eliminar favorito"
                        className="p-1 rounded hover:bg-red-950/40 text-neutral-500 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Description if any */}
                  {fav.description && (
                    <div className="text-[11px] text-neutral-400 leading-relaxed">
                      {fav.description}
                    </div>
                  )}

                  {/* SQL Preview */}
                  <pre className="p-2.5 bg-canvas border border-line rounded font-mono text-[11px] text-slate-800 dark:text-amber-200/90 whitespace-pre-wrap max-h-32 overflow-y-auto select-all">
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
