import React from "react";
import { RightDock } from "../ui/RightDock";
import { RecordDetailPanel } from "../RecordDetailPanel";
import { GridModals } from "./GridModals";
import { GridCellContextMenu } from "./GridCellContextMenu";
import { GridHeaderMenu } from "./GridHeaderMenu";

type GridModalsProps = React.ComponentProps<typeof GridModals>;
type GridCellContextMenuProps = React.ComponentProps<typeof GridCellContextMenu>;
type GridHeaderMenuProps = React.ComponentProps<typeof GridHeaderMenu>;

export interface GridOverlaysProps {
  isInspectorDocked: boolean;
  inspectorWidth: number;
  setInspectorWidth: (w: number) => void;
  inspector: React.ReactNode;
  isRecordPanelDocked: boolean;
  selectedRowIndex: number | null;
  setIsRecordPanelOpen: (open: boolean) => void;
  isEditingAllowed: boolean;
  setIsEditModalOpen: (open: boolean) => void;
  effectiveColumnNames: string[];
  getRawColIndex: (visualCol: number) => number;
  setSelectedCell: (cell: { col: number; row: number } | null) => void;
  setIsInspectorOpen: (open: boolean) => void;
  modalsProps: GridModalsProps;
  cellContextMenuProps: Omit<GridCellContextMenuProps, "cellContextMenu"> & {
    cellContextMenu: GridCellContextMenuProps["cellContextMenu"] | null;
  };
  headerMenuProps: Omit<GridHeaderMenuProps, "headerMenu"> & {
    headerMenu: GridHeaderMenuProps["headerMenu"] | null;
  };
}

export const GridOverlays: React.FC<GridOverlaysProps> = ({
  isInspectorDocked,
  inspectorWidth,
  setInspectorWidth,
  inspector,
  isRecordPanelDocked,
  selectedRowIndex,
  setIsRecordPanelOpen,
  isEditingAllowed,
  setIsEditModalOpen,
  effectiveColumnNames,
  getRawColIndex,
  setSelectedCell,
  setIsInspectorOpen,
  modalsProps,
  cellContextMenuProps,
  headerMenuProps,
}) => {
  const { dataResult, displayRows } = modalsProps;
  const { cellContextMenu, ...restCellMenu } = cellContextMenuProps;
  const { headerMenu, ...restHeaderMenu } = headerMenuProps;

  return (
    <>
      {isInspectorDocked ? (
        <RightDock width={inspectorWidth} onResize={setInspectorWidth}>
          {inspector}
        </RightDock>
      ) : (
        inspector
      )}

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

      <GridModals {...modalsProps} />

      {cellContextMenu && (
        <GridCellContextMenu cellContextMenu={cellContextMenu} {...restCellMenu} />
      )}

      {headerMenu && (
        <GridHeaderMenu headerMenu={headerMenu} {...restHeaderMenu} />
      )}
    </>
  );
};
