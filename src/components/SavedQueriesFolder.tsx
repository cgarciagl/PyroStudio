import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, FileCode2, Pencil, Plus, Trash2 } from "lucide-react";
import type { SqlFavorite } from "../types/database";
import { FAVORITES_CHANGED_EVENT, favoritesStorage } from "../services/favoritesStorage";
import { useUIStore } from "../stores/uiStore";
import { useWorkspaceStore } from "../stores/workspaceStore";

interface SavedQueriesFolderProps {
  /** Saved connection id of the active session (queries are scoped to it). */
  connectionId?: string;
  database: string;
}

export const savedQueryTabId = (favoriteId: string) => `saved-${favoriteId}`;

/** Opens a saved query in its own tab (re-focuses it if already open). */
export function openSavedQuery(fav: SqlFavorite, database: string) {
  useUIStore.getState().openTab({
    id: savedQueryTabId(fav.id),
    title: fav.title,
    type: "query",
    database: fav.database || database,
    queryContent: fav.sql,
    savedQueryId: fav.id,
  });
}

/** "Consultas" node under a database in the explorer. */
export const SavedQueriesFolder: React.FC<SavedQueriesFolderProps> = ({ connectionId, database }) => {
  const [version, setVersion] = useState(0);
  const workspaceVersion = useWorkspaceStore((s) => s.version);
  const [open, setOpen] = useState<boolean | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(FAVORITES_CHANGED_EVENT, bump);
    return () => window.removeEventListener(FAVORITES_CHANGED_EVENT, bump);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const queries = React.useMemo(() => favoritesStorage.forDatabase(connectionId, database), [
    connectionId,
    database,
    version,
    workspaceVersion,
  ]);

  if (!connectionId) return null;
  const isOpen = open ?? queries.length > 0;

  const showError = (title: string, e: unknown) =>
    useUIStore.getState().showAlert({
      title,
      message: e instanceof Error ? e.message : String(e),
      variant: "danger",
      icon: "alert",
    });

  const commitRename = async (fav: SqlFavorite) => {
    const title = draft.trim();
    setRenamingId(null);
    if (!title || title === fav.title) return;
    try {
      await favoritesStorage.persistFavorite({ ...fav, title });
      useUIStore.getState().renameTab(savedQueryTabId(fav.id), title);
    } catch (e) {
      showError("No se pudo renombrar la consulta", e);
    }
  };

  const confirmDelete = (fav: SqlFavorite) =>
    useUIStore.getState().showConfirm({
      title: "Eliminar consulta guardada",
      message: `¿Eliminar «${fav.title}» de ${database}?`,
      variant: "danger",
      icon: "trash",
      confirmText: "Eliminar",
      onConfirm: async () => {
        try {
          await favoritesStorage.removeFavorite(fav.id);
        } catch (e) {
          showError("No se pudo eliminar la consulta", e);
        }
      },
    });

  const newQuery = (e: React.MouseEvent) => {
    e.stopPropagation();
    useUIStore.getState().openTab({
      id: `query-${Date.now()}`,
      title: `Consulta · ${database}`,
      type: "query",
      database,
      queryContent: "",
    });
  };

  return (
    <div className="flex flex-col">
      <div
        onClick={() => setOpen(!isOpen)}
        className="group flex items-center justify-between px-1.5 py-1 rounded text-[11px] text-fg-muted hover:text-fg hover:bg-hover cursor-pointer"
      >
        <div className="flex items-center gap-1.5 truncate">
          <span className="p-0.5">
            {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </span>
          <FileCode2 className="w-3.5 h-3.5 shrink-0" />
          <span className="font-semibold">Consultas ({queries.length})</span>
        </div>
        <button
          type="button"
          onClick={newQuery}
          title={`Nueva consulta en ${database}`}
          className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-hover"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {isOpen && (
        <div className="ml-3 pl-1.5 border-l border-line space-y-0.5 mt-0.5">
          {queries.length === 0 ? (
            <div className="py-1 px-1.5 text-[10px] text-fg-muted">
              Sin consultas. Use Ctrl+S en el editor para guardar una aquí.
            </div>
          ) : (
            queries.map((fav) =>
              renamingId === fav.id ? (
                <input
                  key={fav.id}
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => void commitRename(fav)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitRename(fav);
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  className="w-full px-1.5 py-0.5 text-[11px] font-mono bg-surface border border-accent rounded text-fg focus:outline-none"
                />
              ) : (
                <div
                  key={fav.id}
                  onClick={() => openSavedQuery(fav, database)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setRenamingId(fav.id);
                    setDraft(fav.title);
                  }}
                  title={fav.description || fav.sql.slice(0, 300)}
                  className="group flex items-center justify-between px-1.5 py-0.5 rounded text-xs cursor-pointer text-fg-muted hover:bg-hover hover:text-fg"
                >
                  <span className="truncate font-mono text-[11px]">{fav.title}</span>
                  <span className="hidden group-hover:flex items-center shrink-0">
                    <button
                      type="button"
                      title="Renombrar"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenamingId(fav.id);
                        setDraft(fav.title);
                      }}
                      className="p-0.5 rounded hover:text-fg"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      title="Eliminar"
                      onClick={(e) => {
                        e.stopPropagation();
                        confirmDelete(fav);
                      }}
                      className="p-0.5 rounded hover:text-danger"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </span>
                </div>
              ),
            )
          )}
        </div>
      )}
    </div>
  );
};
