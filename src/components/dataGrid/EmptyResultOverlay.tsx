import React from "react";
import { useTranslation } from "react-i18next";
import { Database } from "lucide-react";

export interface EmptyResultOverlayProps {
  searchTerm: string;
  isQueryResult: boolean;
  columnCount: number;
  /** Execution time of a query result; omitted for tables. */
  executionTimeMs?: number;
  onClearSearch: () => void;
}

/** Overlay shown over the column headers when there are no rows to display. */
export const EmptyResultOverlay: React.FC<EmptyResultOverlayProps> = ({
  searchTerm,
  isQueryResult,
  columnCount,
  executionTimeMs,
  onClearSearch,
}) => {
  const { t } = useTranslation("dataGrid");

  return (
  <div className="absolute inset-x-0 top-[37px] bottom-0 z-10 flex items-center justify-center p-6 pointer-events-none select-none">
    <div
    className={`max-w-md w-full rounded-xl border p-6 flex flex-col items-center text-center shadow-pop pointer-events-auto transition-all animate-in fade-in zoom-in-95 duration-150 bg-raised border-line text-fg`}
    >
      <div
        className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-3 border bg-raised border-line text-fg-muted`}
      >
        <Database className="w-6 h-6" />
      </div>

      <h3 className={`text-sm font-bold font-sans text-fg`}>
        {searchTerm ? t("emptyOverlay.noMatchesTitle") : t("emptyOverlay.zeroRowsTitle")}
      </h3>

      <p className={`text-xs mt-1.5 max-w-xs leading-relaxed text-fg-muted`}>
        {searchTerm
          ? t("emptyOverlay.noMatchesDesc", { term: searchTerm })
          : isQueryResult
          ? t("emptyOverlay.queryEmptyDesc")
          : t("emptyOverlay.tableEmptyDesc")}
      </p>

      {/* Status & Timing Metadata Badges */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <span
        className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono border bg-elevated border-line-strong text-fg`}
        >
          {t("emptyOverlay.columnsCount", { count: columnCount })}
        </span>

        {executionTimeMs !== undefined && (
          <span
            className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono border border-line text-fg-muted`}
          >
            ⚡ {executionTimeMs} ms
          </span>
        )}
      </div>

      {searchTerm && (
        <button
          type="button"
          onClick={onClearSearch}
          className="mt-4 px-3 py-1 rounded-lg text-xs font-medium bg-accent hover:bg-accent-hover text-accent-fg transition-colors cursor-pointer"
        >
          {t("emptyOverlay.clearSearch")}
        </button>
      )}
    </div>
  </div>
  );
};
