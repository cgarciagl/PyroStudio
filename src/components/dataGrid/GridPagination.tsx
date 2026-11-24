import React from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Loader2 } from "lucide-react";

const PAGE_SIZES = [50, 100, 250, 500, 1000, 5000];

export interface GridPaginationProps {
  isExternal: boolean;
  infiniteScroll: boolean;
  loadedRows: number;
  totalRowsLabel: string;
  totalRowsCount: number;
  exactCountControl: React.ReactNode;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  pageOffset: number;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  onGoToOffset: (offset: number) => void;
  onSwitchToPages: () => void;
  onSwitchToInfinite: () => void;
}

/** Paging controls, continuous-scroll status or the row count of query results. */
export const GridPagination: React.FC<GridPaginationProps> = ({
  isExternal,
  infiniteScroll,
  loadedRows,
  totalRowsLabel,
  totalRowsCount,
  exactCountControl,
  isLoading,
  isLoadingMore,
  hasMore,
  pageOffset,
  pageSize,
  onPageSizeChange,
  onGoToOffset,
  onSwitchToPages,
  onSwitchToInfinite,
}) => {
  const { t } = useTranslation("dataGrid");

  if (isExternal) {
    return (
      <div className="flex items-center space-x-2 text-fg-muted font-mono text-xs px-2">
        <span>{t("pagination.loadedExternal", { count: loadedRows })}</span>
      </div>
    );
  }

  if (infiniteScroll) {
    return (
      <div className="flex items-center space-x-2 font-mono text-xs">
        <span className="text-fg-muted px-1.5 whitespace-nowrap">
          {t("pagination.loadedInfinite", { loaded: loadedRows.toLocaleString(), total: totalRowsLabel })}
        </span>
        {exactCountControl}
        {isLoadingMore && (
          <span className="flex items-center text-accent-text gap-1 text-[11px]">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>{t("pagination.loadingMore")}</span>
          </span>
        )}
        {!hasMore && loadedRows > 0 && !isLoadingMore && (
          <span className="text-fg-subtle text-[11px] hidden sm:inline">
            {t("pagination.allLoaded")}
          </span>
        )}
        <button
          type="button"
          onClick={onSwitchToPages}
          title={t("pagination.pagesBtnTooltip")}
          className="px-2 py-0.5 rounded text-[11px] text-fg-muted hover:text-fg hover:bg-hover border border-line transition-colors ml-1"
        >
          {t("pagination.pagesBtn")}
        </button>
      </div>
    );
  }

  const currentStart = totalRowsCount > 0 ? pageOffset + 1 : 0;
  const currentEnd = Math.min(pageOffset + pageSize, totalRowsCount);
  const totalPages = Math.ceil(totalRowsCount / pageSize) || 1;
  const currentPage = Math.floor(pageOffset / pageSize) + 1;
  const lastPageOffset = Math.max(0, (totalPages - 1) * pageSize);
  const navBtn =
    "p-1 rounded text-fg-muted hover:text-fg hover:bg-hover disabled:opacity-30 disabled:pointer-events-none transition-colors";

  return (
    <div className="flex items-center space-x-1.5">
      <select
        value={pageSize}
        onChange={(e) => onPageSizeChange(parseInt(e.target.value, 10))}
        title={t("pagination.pageSizeTooltip")}
        className="px-1.5 py-1 bg-transparent rounded text-fg-muted hover:bg-hover font-mono text-xs focus:outline-none"
      >
        {PAGE_SIZES.map((size) => (
          <option key={size} value={size}>
            {t("pagination.pageSizeOption", { count: size.toLocaleString("en-US") as unknown as number })}
          </option>
        ))}
      </select>

      <button
        onClick={() => onGoToOffset(0)}
        disabled={pageOffset === 0 || isLoading}
        title={t("pagination.firstPage")}
        className={navBtn}
      >
        <ChevronsLeft className="w-4 h-4" />
      </button>

      <button
        onClick={() => onGoToOffset(Math.max(0, pageOffset - pageSize))}
        disabled={pageOffset === 0 || isLoading}
        title={t("pagination.prevPage")}
        className={navBtn}
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      <span className="text-fg-muted font-mono text-xs px-2 whitespace-nowrap">
        {t("pagination.rangeOf", {
          start: currentStart,
          end: currentEnd,
          total: totalRowsCount.toLocaleString(),
          page: currentPage,
          pages: totalPages,
        })}
      </span>

      <button
        onClick={() => onGoToOffset(pageOffset + pageSize)}
        disabled={pageOffset + pageSize >= totalRowsCount || isLoading}
        title={t("pagination.nextPage")}
        className={navBtn}
      >
        <ChevronRight className="w-4 h-4" />
      </button>

      <button
        onClick={() => onGoToOffset(lastPageOffset)}
        disabled={pageOffset >= lastPageOffset || isLoading}
        title={t("pagination.lastPage")}
        className={navBtn}
      >
        <ChevronsRight className="w-4 h-4" />
      </button>

      <button
        type="button"
        onClick={onSwitchToInfinite}
        title={t("pagination.infiniteBtnTooltip")}
        className="px-2 py-0.5 rounded text-[11px] text-fg-muted hover:text-fg hover:bg-hover border border-line transition-colors ml-1"
      >
        {t("pagination.infiniteBtn")}
      </button>
    </div>
  );
};
