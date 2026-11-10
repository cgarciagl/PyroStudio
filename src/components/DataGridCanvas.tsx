import React, { useCallback, useMemo, useState, useEffect, } from "react";
import { FirstTimeHint } from "./ui/FirstTimeHint";
import DataEditor, {
  GridCellKind,
  GridColumn,
  Item,
  EditableGridCell,
  GridSelection,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import {
  Loader2,
  Database,
} from "lucide-react";
import type {
  TableDataResult,
  QueryExecutionResult,
} from "../types/database";
import { useConnectionStore } from "../stores/connectionStore";
import { GRID_DENSITY_METRICS, usePreferenceStore } from "../stores/preferenceStore";
import { StagedChangesActionBar } from "./StagedChangesActionBar";
import { CellInspectorDrawer } from "./CellInspectorDrawer";
import { RecordDetailPanel } from "./RecordDetailPanel";
import { RightDock, useDockWidth, useIsWideLayout } from "./ui/RightDock";
import {
  type PasteValidationResult,
} from "../utils/pasteParser";

import { buildSmartCopyOutput, type SmartCopyFormat } from "./dataGrid/copyFormats";
import { useTableKeys } from "./dataGrid/useTableKeys";
import { useColumnLayout } from "./dataGrid/useColumnLayout";
import { GridCellContextMenu } from "./dataGrid/GridCellContextMenu";
import { GridHeaderMenu } from "./dataGrid/GridHeaderMenu";
import { useGridEditing } from "./dataGrid/useGridEditing";
import { useCellContent } from "./dataGrid/useCellContent";
import { useForeignKeyNavigation } from "./dataGrid/useForeignKeyNavigation";
import { isEditableTarget, resolveGridShortcut } from "./dataGrid/keyboard";
import { buildGridTheme } from "./dataGrid/gridTheme";
import { useHeaderActions } from "./dataGrid/useHeaderActions";
import { NoPrimaryKeyNotice } from "./dataGrid/NoPrimaryKeyNotice";
import { EmptyResultOverlay } from "./dataGrid/EmptyResultOverlay";
import { GridToolbarActions } from "./dataGrid/GridToolbarActions";
import { GridModals } from "./dataGrid/GridModals";
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
import { useDismissOnOutsideClick } from "./dataGrid/useDismissOnOutsideClick";
import { useStagedTableChanges } from "./dataGrid/useStagedTableChanges";
import { useTableDataLoader } from "./dataGrid/useTableDataLoader";
import { useSqlLiteralRules } from "../services/sqlLiterals";
import {
  VisualFilterBuilder,
  type FilterRule,
  type SortRule,
} from "./VisualFilterBuilder";

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
  const {
    defaultPageSize,
    noPrimaryKeyMode,
    theme,
    fontFamily,
    gridDensity,
    infiniteScroll,
    setInfiniteScroll,
  } = usePreferenceStore();
  const densityMetrics = GRID_DENSITY_METRICS[gridDensity];

  const activeFont =
    fontFamily === "system"
      ? "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
      : '"Maple Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

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
          id: `rule_${Date.now()}`,
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
  }, [database, table, pageSize, externalData, infiniteScroll]);

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

  const isLight =
    theme === "light" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: light)").matches);

  // Glide Data Grid cell supplier callback with Staged Changes Visual Highlight
  const getCellContent = useCellContent({
    activeFont,
    dataResult,
    displayRows,
    effectiveColumnNames,
    getRawColIndex,
    isEditingAllowed,
    isLight,
    stagedDeletedRows,
    stagedUpdatesMap,
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

  // Smart Multi-Format Copy Actions
  const handleSmartCopy = (
    format: SmartCopyFormat,
  ) => {
    if (!dataResult) return;
    setIsCopyMenuOpen(false);

    const { columns: targetCols, rows: targetRows } = getSelectedDataMatrix();
    if (targetRows.length === 0 || targetCols.length === 0) return;

    const output = buildSmartCopyOutput(format, targetCols, targetRows, {
      database,
      table: table || "query_result",
      dialect,
    });

    navigator.clipboard.writeText(output).then(() => {
      setSaveStatus({
        success: true,
        message: `Copiado (${format.toUpperCase()}): ${targetRows.length} fila(s), ${targetCols.length} col(s).`,
      });
      setTimeout(() => setSaveStatus(null), 3000);
    });
  };

  // Keyboard navigation & shortcuts on container
  const handleContainerKeyDown = (e: React.KeyboardEvent) => {
    // No interceptar teclas mientras se escribe en un input, el editor de celda o un modal
    if (isEditableTarget(e.target as HTMLElement | null)) return;

    const shortcut = resolveGridShortcut(e, {
      stagedChangeCount,
      hasSelectedCell: Boolean(selectedCell),
      gridSelection,
    });
    if (!shortcut) return;
    e.preventDefault();
    switch (shortcut) {
      case "apply":
        handleApplyStagedChanges();
        break;
      case "discard":
        handleDiscardStagedChanges();
        break;
      case "copyTsv":
        handleSmartCopy("tsv");
        break;
      case "inspect":
        setIsInspectorOpen(true);
        break;
      case "setNull":
        handleSetCellNull();
        break;
    }
  };

  // Pyro Theme for Glide Data Grid Canvas (Light / Dark)
  const pyroTheme = useMemo(
    () => buildGridTheme(isLight, activeFont, densityMetrics.padY),
    [isLight, activeFont, densityMetrics],
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
  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setPageOffset(0);
    setSelectedRowIndex(null);
    loadData(0, newSize, sortColumn, sortDirection, activeFilterSql, false);
  };
  const handleSwitchToPages = () => {
    setInfiniteScroll(false);
    setPageOffset(0);
    loadData(0, pageSize, sortColumn, sortDirection, activeFilterSql, false);
  };
  const handleSwitchToInfinite = () => {
    setInfiniteScroll(true);
    setPageOffset(0);
    loadData(0, 500, sortColumn, sortDirection, activeFilterSql, true);
  };

  const activeInspectorValue = useMemo(() => {
    if (!selectedCell || !dataResult || !displayRows[selectedCell.row]) return null;
    const rawColIdx = getRawColIndex(selectedCell.col);
    const colName = effectiveColumnNames[selectedCell.col] || dataResult.columns[rawColIdx];
    const cellKey = `${colName}:${selectedCell.row}`;
    const staged = stagedUpdatesMap.get(cellKey);
    return staged ? staged.stagedValue : (rawColIdx !== -1 ? displayRows[selectedCell.row][rawColIdx] : null);
  }, [selectedCell, dataResult, displayRows, effectiveColumnNames, getRawColIndex, stagedUpdatesMap]);

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
      columnName={effectiveColumnNames[selectedCell.col] || dataResult.columns[getRawColIndex(selectedCell.col)] || "Columna"}
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

      {/* Canvas Data Grid Container */}
      <div className={`flex-1 min-h-0 w-full relative overflow-hidden bg-surface`}>
        {isLoading && !dataResult && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/50 space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-fg-muted" />
            <span className="text-xs text-fg font-mono">
              Cargando registros desde MariaDB...
            </span>
          </div>
        )}

        {columns.length > 0 ? (
          <DataEditor
            width="100%"
            height="100%"
            columns={columns}
            rows={displayRows.length}
            getCellContent={getCellContent}
            onCellEdited={onCellEdited}
            onColumnResize={handleColumnResize}
            onColumnMoved={handleColumnMoved}
            freezeColumns={freezeColumnsCount}
            onHeaderClicked={handleHeaderClicked}
            onHeaderMenuClick={handleHeaderMenuClick}
            onHeaderContextMenu={handleHeaderContextMenu}
            onCellContextMenu={handleCellContextMenu}
            onVisibleRegionChanged={handleVisibleRegionChanged}
            onCellClicked={([col, row]: Item, event) => {
              if (row < 0 || col < 0) return;
              setSelectedRowIndex(row);
              setSelectedCell({ col, row });

              // If Alt + Click on a foreign key cell, trigger quick jump
              if ((event as any).altKey && dataResult) {
                const colName = effectiveColumnNames[col];
                if (colName && fkByColumn.has(colName.toLowerCase())) {
                  handleForeignKeyJump(col, row);
                }
              }
            }}
            gridSelection={gridSelection}
            onGridSelectionChange={setGridSelection}
            rangeSelect="multi-rect"
            rowSelect="multi"
            columnSelect="multi"
            onPaste={handlePaste}
            onDelete={handleDelete}
            cellActivationBehavior="double-click"
            editOnType={true}
            theme={pyroTheme}
            rowHeight={densityMetrics.row}
            headerHeight={densityMetrics.header}
            rowMarkers="both"
            smoothScrollX
            smoothScrollY
            getCellsForSelection
            verticalBorder
            fillHandle
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-fg-subtle text-xs">
            <Database className="w-8 h-8 mb-2 opacity-40 text-fg-muted" />
            <span>Sin datos para mostrar en esta tabla.</span>
          </div>
        )}

        {/* Empty Result Set Overlay */}
        {!isLoading && columns.length > 0 && displayRows.length === 0 && (
          <EmptyResultOverlay
            searchTerm={searchTerm}
            isQueryResult={Boolean(externalData)}
            columnCount={columns.length}
            executionTimeMs={externalData ? externalData.execution_time_ms : undefined}
            onClearSearch={() => setSearchTerm("")}
          />
        )}

        {stagedChangeCount === 0 && (dataResult?.rows?.length ?? 0) > 0 && (
          <FirstTimeHint id="grid" className="absolute bottom-4 right-4 z-20 max-w-xs">
            Doble clic en una celda para editarla. Los cambios quedan pendientes hasta que pulses «Aplicar». Clic
            derecho para copiar, borrar filas o navegar por claves foráneas.
          </FirstTimeHint>
        )}

        {/* Floating Action Bar for Staged Changes */}
        <StagedChangesActionBar
          changeCount={stagedChangeCount}
          onPreviewSql={() => setIsPreviewSqlOpen(true)}
          onApplyChanges={handleApplyStagedChanges}
          onDiscardChanges={handleDiscardStagedChanges}
          isApplying={isApplyingStaged}
        />
      </div>

      {/* Value Inspector Lateral Drawer */}
      {isInspectorDocked ? (
        <RightDock width={inspectorWidth} onResize={setInspectorWidth}>
          {inspector}
        </RightDock>
      ) : (
        inspector
      )}

      {/* Record detail (master-detail) panel */}
      {isRecordPanelDocked && dataResult && (
        <RightDock width={inspectorWidth} onResize={setInspectorWidth}>
          <RecordDetailPanel
            columns={dataResult.columns}
            columnTypes={dataResult.column_types}
            row={selectedRowIndex !== null ? displayRows[selectedRowIndex] ?? null : null}
            rowNumber={selectedRowIndex}
            onClose={() => setIsRecordPanelOpen(false)}
            onEdit={isEditingAllowed ? () => setIsEditModalOpen(true) : undefined}
            onInspect={(rawCol) => {
              if (selectedRowIndex === null) return;
              const visualCol = effectiveColumnNames.findIndex((_, i) => getRawColIndex(i) === rawCol);
              if (visualCol === -1) return;
              setSelectedCell({ col: visualCol, row: selectedRowIndex });
              setIsInspectorOpen(true);
            }}
          />
        </RightDock>
      )}

      <GridModals
        activePkColumns={activePkColumns}
        dataResult={dataResult}
        database={database}
        dialect={dialect}
        displayRows={displayRows}
        generateSqlForTable={generateSqlForTable}
        getSelectedCells={getSelectedCells}
        handleApplyStagedChanges={handleApplyStagedChanges}
        handleApplyValueToSelection={handleApplyValueToSelection}
        handleConfirmPaste={handleConfirmPaste}
        handleCreateRecord={handleCreateRecord}
        handleSaveRow={handleSaveRow}
        isApplyingStaged={isApplyingStaged}
        isEditModalOpen={isEditModalOpen}
        isFillModalOpen={isFillModalOpen}
        isNewRecordModalOpen={isNewRecordModalOpen}
        isPreviewSqlOpen={isPreviewSqlOpen}
        pendingPasteValidation={pendingPasteValidation}
        selectedRowIndex={selectedRowIndex}
        setIsEditModalOpen={setIsEditModalOpen}
        setIsFillModalOpen={setIsFillModalOpen}
        setIsNewRecordModalOpen={setIsNewRecordModalOpen}
        setIsPreviewSqlOpen={setIsPreviewSqlOpen}
        setPendingPasteValidation={setPendingPasteValidation}
        table={table}
      />

      {/* Floating Context Menu for Cells */}
      {cellContextMenu && (
        <GridCellContextMenu
          cellContextMenu={cellContextMenu}
          setCellContextMenu={setCellContextMenu}
          getSelectedCells={getSelectedCells}
          dataResult={dataResult}
          handleSetCellNull={handleSetCellNull}
          isEditingAllowed={isEditingAllowed}
          setIsFillModalOpen={setIsFillModalOpen}
          setIsInspectorOpen={setIsInspectorOpen}
          effectiveColumnNames={effectiveColumnNames}
          fkByColumn={fkByColumn}
          referencingConstraints={referencingConstraints}
          getRowValueByName={getRowValueByName}
          handleForeignKeyJump={handleForeignKeyJump}
          handleReferencingJump={handleReferencingJump}
          getSelectedDataMatrix={getSelectedDataMatrix}
          setSaveStatus={setSaveStatus}
          getRawColIndex={getRawColIndex}
          displayRows={displayRows}
          isCopySubmenuOpen={isCopySubmenuOpen}
          setIsCopySubmenuOpen={setIsCopySubmenuOpen}
          handleSmartCopy={handleSmartCopy}
          handleSelectColumn={handleSelectColumn}
          setIsNewRecordModalOpen={setIsNewRecordModalOpen}
          setIsEditModalOpen={setIsEditModalOpen}
          getSelectedRowIndices={getSelectedRowIndices}
          handleStageDeleteRow={handleStageDeleteRow}
        />
      )}

      {/* Header Context / Column Menu Dropdown */}
      {headerMenu && (
        <GridHeaderMenu
          headerMenu={headerMenu}
          setHeaderMenu={setHeaderMenu}
          handleSelectColumn={handleSelectColumn}
          handleSortFromMenu={handleSortFromMenu}
          sortColumn={sortColumn}
          handleAutoSizeColumn={handleAutoSizeColumn}
          customWidths={customWidths}
          handleResetColumnWidths={handleResetColumnWidths}
          handleToggleFreezeColumn={handleToggleFreezeColumn}
          freezeColumnsCount={freezeColumnsCount}
          handleCopyColumnName={handleCopyColumnName}
          externalData={externalData}
          handleFilterByColumn={handleFilterByColumn}
        />
      )}
    </div>
  );
};
