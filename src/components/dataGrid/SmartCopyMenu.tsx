import React from "react";
import { ChevronDown, Copy } from "lucide-react";
import type { SmartCopyFormat } from "./copyFormats";

const FORMATS: { format: SmartCopyFormat; label: string; hint: string }[] = [
  { format: "tsv", label: "TSV (Excel / Sheets)", hint: "Ctrl+Shift+C" },
  { format: "comma", label: "Valores separados por comas", hint: "'a', 1" },
  { format: "sql", label: "SQL INSERT INTO", hint: ".sql" },
  { format: "json", label: "JSON Array", hint: "[{}]" },
  { format: "markdown", label: "Markdown Table", hint: "|---|" },
  { format: "php", label: "PHP Associative Array", hint: "['=>']" },
  { format: "ts", label: "TypeScript Array", hint: "Record<>" },
];

export interface SmartCopyMenuProps {
  isOpen: boolean;
  onToggle: () => void;
  /** Number of rows in the current selection (shown in the menu header). */
  getRowCount: () => number;
  onCopy: (format: SmartCopyFormat) => void;
}

/** Toolbar dropdown that copies the selected range in several formats. */
export const SmartCopyMenu: React.FC<SmartCopyMenuProps> = ({ isOpen, onToggle, getRowCount, onCopy }) => (
  <div className="relative">
    <button
      onClick={onToggle}
      title="Copiar celdas seleccionadas en múltiples formatos (TSV, SQL, JSON, Markdown, etc.) (Ctrl+Shift+C)"
      className="flex items-center space-x-1.5 px-2.5 py-1 rounded text-fg hover:text-fg hover:bg-hover transition-colors text-xs animate-in fade-in duration-150"
    >
      <Copy className="w-3 h-3" />
      <span>Copiar</span>
      <ChevronDown className="w-3 h-3 text-fg-muted" />
    </button>

    {isOpen && (
      <div
      className={`absolute left-0 mt-1.5 w-52 rounded-xl border shadow-2xl z-50 py-1.5 text-xs animate-in fade-in duration-150 bg-raised border-line`}
      >
        <div className="px-3 py-1 text-[11px] font-mono text-fg-muted border-b border-line">
          Exportar Selección ({getRowCount()} filas)
        </div>
        {FORMATS.map(({ format, label, hint }) => (
          <button
            key={format}
            type="button"
            onClick={() => onCopy(format)}
            className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-hover text-fg transition-colors"
          >
            <span>{label}</span>
            <span className="text-[11px] text-fg-subtle font-mono">{hint}</span>
          </button>
        ))}
      </div>
    )}
  </div>
);
