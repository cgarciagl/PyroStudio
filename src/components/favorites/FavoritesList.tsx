import { Database, Zap } from "lucide-react";
import type { SqlFavorite } from "../../types/database";

export interface FavoriteGroup {
  key: string;
  label: string;
  /** Built-in diagnostics group (shown first, with its own icon). */
  quick?: boolean;
  items: SqlFavorite[];
}

interface FavoritesListProps {
  groups: FavoriteGroup[];
  selectedId: string | null;
  /** Queries saved for the active database get a marker. */
  isThisDb: (f: SqlFavorite) => boolean;
  onSelect: (fav: SqlFavorite) => void;
  /** Double click / Enter on a row. */
  onRun: (fav: SqlFavorite) => void;
  onRunInNewTab: (fav: SqlFavorite) => void;
}

/** The SQL on one line, without comments, as a hint under the title. */
export function sqlHint(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("--") && !l.startsWith("#"))
    .join(" ")
    .replace(/\s+/g, " ");
}

/** Compact, keyboard-friendly list of saved queries grouped by category. */
export function FavoritesList({ groups, selectedId, isThisDb, onSelect, onRun, onRunInNewTab }: FavoritesListProps) {
  return (
    <div role="listbox" aria-label="Consultas guardadas" className="py-1">
      {groups.map((group) => (
        <div key={group.key} role="group" aria-label={group.label} className="mb-1">
          <div className="sticky top-0 z-10 bg-surface px-3 pt-2 pb-1 flex items-center gap-1.5 text-[11px] font-medium text-fg-muted">
            {group.quick && <Zap className="w-3 h-3" />}
            <span className="truncate">{group.label}</span>
            <span className="ml-auto tabular-nums text-fg-subtle">{group.items.length}</span>
          </div>
          {group.items.map((fav) => {
            const selected = fav.id === selectedId;
            return (
              <button
                key={fav.id}
                type="button"
                role="option"
                aria-selected={selected}
                data-favorite-id={fav.id}
                onClick={() => onSelect(fav)}
                onDoubleClick={() => onRun(fav)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  if (e.ctrlKey || e.metaKey) onRunInNewTab(fav);
                  else onRun(fav);
                }}
                className={`w-full text-left px-3 py-1.5 border-l-2 flex flex-col gap-0.5 transition-colors focus:outline-none focus-visible:bg-hover ${
                  selected ? "bg-hover border-accent" : "border-transparent hover:bg-hover"
                }`}
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className={`truncate text-xs ${selected ? "text-fg font-medium" : "text-fg"}`}>{fav.title}</span>
                  {isThisDb(fav) && (
                    <span title={`Guardada en ${fav.database}`} className="shrink-0 text-fg-subtle">
                      <Database className="w-3 h-3" />
                    </span>
                  )}
                </span>
                <span className="truncate font-mono text-[11px] text-fg-subtle">{sqlHint(fav.sql)}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
