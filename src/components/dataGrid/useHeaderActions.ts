import React, { useCallback } from "react";
import { CompactSelection, type GridSelection, type HeaderClickedEventArgs, type Rectangle } from "@glideapps/glide-data-grid";
import type { TableDataResult, QueryExecutionResult } from "../../types/database";
import type { FilterRule } from "../VisualFilterBuilder";
import type { CellContextMenuState } from "./GridCellContextMenu";
import type { HeaderMenuState } from "./GridHeaderMenu";
import type { SaveStatus } from "./SaveStatusBadge";
import type { useTableDataLoader } from "./useTableDataLoader";

type SortDirection = "ASC" | "DESC" | null;

/** Header click cycles a column through ASC → DESC → unsorted. */
export function nextSortDirection(
  sortColumn: string | null,
  sortDirection: SortDirection,
  clicked: string,
): SortDirection {
  if (sortColumn !== clicked) return "ASC";
  if (sortDirection === "ASC") return "DESC";
  if (sortDirection === "DESC") return null;
  return "ASC";
}

interface HeaderActionsParams {
  autoSizeColumn: (colName: string) => void;
  dataResult: TableDataResult | null;
  effectiveColumnNames: string[];
  externalData: TableDataResult | QueryExecutionResult | null | undefined;
  infiniteScroll: boolean;
  isServerFilterActive: boolean;
  lastMousePosRef: React.MutableRefObject<{ x: number; y: number }>;
  loadData: ReturnType<typeof useTableDataLoader>["loadData"];
  pageSize: number;
  resetColumnWidths: () => void;
  serverFilter: string;
  setCellContextMenu: React.Dispatch<React.SetStateAction<CellContextMenuState | null>>;
  setFilterRules: React.Dispatch<React.SetStateAction<FilterRule[]>>;
  setGridSelection: React.Dispatch<React.SetStateAction<GridSelection | undefined>>;
  setHeaderMenu: React.Dispatch<React.SetStateAction<HeaderMenuState | null>>;
  setIsFilterBuilderOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setPageOffset: React.Dispatch<React.SetStateAction<number>>;
  setSaveStatus: React.Dispatch<React.SetStateAction<SaveStatus | null>>;
  setSelectedCell: React.Dispatch<React.SetStateAction<{ col: number; row: number } | null>>;
  setSelectedRowIndex: React.Dispatch<React.SetStateAction<number | null>>;
  setSortColumn: React.Dispatch<React.SetStateAction<string | null>>;
  setSortDirection: React.Dispatch<React.SetStateAction<SortDirection>>;
  sortColumn: string | null;
  sortDirection: SortDirection;
  toggleFreezeColumn: (colIndex: number) => void;
}

/**
 * Column header interactions: select a whole column, sort (click or menu),
 * width/freeze menu actions, filter by column, copy its name and open the menu.
 */
