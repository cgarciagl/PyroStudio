import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown } from "lucide-react";
import { MAX_FONT_SIZE, MIN_FONT_SIZE } from "../../stores/preferenceStore";
import { menuItem } from "./styles";

interface FontSizeComboProps {
  value: number;
  /** Preset sizes listed in the dropdown. */
  presets: number[];
  /** Size restored by the "default" entry; marked in the list. */
  defaultSize: number;
  onChange: (size: number) => void;
  /** Accepted range; font sizes in px by default. */
  min?: number;
  max?: number;
  /** Unit shown after the number ("px", "%"). */
  unit?: string;
  /** Accessible label / tooltip of the input; defaults to the px font size label. */
  inputLabel?: string;
}

/**
 * Editable size: type any value (clamped to min..max) or pick a preset.
 * The typed value is applied on Enter or blur; arrows step it by 1.
 */
export function FontSizeCombo({
  value,
  presets,
  defaultSize,
  onChange,
  min = MIN_FONT_SIZE,
  max = MAX_FONT_SIZE,
  unit = "px",
  inputLabel,
}: FontSizeComboProps) {
  const { t } = useTranslation("settings");
  const label = inputLabel ?? t("appearance.fontSizeInput", { min, max });
  const [text, setText] = useState(String(value));
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Follow outside changes (Ctrl/Cmd + / - zoom, presets).
  useEffect(() => setText(String(value)), [value]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const commit = (raw: string) => {
    const n = Number(raw.trim());
    if (raw.trim() === "" || !Number.isFinite(n)) {
      setText(String(value));
      return;
    }
    const size = Math.min(max, Math.max(min, Math.round(n)));
    setText(String(size));
    if (size !== value) onChange(size);
  };

  const pick = (size: number) => {
    setOpen(false);
    setText(String(size));
    if (size !== value) onChange(size);
  };

  const sizes = Array.from(new Set([...presets, defaultSize])).sort((a, b) => a - b);

  return (
    <div
      ref={rootRef}
      className="relative inline-flex items-center"
      data-font-size-combo
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <div className="inline-flex items-center rounded-md border border-line bg-canvas focus-within:border-accent transition-colors">
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          value={text}
          aria-label={label}
          title={label}
          className="w-14 pl-2.5 py-1.5 bg-transparent text-xs font-mono text-fg focus:outline-none"
          onChange={(e) => {
            const raw = e.target.value;
            setText(raw);
            // Spinner arrows and ArrowUp/Down produce in-range values: apply at once.
            if (raw.trim() === "") return;
            const n = Number(raw);
            if (Number.isInteger(n) && n >= min && n <= max && n !== value) onChange(n);
          }}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit((e.target as HTMLInputElement).value);
            } else if (e.key === "Escape") {
              if (open || text !== String(value)) {
                e.stopPropagation();
              }
              setOpen(false);
              setText(String(value));
            }
          }}
        />
        <span className="pr-1 text-[11px] text-fg-subtle select-none">{unit}</span>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          title={t("appearance.fontSizePresets")}
          onClick={() => setOpen((o) => !o)}
          className="px-1.5 py-1.5 border-l border-line text-fg-muted hover:text-fg hover:bg-hover rounded-r-md transition-colors"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>

      {open && (
        <ul
          role="listbox"
          className="absolute right-0 top-full mt-1 min-w-[10rem] rounded-lg border border-line bg-raised shadow-pop z-50 py-1 text-xs"
        >
          {sizes.map((size) => (
            <li key={size} role="option" aria-selected={size === value}>
              <button type="button" className={menuItem} onClick={() => pick(size)}>
                <Check className={`w-3.5 h-3.5 shrink-0 ${size === value ? "text-accent-text" : "invisible"}`} />
                <span className="font-mono">{size} {unit}</span>
                {size === defaultSize && (
                  <span className="ml-auto text-[11px] text-fg-subtle">{t("appearance.fontSizeDefault")}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
