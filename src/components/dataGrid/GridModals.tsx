import React from "react";
import type { TableDataResult } from "../../types/database";
import type { useSqlLiteralRules } from "../../services/sqlLiterals";
import type { PasteValidationResult } from "../../utils/pasteParser";
import { EditRecordModal } from "../EditRecordModal";
import { PreviewStagedSqlModal } from "../PreviewStagedSqlModal";
import { FillSelectionModal } from "../FillSelectionModal";
import { PastePreviewModal } from "../PastePreviewModal";
import type { Item } from "@glideapps/glide-data-grid";
import type { useStagedTableChanges } from "./useStagedTableChanges";

export interface GridModalsProps {
  activePkColumns: string[];
  dataResult: TableDataResult | null;
  database: string;
  dialect: ReturnType<typeof useSqlLiteralRules>;
  displayRows: any[][];
  generateSqlForTable: ReturnType<typeof useStagedTableChanges>["generateSqlForTable"];
  getSelectedCells: () => Item[];
  handleApplyStagedChanges: () => void;
  handleApplyValueToSelection: (newVal: any, customCells?: Item[]) => Promise<void>;
  handleConfirmPaste: () => void;
  handleCreateRecord: (newRowValues: any[]) => Promise<void>;
  handleSaveRow: (updatedRow: any[]) => Promise<void>;
  isApplyingStaged: boolean;
  isEditModalOpen: boolean;
  isFillModalOpen: boolean;
  isNewRecordModalOpen: boolean;
  isPreviewSqlOpen: boolean;
  pendingPasteValidation: PasteValidationResult | null;
  selectedRowIndex: number | null;
  setIsEditModalOpen: (open: boolean) => void;
  setIsFillModalOpen: (open: boolean) => void;
  setIsNewRecordModalOpen: (open: boolean) => void;
  setIsPreviewSqlOpen: (open: boolean) => void;
  setPendingPasteValidation: (v: PasteValidationResult | null) => void;
  table: string;
}

/** Modals owned by the grid: staged SQL preview, edit/create record, fill and paste preview. */
export const GridModals: React.FC<GridModalsProps> = ({
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
}) => (
  <>
  {/* Preview Staged SQL Modal */}
  <PreviewStagedSqlModal
    isOpen={isPreviewSqlOpen}
    onClose={() => setIsPreviewSqlOpen(false)}
    onApply={handleApplyStagedChanges}
    sqlStatements={generateSqlForTable(database, table, dialect)}
    database={database}
    table={table}
    isApplying={isApplyingStaged}
  />

  {/* Edit Record Modal */}
  {isEditModalOpen && selectedRowIndex !== null && displayRows[selectedRowIndex] && dataResult && (
    <EditRecordModal
      isOpen={isEditModalOpen}
      onClose={() => setIsEditModalOpen(false)}
      database={database}
      tableName={table}
      pkColumns={activePkColumns}
      columns={dataResult.columns}
      columnTypes={dataResult.column_types}
      rowData={displayRows[selectedRowIndex]}
      rowIndex={selectedRowIndex}
      onSave={handleSaveRow}
    />
  )}

  {/* Create New Record Modal */}
  {isNewRecordModalOpen && dataResult && (
    <EditRecordModal
      isOpen={isNewRecordModalOpen}
      onClose={() => setIsNewRecordModalOpen(false)}
      database={database}
      tableName={table}
      pkColumns={activePkColumns}
      columns={dataResult.columns}
      columnTypes={dataResult.column_types}
      isNewRecord={true}
      onSave={handleCreateRecord}
    />
  )}

  {/* Fill Selection Modal */}
  {isFillModalOpen && (
    <FillSelectionModal
      isOpen={isFillModalOpen}
      onClose={() => setIsFillModalOpen(false)}
      cellCount={Math.max(1, getSelectedCells().length)}
      onApply={(newVal) => handleApplyValueToSelection(newVal)}
    />
  )}

  {/* Paste Preview Modal */}
  {pendingPasteValidation && (
    <PastePreviewModal
      isOpen={Boolean(pendingPasteValidation)}
      onClose={() => setPendingPasteValidation(null)}
      onConfirm={handleConfirmPaste}
      validation={pendingPasteValidation}
      targetTableName={`${database}.${table}`}
    />
  )}
  </>
);
