import React, { useEffect, useState } from "react";
import type { SqlFavorite } from "../types/database";
import { FAVORITES_CHANGED_EVENT, favoritesStorage } from "../services/favoritesStorage";
import { useUIStore } from "../stores/uiStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { ObjectIcon } from "./objectIcons";

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

/** Re-renders when saved queries change in any storage mode. */
export function useSavedQueriesVersion(): number {
  const [version, setVersion] = useState(0);
  const workspaceVersion = useWorkspaceStore((s) => s.version);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(FAVORITES_CHANGED_EVENT, bump);
    return () => window.removeEventListener(FAVORITES_CHANGED_EVENT, bump);
  }, []);
  return version * 100000 + workspaceVersion;
}

interface QueriesNodeProps {
  connectionId?: string;
  database: string;
  onOpen: () => void;
}

/** "Consultas" node of a database in the explorer; the list opens in the object browser. */
export const QueriesNode: React.FC<QueriesNodeProps> = ({ connectionId, database, onOpen }) => {
  const version = useSavedQueriesVersion();
  const count = React.useMemo(
    () => favoritesStorage.forDatabase(connectionId, database).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [connectionId, database, version],
  );
  if (!connectionId) return null;
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      title={`Abrir las consultas guardadas de ${database}`}
      className="flex items-center gap-1.5 px-1.5 py-1 rounded text-[11px] text-fg-muted hover:text-fg hover:bg-hover cursor-pointer"
    >
      <span className="w-4" />
      <ObjectIcon kind="queries" />
      <span className="font-medium">
        Consultas <span className="font-normal">{count}</span>
      </span>
    </div>
  );
};