export function useHeaderActions({
  autoSizeColumn,
  dataResult,
  effectiveColumnNames,
  externalData,
  infiniteScroll,
  isServerFilterActive,
  lastMousePosRef,
  loadData,
  pageSize,
  resetColumnWidths,
  serverFilter,
  setCellContextMenu,
  setFilterRules,
  setGridSelection,
  setHeaderMenu,
  setIsFilterBuilderOpen,
  setPageOffset,
  setSaveStatus,
  setSelectedCell,
  setSelectedRowIndex,
  setSortColumn,
  setSortDirection,
  sortColumn,
  sortDirection,
  toggleFreezeColumn,
}: HeaderActionsParams) {
  const handleSelectColumn = useCallback(
    (colIndex: number) => {
      if (colIndex < 0 || colIndex >= effectiveColumnNames.length) return;
      const rowCount = dataResult?.rows?.length ?? 0;
      if (rowCount === 0) return;

      setGridSelection({
        columns: CompactSelection.fromSingleSelection(colIndex),
        rows: CompactSelection.empty(),
        current: {
          cell: [colIndex, 0],
          range: {
            x: colIndex,
            y: 0,
            width: 1,
            height: rowCount,
          },
          rangeStack: [],
        },
      });
      setSelectedCell({ col: colIndex, row: 0 });
      setSelectedRowIndex(0);
      setHeaderMenu(null);
      setCellContextMenu(null);
    },
    [effectiveColumnNames.length, dataResult?.rows?.length],
  );

  const handleHeaderClicked = useCallback(
    (colIndex: number) => {
      const colName = effectiveColumnNames[colIndex];
      if (!dataResult || !colName) return;

      const nextDir = nextSortDirection(sortColumn, sortDirection, colName);

      setSortColumn(nextDir ? colName : null);
      setSortDirection(nextDir);
      setPageOffset(0);

      if (!externalData) {
        loadData(
          0,
          infiniteScroll ? 500 : pageSize,
          nextDir ? colName : null,
          nextDir,
          isServerFilterActive ? serverFilter : null,
          true,
        );
      }
    },
    [
      dataResult,
      effectiveColumnNames,
      sortColumn,
      sortDirection,
      externalData,
      pageSize,
      isServerFilterActive,
      serverFilter,
      infiniteScroll,
      loadData,
    ],
  );

  const handleSortFromMenu = useCallback(
    (colName: string, dir: "ASC" | "DESC" | null) => {
      setSortColumn(dir ? colName : null);
      setSortDirection(dir);
      setPageOffset(0);
      if (!externalData) {
        loadData(
          0,
          infiniteScroll ? 500 : pageSize,
          dir ? colName : null,
          dir,
          isServerFilterActive ? serverFilter : null,
          true,
        );
      }
      setHeaderMenu(null);
    },
    [externalData, pageSize, isServerFilterActive, serverFilter, infiniteScroll, loadData],
  );

  const handleAutoSizeColumn = useCallback(
    (colName: string) => {
      autoSizeColumn(colName);
      setHeaderMenu(null);
    },
    [autoSizeColumn],
  );

  const handleResetColumnWidths = useCallback(() => {
    resetColumnWidths();
    setHeaderMenu(null);
  }, [resetColumnWidths]);

  const handleToggleFreezeColumn = useCallback(
    (colIndex: number) => {
      toggleFreezeColumn(colIndex);
      setHeaderMenu(null);
    },
    [toggleFreezeColumn],
  );

  const handleFilterByColumn = useCallback((colName: string) => {
    setFilterRules((prev) => {
      const exists = prev.find((r) => r.column === colName);
      if (exists) return prev;
      return [
        ...prev,
        {
          id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          enabled: true,
          column: colName,
          operator: "=",
          value: "",
          connector: "AND",
        },
      ];
    });
    setIsFilterBuilderOpen(true);
    setHeaderMenu(null);
  }, []);

  const handleCopyColumnName = useCallback((colName: string) => {
    navigator.clipboard.writeText(colName);
    setSaveStatus({
      success: true,
      message: `Nombre de columna '${colName}' copiado al portapapeles.`,
    });
    setTimeout(() => setSaveStatus(null), 2500);
    setHeaderMenu(null);
  }, []);

  const handleHeaderMenuClick = useCallback(
    (col: number, screenPosition: Rectangle) => {
      const colName = effectiveColumnNames[col];
      if (!colName) return;
      setHeaderMenu({
        col,
        colName,
        x: Math.min(screenPosition.x, window.innerWidth - 230),
        y: Math.min(screenPosition.y + screenPosition.height, window.innerHeight - 270),
      });
    },
    [effectiveColumnNames],
  );

  const handleHeaderContextMenu = useCallback(
    (colIndex: number, event: HeaderClickedEventArgs) => {
      event.preventDefault();
      const colName = effectiveColumnNames[colIndex];
      if (!colName) return;
      const x = lastMousePosRef.current.x;
      const y = lastMousePosRef.current.y;
      setHeaderMenu({
        col: colIndex,
        colName,
        x: Math.min(x, window.innerWidth - 230),
        y: Math.min(y, window.innerHeight - 270),
      });
    },
    [effectiveColumnNames],
  );

  return {
    handleSelectColumn,
    handleHeaderClicked,
    handleSortFromMenu,
    handleAutoSizeColumn,
    handleResetColumnWidths,
    handleToggleFreezeColumn,
    handleFilterByColumn,
    handleCopyColumnName,
    handleHeaderMenuClick,
    handleHeaderContextMenu,
  };
}
