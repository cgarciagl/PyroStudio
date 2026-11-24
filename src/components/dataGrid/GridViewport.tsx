import React from "react";
import { useTranslation } from "react-i18next";
import DataEditor, {
  CellClickedEventArgs,
  EditableGridCell,
  GridCell,
  GridColumn,
  GridSelection,
  HeaderClickedEventArgs,
  Item,
  Rectangle,
  Theme,
} from "@glideapps/glide-data-grid";
import { Database, Loader2 } from "lucide-react";
import type { QueryExecutionResult, TableDataResult } from "../../types/database";
import { FirstTimeHint } from "../ui/FirstTimeHint";
import { StagedChangesActionBar } from "../StagedChangesActionBar";
import { EmptyResultOverlay } from "./EmptyResultOverlay";

export interface GridViewportProps {
  isLoading: boolean;
  dataResult: TableDataResult | null;
  columns: GridColumn[];
  displayRows: unknown[][];
  getCellContent: (cell: Item) => GridCell;
  onCellEdited: (cell: Item, newValue: EditableGridCell) => void;
  handleColumnResize: (column: GridColumn, newSize: number) => void;
  handleColumnMoved: (startIndex: number, endIndex: number) => void;
  freezeColumnsCount: number;
  handleHeaderClicked: (col: number) => void;
  handleHeaderMenuClick: (col: number, bounds: Rectangle) => void;
  handleHeaderContextMenu: (col: number, e: HeaderClickedEventArgs) => void;
  handleCellContextMenu: (cell: Item, e: CellClickedEventArgs) => void;
  handleVisibleRegionChanged: (range: Rectangle) => void;
  setSelectedRowIndex: (row: number | null) => void;
  setSelectedCell: (cell: { col: number; row: number } | null) => void;
  effectiveColumnNames: string[];
  fkByColumn: Map<string, unknown>;
  handleForeignKeyJump: (col: number, row: number) => void;
  gridSelection: GridSelection | undefined;
  setGridSelection: (selection: GridSelection | undefined) => void;
  handlePaste: (target: Item, values: readonly (readonly string[])[]) => boolean;
  handleDelete: (selection: GridSelection) => boolean;
  pyroTheme: Partial<Theme>;
  rowHeight: number;
  headerHeight: number;
  searchTerm: string;
  externalData?: TableDataResult | QueryExecutionResult | null;
  setSearchTerm: (term: string) => void;
  stagedChangeCount: number;
  setIsPreviewSqlOpen: (open: boolean) => void;
  handleApplyStagedChanges: () => void;
  handleDiscardStagedChanges: () => void;
  isApplyingStaged: boolean;
}

export const GridViewport: React.FC<GridViewportProps> = ({
  isLoading,
  dataResult,
  columns,
  displayRows,
  getCellContent,
  onCellEdited,
  handleColumnResize,
  handleColumnMoved,
  freezeColumnsCount,
  handleHeaderClicked,
  handleHeaderMenuClick,
  handleHeaderContextMenu,
  handleCellContextMenu,
  handleVisibleRegionChanged,
  setSelectedRowIndex,
  setSelectedCell,
  effectiveColumnNames,
  fkByColumn,
  handleForeignKeyJump,
  gridSelection,
  setGridSelection,
  handlePaste,
  handleDelete,
  pyroTheme,
  rowHeight,
  headerHeight,
  searchTerm,
  externalData,
  setSearchTerm,
  stagedChangeCount,
  setIsPreviewSqlOpen,
  handleApplyStagedChanges,
  handleDiscardStagedChanges,
  isApplyingStaged,
}) => {
  const { t } = useTranslation("dataGrid");

  return (
  <div className="flex-1 min-h-0 w-full relative overflow-hidden bg-surface">
    {isLoading && !dataResult && (
      <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-surface space-y-3">
        <Loader2 className="w-6 h-6 animate-spin text-fg-muted" />
        <span className="text-xs text-fg-muted">{t("viewport.loading")}</span>
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

          if ((event as { altKey?: boolean }).altKey && dataResult) {
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
        rowHeight={rowHeight}
        headerHeight={headerHeight}
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
        <span>{t("viewport.noData")}</span>
      </div>
    )}

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
        {t("viewport.firstTimeHint")}
      </FirstTimeHint>
    )}

    <StagedChangesActionBar
      changeCount={stagedChangeCount}
      onPreviewSql={() => setIsPreviewSqlOpen(true)}
      onApplyChanges={handleApplyStagedChanges}
      onDiscardChanges={handleDiscardStagedChanges}
      isApplying={isApplyingStaged}
    />
  </div>
  );
};
