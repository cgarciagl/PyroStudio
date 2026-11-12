import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search } from "lucide-react";
import type { TableMetadata } from "../../types/database";
import { menuPanel } from "../ui/styles";

interface TablePickerProps {
  tables: Pick<TableMetadata, "name" | "table_type">[];
  /** Multi-select (focus tables) shows checks and bulk actions; otherwise picking closes. */
  selected?: string[];
  placeholder: string;
  onPick: (table: string) => void;
  onSelectAll?: () => void;
  onClear?: () => void;
  onClose: () => void;
  /** Open upwards (from the composer at the bottom). */
  up?: boolean;
}

/**
 * Searchable table list in a popover. Replaces two near-identical popovers (focus tables
 * and mention a table). Arrow keys move, Enter picks, Escape closes.
 */
export function TablePicker({ tables, selected, placeholder, onPick, onSelectAll, onClear, onClose, up }: TablePickerProps) {
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const multi = selected !== undefined;

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? tables.filter((t) => t.name.toLowerCase().includes(q)) : tables;
  }, [tables, filter]);

  useEffect(() => setActive(0), [filter]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className={`${menuPanel} left-0 right-auto w-72 py-0 flex flex-col ${up ? "bottom-full mb-1 mt-0" : "top-full"}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          setActive((i) => Math.max(0, Math.min(shown.length - 1, i + (e.key === "ArrowDown" ? 1 : -1))));
        } else if (e.key === "Enter" && shown[active]) {
          e.preventDefault();
          onPick(shown[active].name);
        }
      }}
    >
      <div className="p-2 border-b border-line">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-canvas border border-line focus-within:border-accent">
          <Search className="w-3 h-3 text-fg-subtle shrink-0" />
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            className="bg-transparent outline-none text-xs text-fg w-full placeholder:text-fg-subtle"
          />
        </div>
      </div>
      {multi && (
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-line text-[11px] text-fg-muted">
          <span className="tabular-nums">
            {selected.length} de {tables.length} seleccionadas
          </span>
          <span className="flex items-center gap-2">
            <button type="button" onClick={onSelectAll} className="hover:text-fg">
              Todas
            </button>
            <button type="button" onClick={onClear} className="hover:text-fg">
              Ninguna
            </button>
          </span>
        </div>
      )}
      <div role="listbox" className="max-h-56 overflow-y-auto p-1">
        {shown.map((t, i) => {
          const isOn = multi && selected.includes(t.name);
          return (
            <button
              key={t.name}
              type="button"
              role="option"
              aria-selected={multi ? isOn : i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => onPick(t.name)}
              className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded text-left text-xs font-mono ${
                i === active ? "bg-hover" : ""
              } text-fg`}
            >
              <span className="truncate">{t.name}</span>
              {isOn ? (
                <Check className="w-3.5 h-3.5 text-accent-text shrink-0" />
              ) : (
                t.table_type && <span className="text-[11px] text-fg-subtle font-sans shrink-0">{t.table_type}</span>
              )}
            </button>
          );
        })}
        {shown.length === 0 && <p className="p-3 text-center text-xs text-fg-subtle">No hay tablas con ese nombre.</p>}
      </div>
    </div>
  );
}
