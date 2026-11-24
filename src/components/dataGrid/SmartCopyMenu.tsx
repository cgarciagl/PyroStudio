import React from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Copy } from "lucide-react";
import type { SmartCopyFormat } from "./copyFormats";

export interface SmartCopyMenuProps {
  isOpen: boolean;
  onToggle: () => void;
  /** Number of rows in the current selection (shown in the menu header). */
  getRowCount: () => number;
  onCopy: (format: SmartCopyFormat) => void;
}

/** Toolbar dropdown that copies the selected range in several formats. */
export const SmartCopyMenu: React.FC<SmartCopyMenuProps> = ({ isOpen, onToggle, getRowCount, onCopy }) => {
  const { t } = useTranslation("dataGrid");

  const formats: { format: SmartCopyFormat; label: string; hint: string }[] = [
    { format: "tsv", label: t("smartCopy.tsv"), hint: "Ctrl+Shift+C" },
    { format: "comma", label: t("smartCopy.comma"), hint: "'a', 1" },
    { format: "sql", label: t("smartCopy.sql"), hint: ".sql" },
    { format: "json", label: t("smartCopy.json"), hint: "[{}]" },
    { format: "markdown", label: t("smartCopy.markdown"), hint: "|---|" },
    { format: "php", label: t("smartCopy.php"), hint: "['=>']" },
    { format: "ts", label: t("smartCopy.ts"), hint: "Record<>" },
  ];

  return (
  <div className="relative">
    <button
      onClick={onToggle}
      title={t("smartCopy.tooltip")}
      className="flex items-center space-x-1.5 px-2.5 py-1 rounded text-fg hover:text-fg hover:bg-hover transition-colors text-xs animate-in fade-in duration-150"
    >
      <Copy className="w-3 h-3" />
      <span>{t("smartCopy.copy")}</span>
      <ChevronDown className="w-3 h-3 text-fg-muted" />
    </button>

    {isOpen && (
      <div
      className={`absolute left-0 mt-1.5 w-52 rounded-xl border shadow-2xl z-50 py-1.5 text-xs animate-in fade-in duration-150 bg-raised border-line`}
      >
        <div className="px-3 py-1 text-[11px] font-mono text-fg-muted border-b border-line">
          {t("smartCopy.header", { count: getRowCount() })}
        </div>
        {formats.map(({ format, label, hint }) => (
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
};
