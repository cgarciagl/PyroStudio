import React from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
  CheckSquare,
  Copy,
  Filter,
  Maximize2,
  Pin,
  PinOff,
  RotateCcw,
} from "lucide-react";

export interface HeaderMenuState {
  col: number;
  colName: string;
  x: number;
  y: number;
}

export interface GridHeaderMenuProps {
  headerMenu: HeaderMenuState;
  setHeaderMenu: (menu: HeaderMenuState | null) => void;
  handleSelectColumn: (colIndex: number) => void;
  handleSortFromMenu: (colName: string, dir: "ASC" | "DESC" | null) => void;
  sortColumn: string | null;
  handleAutoSizeColumn: (colName: string) => void;
  customWidths: Record<string, number>;
  handleResetColumnWidths: () => void;
  handleToggleFreezeColumn: (colIndex: number) => void;
  freezeColumnsCount: number;
  handleCopyColumnName: (colName: string) => void;
  externalData: unknown;
  handleFilterByColumn: (colName: string) => void;
}

/** Column header dropdown: selection, sorting, widths, freezing and filters. */
export const GridHeaderMenu: React.FC<GridHeaderMenuProps> = ({
  headerMenu,
  setHeaderMenu,
  handleSelectColumn,
  handleSortFromMenu,
  sortColumn,
  handleAutoSizeColumn,
  customWidths,
  handleResetColumnWidths,
  handleToggleFreezeColumn,
  freezeColumnsCount,
  handleCopyColumnName,
  externalData,
  handleFilterByColumn,
}) => {
  const { t } = useTranslation("dataGrid");

  return (
    <div
      style={{ top: headerMenu.y, left: headerMenu.x }}
      onClick={(e) => e.stopPropagation()}
      className={`fixed z-50 w-56 rounded-xl border shadow-2xl py-1.5 text-xs font-sans animate-in fade-in duration-100 bg-raised border-line text-fg`}
    >
      <div className="px-3 py-1 text-[11px] font-semibold text-fg-muted border-b border-line/60 truncate">
        {t("headerMenu.columnPrefix")}<span className="text-accent-text font-mono">{headerMenu.colName}</span>
      </div>

      <button
        type="button"
        onClick={() => {
          handleSelectColumn(headerMenu.col);
          setHeaderMenu(null);
        }}
        className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-hover hover:text-accent-text transition-colors"
      >
        <CheckSquare className="w-3.5 h-3.5 text-fg-muted" />
        <span>{t("headerMenu.selectColumn")}</span>
      </button>

      <button
        type="button"
        onClick={() => handleSortFromMenu(headerMenu.colName, "ASC")}
        className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-hover hover:text-accent-text transition-colors"
      >
        <ArrowUp className="w-3.5 h-3.5 text-fg-muted" />
        <span>{t("headerMenu.sortAsc")}</span>
      </button>

      <button
        type="button"
        onClick={() => handleSortFromMenu(headerMenu.colName, "DESC")}
        className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-hover hover:text-accent-text transition-colors"
      >
        <ArrowDown className="w-3.5 h-3.5 text-fg-muted" />
        <span>{t("headerMenu.sortDesc")}</span>
      </button>

      {sortColumn === headerMenu.colName && (
        <button
          type="button"
          onClick={() => handleSortFromMenu(headerMenu.colName, null)}
          className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-hover hover:text-accent-text transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5 text-fg-muted" />
          <span>{t("headerMenu.clearSort")}</span>
        </button>
      )}

      <div className="my-1 border-t border-line/60" />

      <button
        type="button"
        onClick={() => handleAutoSizeColumn(headerMenu.colName)}
        className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-hover hover:text-accent-text transition-colors"
      >
        <Maximize2 className="w-3.5 h-3.5 text-fg-muted" />
        <span>{t("headerMenu.autoSize")}</span>
      </button>

      {Object.keys(customWidths).length > 0 && (
        <button
          type="button"
          onClick={handleResetColumnWidths}
          className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-hover hover:text-accent-text transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5 text-fg-muted" />
          <span>{t("headerMenu.resetWidths")}</span>
        </button>
      )}

      <div className="my-1 border-t border-line/60" />

      <button
        type="button"
        onClick={() => handleToggleFreezeColumn(headerMenu.col)}
        className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-hover hover:text-accent-text transition-colors"
      >
        {freezeColumnsCount === headerMenu.col + 1 ? (
          <>
            <PinOff className="w-3.5 h-3.5 text-fg-muted" />
            <span>{t("headerMenu.unfreeze")}</span>
          </>
        ) : (
          <>
            <Pin className="w-3.5 h-3.5 text-fg-muted" />
            <span>{t("headerMenu.freezeUpTo")}</span>
          </>
        )}
      </button>

      <div className="my-1 border-t border-line/60" />

      <button
        type="button"
        onClick={() => handleCopyColumnName(headerMenu.colName)}
        className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-hover hover:text-accent-text transition-colors"
      >
        <Copy className="w-3.5 h-3.5 text-fg-muted" />
        <span>{t("headerMenu.copyName")}</span>
      </button>

      {!externalData && (
        <button
          type="button"
          onClick={() => handleFilterByColumn(headerMenu.colName)}
          className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-hover hover:text-accent-text transition-colors"
        >
          <Filter className="w-3.5 h-3.5 text-fg-muted" />
          <span>{t("headerMenu.filterByColumn")}</span>
        </button>
      )}
    </div>
  );
};
