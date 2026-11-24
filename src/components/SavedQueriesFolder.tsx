import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
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
  searchTerm?: string;
  onOpen: () => void;
}

/** Expandable "Consultas" node in the explorer sidebar, with folders and direct open. */
export const QueriesNode: React.FC<QueriesNodeProps> = ({
  connectionId,
  database,
  searchTerm = "",
  onOpen,
}) => {
  const { t } = useTranslation("shell");
  const version = useSavedQueriesVersion();
  const [expanded, setExpanded] = useState(false);
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});

  const allQueries = useMemo(
    () => (connectionId ? favoritesStorage.forDatabase(connectionId, database) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [connectionId, database, version],
  );

  const normalized = searchTerm.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!normalized) return allQueries;
    return allQueries.filter(
      (q) =>
        q.title.toLowerCase().includes(normalized) ||
        q.sql.toLowerCase().includes(normalized) ||
        (q.folder ?? "").toLowerCase().includes(normalized),
    );
  }, [allQueries, normalized]);

  const { folderEntries, looseQueries } = useMemo(() => {
    const byFolder = new Map<string, SqlFavorite[]>();
    const loose: SqlFavorite[] = [];
    for (const q of filtered) {
      if (q.folder) {
        const list = byFolder.get(q.folder) ?? [];
        list.push(q);
        byFolder.set(q.folder, list);
      } else {
        loose.push(q);
      }
    }
    const entries = [...byFolder.entries()]
      .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .map(([name, items]) => ({
        name,
        items: items.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" })),
      }));
    loose.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
    return { folderEntries: entries, looseQueries: loose };
  }, [filtered]);

  if (!connectionId) return null;

  const isOpen = expanded || (!!normalized && filtered.length > 0);

  const toggleFolder = (folderName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenFolders((prev) => ({ ...prev, [folderName]: !(prev[folderName] ?? false) }));
  };

  const renderQueryRow = (q: SqlFavorite) => (
    <div
      key={q.id}
      onClick={(e) => {
        e.stopPropagation();
        openSavedQuery(q, database);
      }}
      title={q.description || q.title}
      className="flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11px] text-fg-muted hover:text-fg hover:bg-hover cursor-pointer"
    >
      <ObjectIcon kind="queries" className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate">{q.title}</span>
    </div>
  );

  return (
    <div className="flex flex-col">
      <div
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((v) => !v);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        title={t("savedQueries.nodeTitle", { database })}
        className="group flex items-center gap-1.5 px-1.5 py-1 rounded text-[11px] text-fg-muted hover:text-fg hover:bg-hover cursor-pointer"
      >
        {isOpen ? (
          <ChevronDown className="w-3 h-3 shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 shrink-0" />
        )}
        <ObjectIcon kind="queries" />
        <span className="font-medium truncate">
          {t("savedQueries.title")} <span className="font-normal">{allQueries.length}</span>
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          title={t("savedQueries.manageTitle")}
          className="ml-auto p-0.5 rounded opacity-0 group-hover:opacity-100 text-fg-muted hover:text-fg hover:bg-surface transition-opacity"
        >
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>

      {isOpen && (
        <div className="ml-3 pl-1.5 border-l border-line space-y-0.5 mt-0.5">
          {filtered.length === 0 ? (
            <div className="py-0.5 px-1.5 text-[11px] text-fg-muted">{t("savedQueries.empty")}</div>
          ) : (
            <>
              {folderEntries.map(({ name, items }) => {
                const folderOpen = (openFolders[name] ?? false) || (!!normalized && items.length > 0);
                return (
                  <div key={name} className="flex flex-col">
                    <div
                      onClick={(e) => toggleFolder(name, e)}
                      className="flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11px] text-fg-muted hover:text-fg hover:bg-hover cursor-pointer"
                    >
                      {folderOpen ? (
                        <ChevronDown className="w-3 h-3 shrink-0" />
                      ) : (
                        <ChevronRight className="w-3 h-3 shrink-0" />
                      )}
                      <ObjectIcon kind="folder" open={folderOpen} />
                      <span className="truncate">{name}</span>
                      <span className="ml-auto text-[11px]">{items.length}</span>
                    </div>
                    {folderOpen && (
                      <div className="ml-3 pl-1.5 border-l border-line space-y-0.5">
                        {items.map(renderQueryRow)}
                      </div>
                    )}
                  </div>
                );
              })}
              {looseQueries.map(renderQueryRow)}
            </>
          )}
        </div>
      )}
    </div>
  );
};
