import React, { useCallback, useMemo, useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  GridCellKind,
  GridColumn,
  EditableGridCell,
  GridSelection,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import type {
  TableDataResult,
  QueryExecutionResult,
} from "../types/database";
import { useConnectionStore } from "../stores/connectionStore";
import { gridMetricsFor, usePreferenceStore } from "../stores/preferenceStore";
import { CellInspectorDrawer } from "./CellInspectorDrawer";
import { useDockWidth, useIsWideLayout } from "./ui/RightDock";
import {
  type PasteValidationResult,
} from "../utils/pasteParser";

import { copySelectionToClipboard, type SmartCopyFormat } from "./dataGrid/copyFormats";
import { useTableKeys } from "./dataGrid/useTableKeys";
import { useColumnLayout } from "./dataGrid/useColumnLayout";
import { useGridEditing } from "./dataGrid/useGridEditing";
import { useCellContent } from "./dataGrid/useCellContent";
import { useForeignKeyNavigation } from "./dataGrid/useForeignKeyNavigation";
import { dispatchGridKeyDown } from "./dataGrid/keyboard";
import { buildGridTheme } from "./dataGrid/gridTheme";
import { useHeaderActions } from "./dataGrid/useHeaderActions";
import { NoPrimaryKeyNotice } from "./dataGrid/NoPrimaryKeyNotice";
import { GridToolbarActions } from "./dataGrid/GridToolbarActions";
import { GridOverlays } from "./dataGrid/GridOverlays";
import { GridViewport } from "./dataGrid/GridViewport";
import { ExactCountControl } from "./dataGrid/ExactCountControl";
import { useLastPointerPosition } from "./dataGrid/useLastPointerPosition";
import { GridPagination } from "./dataGrid/GridPagination";
import { SaveStatusBadge } from "./dataGrid/SaveStatusBadge";
import {
  buildGridColumns,
  filterRowsByRules,
  normalizeExternalData,
  searchRows,
  sortRowsClient,
} from "./dataGrid/gridRows";
import { rowKeyOf } from "./dataGrid/rowIdentity";
import { useDismissOnOutsideClick } from "./dataGrid/useDismissOnOutsideClick";
import { useStagedTableChanges } from "./dataGrid/useStagedTableChanges";
import { useTableDataLoader } from "./dataGrid/useTableDataLoader";
import { useSqlLiteralRules } from "../services/sqlLiterals";
import {
  VisualFilterBuilder,
  type FilterRule,
  type SortRule,
} from "./VisualFilterBuilder";
import { uid } from "../utils/uid";

export { getStoredLayout, saveStoredLayout, type TableGridLayout } from "./dataGrid/layout";
export { formatCellDisplay, MAX_CANVAS_TEXT_LENGTH } from "./dataGrid/cellFormat";


export interface DataGridCanvasProps {
  database: string;
  table?: string;
  primaryKeyColumns?: string[];
  primaryKeyColumn?: string;

  // External data mode (e.g. for QueryEditorTab)
  externalData?: TableDataResult | QueryExecutionResult | null;
  onRefresh?: () => void;
  isReadonly?: boolean;
  extraToolbarActions?: React.ReactNode;
  /** WHERE condition active on the first load (foreign key jumps). */
  initialServerFilter?: string;
}

export const DataGridCanvas: React.FC<DataGridCanvasProps> = ({
  database,
  table = "",
  primaryKeyColumns,
  primaryKeyColumn,
  externalData,
  onRefresh,
  isReadonly = false,
  extraToolbarActions,
  initialServerFilter,
}) => {
  const { t } = useTranslation("dataGrid");
  const {
    defaultPageSize,
    noPrimaryKeyMode,
    theme,
    gridDensity,
    editorFontSize,
    infiniteScroll,
    setInfiniteScroll,
  } = usePreferenceStore();
  const densityMetrics = useMemo(
    () => gridMetricsFor(gridDensity, editorFontSize),
    [gridDensity, editorFontSize],
  );

  const activeFont =
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

  const [pageSize, setPageSize] = useState<number>(() => defaultPageSize || 100);
  const [pageOffset, setPageOffset] = useState<number>(0);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"ASC" | "DESC" | null>(null);
  const [serverFilter, setServerFilter] = useState<string>(initialServerFilter ?? "");
  const [isServerFilterActive, setIsServerFilterActive] = useState<boolean>(
    Boolean(initialServerFilter),
  );
  const {
    dataResult,
    setDataResult,
    isCountingRows,
    isLoading,
    hasMore,
    isLoadingMore,
    countExactRows,
    loadData,
    handleVisibleRegionChanged,
  } = useTableDataLoader({
    database,
    table,
    externalData,
    onRefresh,
    infiniteScroll,
    sortColumn,
    sortDirection,
    serverFilter,
    isServerFilterActive,
  });
  const [isFilterBuilderOpen, setIsFilterBuilderOpen] = useState<boolean>(false);
  const [filterRules, setFilterRules] = useState<FilterRule[]>([]);
  const [sortRules, setSortRules] = useState<SortRule[]>([]);

  // Initialize a default rule when the visual filter builder is opened if none exists
  useEffect(() => {
    if (
      isFilterBuilderOpen &&
      filterRules.length === 0 &&
      dataResult?.columns &&
      dataResult.columns.length > 0
    ) {
      setFilterRules([
        {
          id: `rule_${uid()}`,
          enabled: true,
          column: dataResult.columns[0],
          operator: "=",
          value: "",
          connector: "AND",
        },
      ]);
    }
  }, [isFilterBuilderOpen, filterRules.length, dataResult?.columns]);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ col: number; row: number } | null>(null);
  const [gridSelection, setGridSelection] = useState<GridSelection | undefined>(undefined);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isNewRecordModalOpen, setIsNewRecordModalOpen] = useState(false);
  const [isPreviewSqlOpen, setIsPreviewSqlOpen] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const isWideLayout = useIsWideLayout();
  const [inspectorWidth, setInspectorWidth] = useDockWidth("pyro_inspector_width", 460);
  const [isRecordPanelOpen, setIsRecordPanelOpen] = useState(false);
  const [isCopyMenuOpen, setIsCopyMenuOpen] = useState(false);
  const [isFillModalOpen, setIsFillModalOpen] = useState(false);
  const [isApplyingStaged, setIsApplyingStaged] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{
    success?: boolean;
    message?: string;
  } | null>(null);
  const [pendingPasteValidation, setPendingPasteValidation] =
    useState<PasteValidationResult | null>(null);
  const [cellContextMenu, setCellContextMenu] = useState<{
    x: number;
    y: number;
    col: number;
    row: number;
  } | null>(null);
  const [isCopySubmenuOpen, setIsCopySubmenuOpen] = useState(false);
  const lastMousePosRef = useLastPointerPosition();

  const [headerMenu, setHeaderMenu] = useState<{
    col: number;
    colName: string;
    x: number;
    y: number;
  } | null>(null);

  // Synchronize external data (e.g. from QueryEditorTab)
  useEffect(() => {
    if (externalData) {
      setDataResult(normalizeExternalData(externalData));
      setPageOffset(0);
      setSelectedRowIndex(null);
      setSelectedCell(null);
    }
  }, [externalData]);

  // Close context menus on outside click or scroll
  const closeMenus = useCallback(() => {
    setCellContextMenu(null);
    setIsCopySubmenuOpen(false);
    setHeaderMenu(null);
  }, []);
  useDismissOnOutsideClick(Boolean(cellContextMenu || headerMenu), closeMenus);

  const {
    stagedChangeCount,
    stagedUpdatesMap,
    stagedDeletedRows,
    stageCellUpdate,
    stageBatchCellUpdates,
    stageBatchRowDeletes,
    clearTableChanges,
    generateSqlForTable,
  } = useStagedTableChanges(database, table);
  const dialect = useSqlLiteralRules();

  // Sync pageSize when defaultPageSize changes in preferences
  useEffect(() => {
    if (defaultPageSize && defaultPageSize !== pageSize) {
      setPageSize(defaultPageSize);
      setPageOffset(0);
    }
  }, [defaultPageSize]);

  // Page size or scroll mode changed (here or in the preferences): reload the first
  // page keeping the active sort and filter. Previously this went through the reset
  // effect below, which loaded twice and silently dropped the sort and the filter.
  const loadModeRef = useRef({ pageSize, infiniteScroll });
  useEffect(() => {
    const prev = loadModeRef.current;
    loadModeRef.current = { pageSize, infiniteScroll };
    if (prev.pageSize === pageSize && prev.infiniteScroll === infiniteScroll) return;
    if (externalData || !table) return;
    setPageOffset(0);
    setSelectedRowIndex(null);
    setSelectedCell(null);
    loadData(
      0,
      infiniteScroll ? 500 : pageSize,
      sortColumn,
      sortDirection,
      isServerFilterActive ? serverFilter : null,
      true,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize, infiniteScroll]);

  const { foreignKeys, referencingConstraints, fkByColumn, activePkColumns } = useTableKeys(
    database,
    table,
    primaryKeyColumns,
    primaryKeyColumn,
  );

  const hasPrimaryKey = activePkColumns.length > 0;
  // Read-only connections are enforced by the backend; the grid mirrors it.
  const connectionReadOnly = useConnectionStore((s) =>
    Boolean(s.connectionStatus.config?.read_only),
  );
  const isEditingAllowed =
    !isReadonly &&
    !connectionReadOnly &&
    (Boolean(table) && (hasPrimaryKey || noPrimaryKeyMode === "use_all_columns"));


  const handleClearServerFilter = useCallback(() => {
    setServerFilter("");
    setIsServerFilterActive(false);
    setFilterRules([]);
    setSortRules([]);
    setPageOffset(0);
    setSelectedRowIndex(null);
    setSelectedCell(null);
    loadData(0, pageSize, sortColumn, sortDirection, null);
  }, [pageSize, sortColumn, sortDirection, loadData]);

  const {
    effectiveColumnNames,
    getRawColIndex,
    customWidths,
    freezeColumnsCount,
    handleColumnResize,
    handleColumnMoved,
    autoSizeColumn,
    resetColumnWidths,
    toggleFreezeColumn,
  } = useColumnLayout(database, table, dataResult);

  const {
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
  } = useHeaderActions({
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
  });

  useEffect(() => {
    if (externalData) return;
    setPageOffset(0);
    setSelectedRowIndex(null);
    setSelectedCell(null);
    setSortColumn(null);
    setSortDirection(null);
    setServerFilter("");
    setIsServerFilterActive(false);
    if (table) {
      loadData(0, infiniteScroll ? 500 : pageSize, null, null, null, true);
    }
    // pageSize / infiniteScroll are handled by the effect above (keeps sort and filter).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [database, table, externalData]);

  // Columns definition for Glide Data Grid with smart width calculation, sort indicators & FK indicators
  const columns: GridColumn[] = useMemo(
    () =>
      buildGridColumns({
        dataResult,
        effectiveColumnNames,
        activePkColumns,
        fkByColumn,
        customWidths,
        sortColumn,
        sortDirection,
      }),
    [dataResult, effectiveColumnNames, activePkColumns, fkByColumn, customWidths, sortColumn, sortDirection],
  );

  // Client-side sorting for external data
  const sortedRows = useMemo(() => {
    if (!dataResult) return [];
    if (!externalData) return dataResult.rows;
    if (!sortColumn || !sortDirection) return dataResult.rows;

    const rawIdx = dataResult.columns.indexOf(sortColumn);
    if (rawIdx === -1) return dataResult.rows;
    return sortRowsClient(dataResult.rows, rawIdx, sortDirection);
  }, [dataResult, externalData, sortColumn, sortDirection]);

  // Filtered rows for client-side search in current batch and externalData filter rules
  const displayRows = useMemo(() => {
    if (!dataResult) return [];
    let baseRows = sortedRows;

    // In externalData mode (query results), evaluate visual filter rules in memory
    if (externalData && isServerFilterActive && filterRules.length > 0 && dataResult.columns) {
      baseRows = filterRowsByRules(baseRows, dataResult.columns, filterRules);
    }
    return searchRows(baseRows, searchTerm);
  }, [dataResult, sortedRows, searchTerm, externalData, isServerFilterActive, filterRules]);

  // Search and sorting reorder the visible rows: a selection by position would now
  // point at another record (inspector, record panel, Delete, fill…).
  const firstOrderRender = useRef(true);
  useEffect(() => {
    if (firstOrderRender.current) {
      firstOrderRender.current = false;
      return;
    }
    setSelectedRowIndex(null);
    setSelectedCell(null);
    setGridSelection(undefined);
  }, [searchTerm, sortColumn, sortDirection]);

  const isLight =
    theme === "light" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: light)").matches);

  // Glide Data Grid cell supplier callback with Staged Changes Visual Highlight
  const getCellContent = useCellContent({
    activeFont,
    fontSize: editorFontSize,
    dataResult,
    displayRows,
    effectiveColumnNames,
    getRawColIndex,
    isEditingAllowed,
    isLight,
    stagedDeletedRows,
    stagedUpdatesMap,
    activePkColumns,
  });

  const {
    onCellEdited,
    getSelectedCells,
    getSelectedDataMatrix,
    hasSelectionRange,
    handleApplyValueToSelection,
    handleSetCellNull,
    handlePaste,
    handleConfirmPaste,
    handleDelete,
    handleCellContextMenu,
    getSelectedRowIndices,
    handleStageDeleteRow,
    handleSaveRow,
    handleCreateRecord,
    handleApplyStagedChanges,
    handleDiscardStagedChanges,
  } = useGridEditing({
    database,
    table,
    dataResult,
    setDataResult,
    displayRows,
    effectiveColumnNames,
    getRawColIndex,
    activePkColumns,
    hasPrimaryKey,
    isEditingAllowed,
    noPrimaryKeyMode,
    dialect,
    gridSelection,
    setGridSelection,
    selectedCell,
    setSelectedCell,
    selectedRowIndex,
    setSelectedRowIndex,
    pendingPasteValidation,
    setPendingPasteValidation,
    setCellContextMenu,
    setIsApplyingStaged,
    setIsCopySubmenuOpen,
    setIsNewRecordModalOpen,
    setSaveStatus,
    lastMousePosRef,
    loadData,
    onRefresh,
    pageOffset,
    pageSize,
    stagedChangeCount,
    stageCellUpdate,
    stageBatchCellUpdates,
    stageBatchRowDeletes,
    clearTableChanges,
    generateSqlForTable,
  });
  const { getRowValueByName, handleForeignKeyJump, handleReferencingJump } = useForeignKeyNavigation({
    database,
    dialect,
    dataResult,
    displayRows,
    effectiveColumnNames,
    getRawColIndex,
    foreignKeys,
    fkByColumn,
  });

  const handleSmartCopy = (format: SmartCopyFormat) => {
    if (!dataResult) return;
    setIsCopyMenuOpen(false);
    const { columns: targetCols, rows: targetRows } = getSelectedDataMatrix();
    copySelectionToClipboard(
      format,
      targetCols,
      targetRows,
      { database, table: table || "query_result", dialect },
      setSaveStatus,
    );
  };

  const handleContainerKeyDown = (e: React.KeyboardEvent) =>
    dispatchGridKeyDown(
      e,
      { stagedChangeCount, hasSelectedCell: Boolean(selectedCell), gridSelection },
      {
        apply: handleApplyStagedChanges,
        discard: handleDiscardStagedChanges,
        copyTsv: () => handleSmartCopy("tsv"),
        inspect: () => setIsInspectorOpen(true),
        setNull: handleSetCellNull,
      },
    );

  // Pyro Theme for Glide Data Grid Canvas (Light / Dark)
  const pyroTheme = useMemo(
    () => buildGridTheme(isLight, activeFont, densityMetrics.padY, editorFontSize),
    [isLight, activeFont, densityMetrics, editorFontSize],
  );

  const totalRowsCount = dataResult?.total_rows ?? displayRows.length;
  const isTotalEstimated = Boolean(dataResult?.total_rows_estimated);
  const isTotalUnknown = dataResult?.total_rows === undefined && hasMore;
  const totalRowsLabel = isTotalUnknown
    ? "?"
    : `${isTotalEstimated ? "≈" : ""}${totalRowsCount.toLocaleString()}`;
  const exactCountControl =
    !externalData && table && (isTotalEstimated || isTotalUnknown) ? (
      <ExactCountControl
        isCounting={isCountingRows}
        onCount={() => void countExactRows(isServerFilterActive ? serverFilter : null)}
      />
    ) : null;
  const activeFilterSql = isServerFilterActive ? serverFilter : null;
  const handleGoToOffset = (offset: number) => {
    setPageOffset(offset);
    setSelectedRowIndex(null);
    loadData(offset, pageSize, sortColumn, sortDirection, activeFilterSql, false);
  };
  // The reload happens in the page-size / scroll-mode effect.
  const handlePageSizeChange = (newSize: number) => setPageSize(newSize);
  const handleSwitchToPages = () => setInfiniteScroll(false);
  const handleSwitchToInfinite = () => setInfiniteScroll(true);

  const activeInspectorValue = useMemo(() => {
    if (!selectedCell || !dataResult || !displayRows[selectedCell.row]) return null;
    const rawColIdx = getRawColIndex(selectedCell.col);
    const colName = effectiveColumnNames[selectedCell.col] || dataResult.columns[rawColIdx];
    const rowData = displayRows[selectedCell.row];
    const staged = stagedUpdatesMap.get(`${colName}:${rowKeyOf(rowData, dataResult.columns, activePkColumns)}`);
    return staged ? staged.stagedValue : (rawColIdx !== -1 ? displayRows[selectedCell.row][rawColIdx] : null);
  }, [selectedCell, dataResult, displayRows, effectiveColumnNames, getRawColIndex, stagedUpdatesMap, activePkColumns]);

  const showInspector = Boolean(isInspectorOpen && selectedCell && dataResult);
  const isInspectorDocked = showInspector && isWideLayout;
  // The record panel shares the dock with the inspector, which takes precedence.
  const isRecordPanelDocked = isRecordPanelOpen && isWideLayout && !isInspectorDocked && Boolean(dataResult);
  const isDockOpen = isInspectorDocked || isRecordPanelDocked;

  const inspector = selectedCell && dataResult && (
    <CellInspectorDrawer
      isOpen={isInspectorOpen}
      onClose={() => setIsInspectorOpen(false)}
      database={database}
      table={table}
      columnName={effectiveColumnNames[selectedCell.col] || dataResult.columns[getRawColIndex(selectedCell.col)] || t("cellInspector.columnFallback")}
      columnType={dataResult.column_types?.[getRawColIndex(selectedCell.col)]}
      initialValue={activeInspectorValue}
      onSaveToStaged={(newVal) => {
        onCellEdited([selectedCell.col, selectedCell.row], {
          kind: GridCellKind.Text,
          data: newVal === null ? "NULL" : String(newVal),
        } as EditableGridCell);
      }}
      isReadonly={!isEditingAllowed}
      docked={isInspectorDocked}
    />
  );

  return (
    <div
      className="pyro-data-grid flex flex-col h-full w-full bg-surface relative select-none"
      style={isDockOpen ? { paddingRight: inspectorWidth } : undefined}
      onKeyDown={handleContainerKeyDown}
      tabIndex={0}
    >
      {/* Top Toolbar */}
      <div
      data-grid-toolbar className={`flex items-center justify-between px-3 py-1.5 border-b shrink-0 gap-2 bg-surface border-line`}
      >
        <GridToolbarActions
          dataResult={dataResult}
          displayRows={displayRows}
          extraToolbarActions={extraToolbarActions}
          filterRules={filterRules}
          freezeColumnsCount={freezeColumnsCount}
          getSelectedDataMatrix={getSelectedDataMatrix}
          handleClearServerFilter={handleClearServerFilter}
          handleSmartCopy={handleSmartCopy}
          hasSelectionRange={hasSelectionRange}
          isCopyMenuOpen={isCopyMenuOpen}
          isEditingAllowed={isEditingAllowed}
          isFilterBuilderOpen={isFilterBuilderOpen}
          isLoading={isLoading}
          isRecordPanelOpen={isRecordPanelOpen}
          isServerFilterActive={isServerFilterActive}
          isWideLayout={isWideLayout}
          loadData={loadData}
          pageOffset={pageOffset}
          pageSize={pageSize}
          searchTerm={searchTerm}
          serverFilter={serverFilter}
          setIsCopyMenuOpen={setIsCopyMenuOpen}
          setIsFilterBuilderOpen={setIsFilterBuilderOpen}
          setIsNewRecordModalOpen={setIsNewRecordModalOpen}
          setIsRecordPanelOpen={setIsRecordPanelOpen}
          setSearchTerm={setSearchTerm}
          totalRowsLabel={totalRowsLabel}
        />

        {/* Live editing status banner */}
        {saveStatus && <SaveStatusBadge saveStatus={saveStatus} />}

        {/* Pagination controls or Continuous scroll info or External row count */}
        <GridPagination
          isExternal={Boolean(externalData)}
          infiniteScroll={infiniteScroll}
          loadedRows={displayRows.length}
          totalRowsLabel={totalRowsLabel}
          totalRowsCount={totalRowsCount}
          exactCountControl={exactCountControl}
          isLoading={isLoading}
          isLoadingMore={isLoadingMore}
          hasMore={hasMore}
          pageOffset={pageOffset}
          pageSize={pageSize}
          onPageSizeChange={handlePageSizeChange}
          onGoToOffset={handleGoToOffset}
          onSwitchToPages={handleSwitchToPages}
          onSwitchToInfinite={handleSwitchToInfinite}
        />
      </div>

      {/* Visual Filter Builder Panel */}
      {isFilterBuilderOpen && (
        <VisualFilterBuilder
          columns={dataResult?.columns ?? []}
          rules={filterRules}
          onChangeRules={setFilterRules}
          sortRules={sortRules}
          onChangeSortRules={setSortRules}
          onApply={(whereSql, sortSql) => {
            setServerFilter(whereSql);
            setIsServerFilterActive(Boolean(whereSql));
            setPageOffset(0);
            setSelectedRowIndex(null);
            setSelectedCell(null);
            if (!externalData) {
              loadData(
                0,
                infiniteScroll ? 500 : pageSize,
                sortSql || sortColumn,
                sortSql ? null : sortDirection,
                whereSql || null,
                true,
              );
            }
          }}
          onReset={() => {
            handleClearServerFilter();
          }}
          onClose={() => setIsFilterBuilderOpen(false)}
        />
      )}

      {/* No Primary Key Notice Banner (only shown if a table is selected) */}
      {!hasPrimaryKey && Boolean(table) && !isLoading && dataResult && (
        <NoPrimaryKeyNotice noPrimaryKeyMode={noPrimaryKeyMode} />
      )}

      <GridViewport
        isLoading={isLoading}
        dataResult={dataResult}
        columns={columns}
        displayRows={displayRows}
        getCellContent={getCellContent}
        onCellEdited={onCellEdited}
        handleColumnResize={handleColumnResize}
        handleColumnMoved={handleColumnMoved}
        freezeColumnsCount={freezeColumnsCount}
        handleHeaderClicked={handleHeaderClicked}
        handleHeaderMenuClick={handleHeaderMenuClick}
        handleHeaderContextMenu={handleHeaderContextMenu}
        handleCellContextMenu={handleCellContextMenu}
        handleVisibleRegionChanged={handleVisibleRegionChanged}
        setSelectedRowIndex={setSelectedRowIndex}
        setSelectedCell={setSelectedCell}
        effectiveColumnNames={effectiveColumnNames}
        fkByColumn={fkByColumn}
        handleForeignKeyJump={handleForeignKeyJump}
        gridSelection={gridSelection}
        setGridSelection={setGridSelection}
        handlePaste={handlePaste}
        handleDelete={handleDelete}
        pyroTheme={pyroTheme}
        rowHeight={densityMetrics.row}
        headerHeight={densityMetrics.header}
        searchTerm={searchTerm}
        externalData={externalData}
        setSearchTerm={setSearchTerm}
        stagedChangeCount={stagedChangeCount}
        setIsPreviewSqlOpen={setIsPreviewSqlOpen}
        handleApplyStagedChanges={handleApplyStagedChanges}
        handleDiscardStagedChanges={handleDiscardStagedChanges}
        isApplyingStaged={isApplyingStaged}
      />

      <GridOverlays
        isInspectorDocked={isInspectorDocked}
        inspectorWidth={inspectorWidth}
        setInspectorWidth={setInspectorWidth}
        inspector={inspector}
        isRecordPanelDocked={isRecordPanelDocked}
        selectedRowIndex={selectedRowIndex}
        setIsRecordPanelOpen={setIsRecordPanelOpen}
        isEditingAllowed={isEditingAllowed}
        setIsEditModalOpen={setIsEditModalOpen}
        effectiveColumnNames={effectiveColumnNames}
        getRawColIndex={getRawColIndex}
        setSelectedCell={setSelectedCell}
        setIsInspectorOpen={setIsInspectorOpen}
        modalsProps={{
          activePkColumns,
          dataResult,
          database,
          dialect,
          displayRows,
          generateSqlForTable,
          getSelectedCells,
          handleApplyStagedChanges,
          handleApplyValueToSelection,
          handleConfirmPaste,
          handleCreateRecord,
          handleSaveRow,
          isApplyingStaged,
          isEditModalOpen,
          isFillModalOpen,
          isNewRecordModalOpen,
          isPreviewSqlOpen,
          pendingPasteValidation,
          selectedRowIndex,
          setIsEditModalOpen,
          setIsFillModalOpen,
          setIsNewRecordModalOpen,
          setIsPreviewSqlOpen,
          setPendingPasteValidation,
          table,
        }}
        cellContextMenuProps={{
          cellContextMenu,
          setCellContextMenu,
          getSelectedCells,
          dataResult,
          handleSetCellNull,
          isEditingAllowed,
          setIsFillModalOpen,
          setIsInspectorOpen,
          effectiveColumnNames,
          fkByColumn,
          referencingConstraints,
          getRowValueByName,
          handleForeignKeyJump,
          handleReferencingJump,
          getSelectedDataMatrix,
          setSaveStatus,
          getRawColIndex,
          displayRows,
          isCopySubmenuOpen,
          setIsCopySubmenuOpen,
          handleSmartCopy,
          handleSelectColumn,
          setIsNewRecordModalOpen,
          setIsEditModalOpen,
          getSelectedRowIndices,
          handleStageDeleteRow,
        }}
        headerMenuProps={{
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
        }}
      />
    </div>
  );
};
