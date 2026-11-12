import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Search } from "lucide-react";

export interface PickerItem {
  id: string;
  label: string;
  group?: string;
  hint?: string;
}

interface PickerMenuProps {
  anchor: HTMLElement;
  items: PickerItem[];
  selectedId?: string;
  /** Show a search box (columns); short lists (operators) do without. */
  searchable?: boolean;
  placeholder?: string;
  mono?: boolean;
  onPick: (id: string) => void;
  onClose: () => void;
}

const WIDTH = 240;
const MAX_H = 300;

/**
 * One floating list for every picker of the filter (column, operator, sort column):
 * placed under (or above) its button, never clipped, searchable, grouped and usable from
 * the keyboard. It replaces three near-identical hand-positioned menus.
 */
export function PickerMenu({ anchor, items, selectedId, searchable, placeholder, mono, onPick, onClose }: PickerMenuProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0, top: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items;
  }, [items, query]);

  useEffect(() => {
    const i = shown.findIndex((x) => x.id === selectedId);
    setActive(i >= 0 ? i : 0);
  }, [shown, selectedId]);

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const up = window.innerHeight - r.bottom < MAX_H && r.top > MAX_H;
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 8)),
      ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    });
  }, [anchor]);

  useEffect(() => {
    const outside = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    // Scrolling the grid moves the anchor: close instead of floating in the wrong place.
    const onScroll = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", outside);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", outside);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [anchor, onClose]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // Without a search box the list itself takes the focus, so the keys work right away.
  useEffect(() => {
    if (!searchable) ref.current?.focus();
  }, [searchable]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      anchor.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, Math.min(shown.length - 1, i + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Enter" && shown[active]) {
      e.preventDefault();
      onPick(shown[active].id);
      anchor.focus();
    }
  };

  let lastGroup: string | undefined;
  return createPortal(
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      onKeyDown={onKey}
      style={{ position: "fixed", width: WIDTH, maxHeight: MAX_H, zIndex: 9999, ...pos }}
      className="flex flex-col rounded-lg border border-line bg-raised shadow-pop text-xs outline-none"
    >
      {searchable && (
        <div className="p-1.5 border-b border-line">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-canvas border border-line focus-within:border-accent">
            <Search className="w-3 h-3 text-fg-subtle shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              aria-label={placeholder}
              className="w-full bg-transparent outline-none text-xs text-fg placeholder:text-fg-subtle"
            />
          </div>
        </div>
      )}
      <div ref={listRef} role="listbox" className="overflow-y-auto py-1">
        {shown.map((item, i) => {
          const header = item.group && item.group !== lastGroup ? item.group : null;
          lastGroup = item.group;
          const selected = item.id === selectedId;
          return (
            <div key={item.id}>
              {header && <div className="px-3 pt-2 pb-0.5 text-[11px] font-medium text-fg-subtle">{header}</div>}
              <button
                type="button"
                role="option"
                aria-selected={selected}
                data-index={i}
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  onPick(item.id);
                  anchor.focus();
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left ${i === active ? "bg-hover" : ""} ${
                  mono ? "font-mono" : ""
                } ${selected ? "text-fg font-medium" : "text-fg"}`}
              >
                <span className="truncate">{item.label}</span>
                {selected ? (
                  <Check className="w-3.5 h-3.5 text-accent-text shrink-0" />
                ) : (
                  item.hint && <span className="text-[11px] text-fg-subtle font-mono shrink-0">{item.hint}</span>
                )}
              </button>
            </div>
          );
        })}
        {shown.length === 0 && <p className="px-3 py-3 text-center text-fg-subtle">Sin coincidencias.</p>}
      </div>
    </div>,
    document.body,
  );
}
