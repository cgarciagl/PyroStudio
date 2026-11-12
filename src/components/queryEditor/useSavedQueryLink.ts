import { useEffect, useState } from "react";
import { FavoriteConflictError, favoritesStorage } from "../../services/favoritesStorage";
import { useUIStore } from "../../stores/uiStore";
import { errorText } from "../../utils/errors";

interface SavedQueryLinkOptions {
  tabId?: string;
  /** Saved query this tab edits; Ctrl+S updates it directly. */
  savedQueryId?: string;
  query: string;
  initialQuery: string;
  /** No linked query (or a built-in one): ask where to save it. */
  onSaveAsNew: (sql: string) => void;
  onStatus: (status: { success: boolean; message: string }) => void;
}

/**
 * Link between a query tab and its saved query: unsaved-changes state (tab dot) and
 * Ctrl+S, including the "changed on disk" conflict of workspace files.
 */
export function useSavedQueryLink({ tabId, savedQueryId, query, initialQuery, onSaveAsNew, onStatus }: SavedQueryLinkOptions) {
  const findLinked = () =>
    savedQueryId ? favoritesStorage.getFavorites().find((f) => f.id === savedQueryId) : undefined;

  // Last saved SQL: the baseline of the "unsaved changes" state (survives tab remounts).
  const [savedSql, setSavedSql] = useState<string | null>(() =>
    savedQueryId ? findLinked()?.sql ?? initialQuery : null,
  );
  useEffect(() => {
    if (savedQueryId) setSavedSql(findLinked()?.sql ?? query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedQueryId]);

  // Compare ignoring outer whitespace.
  const isDirty = savedQueryId
    ? savedSql !== null && query.trim() !== savedSql.trim()
    : query.trim().length > 0;

  useEffect(() => {
    if (tabId && savedQueryId) useUIStore.getState().setTabModified(tabId, isDirty);
  }, [tabId, savedQueryId, isDirty]);

  const saveCurrentQuery = async (mode?: "overwrite" | "copy"): Promise<void> => {
    const linked = findLinked();
    if (!linked || favoritesStorage.isPreset(linked.id)) {
      onSaveAsNew(query);
      return;
    }
    try {
      await favoritesStorage.persistFavorite({ ...linked, sql: query }, mode);
      setSavedSql(query);
      if (tabId) useUIStore.getState().setTabModified(tabId, false);
      onStatus({ success: true, message: `Guardada: ${linked.title}` });
    } catch (e) {
      if (e instanceof FavoriteConflictError) {
        useUIStore.getState().showConfirm({
          title: "La consulta cambió fuera de PyroStudio",
          message: "El archivo .sql se modificó en disco (otro equipo o un editor externo).",
          details: "«Sobrescribir» reemplaza la versión del disco. «Guardar como copia» conserva ambas.",
          variant: "warning",
          icon: "alert",
          confirmText: "Sobrescribir",
          cancelText: "Guardar como copia",
          onConfirm: () => void saveCurrentQuery("overwrite"),
          onCancel: () => void saveCurrentQuery("copy"),
        });
        return;
      }
      onStatus({ success: false, message: errorText(e) });
    }
  };

  /** The tab was just saved as a new query (from the save dialog). */
  const markSaved = (sql: string) => setSavedSql(sql);

  return { isDirty, saveCurrentQuery, markSaved };
}
