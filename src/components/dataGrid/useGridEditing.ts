import React, { useCallback, useMemo } from "react";
import {
  GridCellKind,
  Item,
  EditableGridCell,
  GridSelection,
  CompactSelection,
} from "@glideapps/glide-data-grid";
import type {
  TableDataResult,
  PrimaryKeyCondition,
} from "../../types/database";
import { useUIStore } from "../../stores/uiStore";
import { usePreferenceStore } from "../../stores/preferenceStore";
import {
  type StagedRowDelete,
} from "../../stores/stagedChangesStore";
import {
  parseClipboardMatrix,
  standardizeNumericString,
  type PasteValidationResult,
} from "../../utils/pasteParser";

import {
  buildSelectedDataMatrix,
  collectSelectedCells,
  isSelectionRange,
  resolveSelectedRowIndices,
} from "./selection";
import { useStagedTableChanges } from "./useStagedTableChanges";
import { useTableDataLoader } from "./useTableDataLoader";
import { useSqlLiteralRules } from "../../services/sqlLiterals";



import type { CellContextMenuState } from "./GridCellContextMenu";
import { useRecordActions } from "./useRecordActions";
import { inheritRowKey, rowKeyOf } from "./rowIdentity";

type StagedTableChanges = ReturnType<typeof useStagedTableChanges>;

export interface GridEditingParams {
  database: string;
  table: string;
  dataResult: TableDataResult | null;
  setDataResult: React.Dispatch<React.SetStateAction<TableDataResult | null>>;
  displayRows: any[][];
  effectiveColumnNames: string[];
  getRawColIndex: (visualCol: number) => number;
  activePkColumns: string[];
  hasPrimaryKey: boolean;
  isEditingAllowed: boolean;
  noPrimaryKeyMode: ReturnType<typeof usePreferenceStore.getState>["noPrimaryKeyMode"];
  dialect: ReturnType<typeof useSqlLiteralRules>;
  gridSelection: GridSelection | undefined;
  setGridSelection: React.Dispatch<React.SetStateAction<GridSelection | undefined>>;
  selectedCell: { col: number; row: number } | null;
  setSelectedCell: React.Dispatch<React.SetStateAction<{ col: number; row: number } | null>>;
  selectedRowIndex: number | null;
  setSelectedRowIndex: React.Dispatch<React.SetStateAction<number | null>>;
  pendingPasteValidation: PasteValidationResult | null;
  setPendingPasteValidation: React.Dispatch<React.SetStateAction<PasteValidationResult | null>>;
  setCellContextMenu: React.Dispatch<React.SetStateAction<CellContextMenuState | null>>;
  setIsApplyingStaged: React.Dispatch<React.SetStateAction<boolean>>;
  setIsCopySubmenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsNewRecordModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSaveStatus: React.Dispatch<React.SetStateAction<{ success?: boolean; message?: string } | null>>;
  lastMousePosRef: React.MutableRefObject<{ x: number; y: number }>;
  loadData: ReturnType<typeof useTableDataLoader>["loadData"];
  onRefresh: (() => void) | undefined;
  pageOffset: number;
  pageSize: number;
  stagedChangeCount: number;
  stageCellUpdate: StagedTableChanges["stageCellUpdate"];
  stageBatchCellUpdates: StagedTableChanges["stageBatchCellUpdates"];
  stageBatchRowDeletes: StagedTableChanges["stageBatchRowDeletes"];
  clearTableChanges: StagedTableChanges["clearTableChanges"];
  generateSqlForTable: StagedTableChanges["generateSqlForTable"];
}

/**
 * Editing actions of the grid: inline edits, fill and paste, delete,
 * row staging, record save/create and applying or discarding staged changes.
 * Every edit goes through the staged changes store (table and query modes).
 */
export function useGridEditing({
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
}: GridEditingParams) {
  // In-place real-time cell editing feeding the Staged Changes Store
  const onCellEdited = useCallback(
    async ([col, row]: Item, newValue: EditableGridCell) => {
      if (!dataResult) return;

      if (!hasPrimaryKey && noPrimaryKeyMode === "block") {
        setSaveStatus({
          success: false,
          message:
            "Esta tabla no tiene una clave primaria. La edición está deshabilitada en tu configuración.",
        });
        setTimeout(() => setSaveStatus(null), 5000);
        return;
      }

      const rawColIdx = getRawColIndex(col);
      const colName = effectiveColumnNames[col] || dataResult.columns[rawColIdx];
      const rowData = displayRows[row];

      // Build composite primary key conditions
      const primaryKeys: PrimaryKeyCondition[] = [];
      if (hasPrimaryKey) {
        const lowerCols = dataResult.columns.map((c) => c.toLowerCase());
        for (const pkCol of activePkColumns) {
          const pkIndex = lowerCols.indexOf(pkCol.toLowerCase());
          if (pkIndex === -1) {
            setSaveStatus({
              success: false,
              message: `Error: La columna de clave primaria '${pkCol}' no está presente en la vista.`,
            });
            setTimeout(() => setSaveStatus(null), 5000);
            return;
          }
          const pkVal = rowData[pkIndex];
          if (pkVal === undefined || pkVal === null) {
            setSaveStatus({
              success: false,
              message: `Error: El valor de la clave primaria '${pkCol}' es nulo en esta fila.`,
            });
            setTimeout(() => setSaveStatus(null), 5000);
            return;
          }
          primaryKeys.push({ column: pkCol, value: pkVal });
        }
      } else {
        // Full row mode: Treat all columns as composite identifier using row values
        for (let idx = 0; idx < dataResult.columns.length; idx++) {
          const cName = dataResult.columns[idx];
          const cVal = rowData[idx] ?? null;
          primaryKeys.push({ column: cName, value: cVal });
        }
      }

      let payloadValue: any;
      if (newValue.kind === GridCellKind.Boolean) {
        payloadValue =
          newValue.data === null || newValue.data === undefined
            ? null
            : Boolean(newValue.data);
      } else if (newValue.kind === GridCellKind.Number) {
        payloadValue = newValue.data === undefined ? null : newValue.data;
      } else if (newValue.kind === GridCellKind.Text) {
        const updatedValue = newValue.data;
        if (typeof updatedValue === "string") {
          const trimmed = updatedValue.trim();
          if (trimmed === "\\N" || trimmed.toUpperCase() === "NULL") {
            payloadValue = null;
          } else if (
            (trimmed.startsWith('"') &&
              trimmed.endsWith('"') &&
              trimmed.length >= 2) ||
            (trimmed.startsWith("'") &&
              trimmed.endsWith("'") &&
              trimmed.length >= 2)
          ) {
            payloadValue = trimmed.slice(1, -1);
          } else {
            payloadValue = updatedValue;
          }
        } else {
          payloadValue = updatedValue;
        }
      } else {
        return;
      }

      const colType = (rawColIdx !== -1 ? dataResult?.column_types?.[rawColIdx] : "")?.toUpperCase() || "";
      const isColNumeric =
        colType.includes("INT") ||
        colType.includes("DECIMAL") ||
        colType.includes("FLOAT") ||
        colType.includes("DOUBLE") ||
        colType.includes("NUMERIC") ||
        colType.includes("REAL") ||
        typeof rowData[rawColIdx] === "number";

      if (isColNumeric && typeof payloadValue === "string") {
        const trimmed = payloadValue.trim();
        if (trimmed !== "") {
          if (/^-?\d+,\d+$/.test(trimmed)) {
            payloadValue = trimmed.replace(",", ".");
          } else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(trimmed)) {
            payloadValue = trimmed.replace(/,/g, "");
          } else if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(trimmed)) {
            payloadValue = trimmed.replace(/\./g, "").replace(",", ".");
          }
        }
      }

      const originalVal = rawColIdx !== -1 ? rowData[rawColIdx] : null;

      // Stage change without executing UPDATE immediately
      stageCellUpdate({
        database,
        table,
        rowIndex: row,
        rowKey: rowKeyOf(rowData, dataResult.columns, activePkColumns),
        colIndex: rawColIdx,
        columnName: colName,
        originalValue: originalVal,
        stagedValue: payloadValue,
        primaryKeys,
      });

      // Update local view representation
      const rowIndexInData = dataResult.rows.indexOf(rowData);
      if (rowIndexInData !== -1 && rawColIdx !== -1) {
        const newRows = [...dataResult.rows];
        newRows[rowIndexInData] = [...newRows[rowIndexInData]];
        inheritRowKey(rowData, newRows[rowIndexInData]);
        newRows[rowIndexInData][rawColIdx] = payloadValue;
        setDataResult((prev) => (prev ? { ...prev, rows: newRows } : prev));
      }
    },
    [
      dataResult,
      displayRows,
      effectiveColumnNames,
      getRawColIndex,
      hasPrimaryKey,
      activePkColumns,
      noPrimaryKeyMode,
      database,
      table,
      stageCellUpdate,
    ],
  );

  // Returns all cells currently selected (single cell, rectangle range, multi-range, selected columns, or selected rows)
  const getSelectedCells = useCallback(
    (): Item[] =>
      collectSelectedCells({
        gridSelection,
        rowCount: displayRows.length,
        colCount: effectiveColumnNames.length,
        hasData: !!dataResult,
        selectedCell,
      }),
    [gridSelection, dataResult, displayRows.length, effectiveColumnNames.length, selectedCell],
  );

  // Extracts rectangular data matrix for active selection (single cell, range, columns, or rows)
  const getSelectedDataMatrix = useCallback((): { columns: string[]; rows: any[][] } => {
    if (!dataResult) return { columns: [], rows: [] };
    return buildSelectedDataMatrix({
      gridSelection,
      rawColumns: dataResult.columns,
      effectiveColumnNames,
      displayRows,
      getRawColIndex,
      selectedCell,
      selectedRowIndex,
    });
  }, [
    dataResult,
    gridSelection,
    effectiveColumnNames,
    displayRows,
    getRawColIndex,
    selectedCell,
    selectedRowIndex,
  ]);

  // True if a multi-cell range, row selection, or column selection is active
  const hasSelectionRange = useMemo(() => isSelectionRange(gridSelection), [gridSelection]);

  // Set value (or NULL) across all currently selected cells in the range
  const handleApplyValueToSelection = useCallback(
    async (newVal: any, customCells?: Item[]) => {
      if (!dataResult) return;

      if (!isEditingAllowed) {
        useUIStore.getState().showAlert({
          title: "Edición Bloqueada",
          message:
            "Esta tabla no tiene una clave primaria y la configuración actual bloquea operaciones sin clave.",
          variant: "warning",
          icon: "alert",
        });
        return;
      }

      const targetCells = customCells && customCells.length > 0 ? customCells : getSelectedCells();
      if (targetCells.length === 0) return;

      const payloadValue =
        typeof newVal === "string" && newVal.trim().toUpperCase() === "NULL"
          ? null
          : newVal;

      const lowerCols = dataResult.columns.map((c) => c.toLowerCase());
      let modifiedCount = 0;
      const newRows = [...dataResult.rows];

      for (const [col, row] of targetCells) {
        if (row < 0 || col < 0 || row >= displayRows.length || col >= effectiveColumnNames.length) {
          continue;
        }
        const rowData = displayRows[row];
        if (!rowData) continue;

        const rawColIdx = getRawColIndex(col);
        const colName = effectiveColumnNames[col] || dataResult.columns[rawColIdx];
        const primaryKeys: PrimaryKeyCondition[] = [];

        if (hasPrimaryKey) {
          let validPk = true;
          for (const pkCol of activePkColumns) {
            const pkIndex = lowerCols.indexOf(pkCol.toLowerCase());
            if (pkIndex === -1) {
              validPk = false;
              break;
            }
            const pkVal = rowData[pkIndex];
            if (pkVal === undefined || pkVal === null) {
              validPk = false;
              break;
            }
            primaryKeys.push({ column: pkCol, value: pkVal });
          }
          if (!validPk) continue;
        } else {
          for (let idx = 0; idx < dataResult.columns.length; idx++) {
            primaryKeys.push({
              column: dataResult.columns[idx],
              value: rowData[idx] ?? null,
            });
          }
        }

        const originalVal = rawColIdx !== -1 ? rowData[rawColIdx] : null;

        let cellPayloadValue = payloadValue;
        const colType = (rawColIdx !== -1 ? dataResult?.column_types?.[rawColIdx] : "")?.toUpperCase() || "";
        const isColNumeric =
          colType.includes("INT") ||
          colType.includes("DECIMAL") ||
          colType.includes("FLOAT") ||
          colType.includes("DOUBLE") ||
          colType.includes("NUMERIC") ||
          colType.includes("REAL") ||
          typeof rowData[rawColIdx] === "number";

        if (isColNumeric && typeof cellPayloadValue === "string") {
          cellPayloadValue = standardizeNumericString(cellPayloadValue);
        }

        stageCellUpdate({
          database,
          table,
          rowIndex: row,
          rowKey: rowKeyOf(rowData, dataResult.columns, activePkColumns),
          colIndex: rawColIdx,
          columnName: colName,
          originalValue: originalVal,
          stagedValue: cellPayloadValue,
          primaryKeys,
        });

        const rowIndexInData = dataResult.rows.indexOf(rowData);
        if (rowIndexInData !== -1 && rawColIdx !== -1) {
          const prevRow = newRows[rowIndexInData];
          newRows[rowIndexInData] = [...prevRow];
          inheritRowKey(prevRow, newRows[rowIndexInData]);
          newRows[rowIndexInData][rawColIdx] = cellPayloadValue;
        }

        modifiedCount++;
      }

      setDataResult((prev) => (prev ? { ...prev, rows: newRows } : prev));

      const valLabel = payloadValue === null ? "NULL" : `"${payloadValue}"`;
      setSaveStatus({
        success: true,
        message: `${modifiedCount} celda(s) establecidas en ${valLabel} (en cola).`,
      });
      setTimeout(() => setSaveStatus(null), 3000);
    },
    [
      dataResult,
      displayRows,
      effectiveColumnNames,
      getRawColIndex,
      getSelectedCells,
      isEditingAllowed,
      hasPrimaryKey,
      activePkColumns,
      stageCellUpdate,
      database,
      table,
    ],
  );

  // Set target cell or all selected cells in range to NULL
  const handleSetCellNull = useCallback(
    (targetCol?: number, targetRow?: number) => {
      if (targetCol !== undefined && targetRow !== undefined) {
        handleApplyValueToSelection(null, [[targetCol, targetRow]]);
      } else {
        handleApplyValueToSelection(null);
      }
    },
    [handleApplyValueToSelection],
  );

  // Native Glide Data Grid Clipboard Paste Handler
  const handlePaste = useCallback(
    (target: Item, values: readonly (readonly string[])[]): boolean => {
      if (!dataResult) return false;

      if (!isEditingAllowed) {
        useUIStore.getState().showAlert({
          title: "Edición Bloqueada",
          message:
            "Esta tabla no tiene una clave primaria y la configuración actual bloquea operaciones sin clave.",
          variant: "warning",
          icon: "alert",
        });
        return false;
      }

      const [targetCol, targetRow] = target;
      const visualColumnTypes = effectiveColumnNames.map((colName) => {
        const rawIdx = dataResult.columns.indexOf(colName);
        return rawIdx !== -1 ? (dataResult.column_types?.[rawIdx] || "") : "";
      });

      const validation = parseClipboardMatrix({
        targetCol,
        targetRow,
        matrix: values,
        columns: effectiveColumnNames,
        columnTypes: visualColumnTypes,
        rawColumns: dataResult.columns,
        displayRows,
        activePkColumns,
        hasPrimaryKey,
        isEditingAllowed,
      });

      if (validation.errors.length > 0) {
        useUIStore.getState().showAlert({
          title: "Error al Pegar",
          message: validation.errors.join("\n"),
          variant: "danger",
          icon: "alert",
        });
        return false;
      }

      if (validation.totalCells === 0) {
        return false;
      }

      // Single cell paste without PK modification or type warnings: apply immediately
      if (
        values.length === 1 &&
        values[0].length === 1 &&
        validation.pkColumnsAffected.length === 0 &&
        validation.warnings.length === 0
      ) {
        const single = validation.changes[0];
        onCellEdited(
          [single.col, single.row],
          {
            kind: GridCellKind.Text,
            data:
              single.proposedValue === null
                ? "NULL"
                : String(single.proposedValue),
          } as EditableGridCell,
        );
        return false;
      }

      // For block paste or operations with warnings/PK changes: open preview modal
      setPendingPasteValidation(validation);
      return false;
    },
    [
      dataResult,
      effectiveColumnNames,
      isEditingAllowed,
      displayRows,
      activePkColumns,
      hasPrimaryKey,
      onCellEdited,
    ],
  );

  // Apply validated block paste into Staged Changes and local grid view
  const handleConfirmPaste = useCallback(() => {
    if (!pendingPasteValidation || !dataResult) return;

    const stagedUpdates = pendingPasteValidation.changes.map((ch) => ({
      database,
      table,
      rowIndex: ch.row,
      rowKey: displayRows[ch.row]
        ? rowKeyOf(displayRows[ch.row], dataResult.columns, activePkColumns)
        : undefined,
      colIndex: ch.col,
      columnName: ch.columnName,
      originalValue: ch.originalValue,
      stagedValue: ch.proposedValue,
      primaryKeys: ch.primaryKeys,
    }));

    // Stage in batch in Zustand store
    stageBatchCellUpdates(stagedUpdates);

    // Apply immutable update to local rows state
    const newRows = dataResult.rows.map((r) => {
      const copy = [...r];
      inheritRowKey(r, copy);
      return copy;
    });
    for (const ch of pendingPasteValidation.changes) {
      const rowData = displayRows[ch.row];
      if (!rowData) continue;
      const rowIndexInData = dataResult.rows.indexOf(rowData);
      const rawIdx = dataResult.columns.indexOf(ch.columnName);
      if (rowIndexInData !== -1 && newRows[rowIndexInData] && rawIdx !== -1) {
        newRows[rowIndexInData][rawIdx] = ch.proposedValue;
      }
    }
    setDataResult((prev) => (prev ? { ...prev, rows: newRows } : prev));

    setSaveStatus({
      success: true,
      message: `${pendingPasteValidation.totalCells} celda(s) pegadas en cola (${pendingPasteValidation.affectedRowsCount} filas).`,
    });
    setTimeout(() => setSaveStatus(null), 4000);

    setPendingPasteValidation(null);
  }, [
    pendingPasteValidation,
    dataResult,
    database,
    table,
    displayRows,
    stageBatchCellUpdates,
  ]);

  // Native Glide Data Grid Delete Key Handler (Delete / Backspace on cells or rows)
  const handleDelete = useCallback(
    (selection: GridSelection): boolean => {
      if (!dataResult) return false;

      if (!isEditingAllowed) {
        useUIStore.getState().showAlert({
          title: "Operación Bloqueada",
          message:
            "Esta tabla no tiene una clave primaria y la configuración actual bloquea modificaciones sin clave.",
          variant: "warning",
          icon: "alert",
        });
        return false;
      }

      // 1. If full rows are selected (e.g. via row markers or row selections)
      if (selection.rows && selection.rows.length > 0) {
        const selectedIndices = selection.rows.toArray();
        const lowerCols = dataResult.columns.map((c) => c.toLowerCase());
        const changesToStage: Omit<StagedRowDelete, "type">[] = [];

        for (const rowIndex of selectedIndices) {
          const rowData = displayRows[rowIndex];
          if (!rowData) continue;

          const primaryKeys: PrimaryKeyCondition[] = [];
          if (hasPrimaryKey) {
            let validPk = true;
            for (const pkCol of activePkColumns) {
              const pkIdx = lowerCols.indexOf(pkCol.toLowerCase());
              if (
                pkIdx === -1 ||
                rowData[pkIdx] === undefined ||
                rowData[pkIdx] === null
              ) {
                validPk = false;
                break;
              }
              primaryKeys.push({ column: pkCol, value: rowData[pkIdx] });
            }
            if (!validPk) continue;
          } else {
            for (let idx = 0; idx < dataResult.columns.length; idx++) {
              primaryKeys.push({
                column: dataResult.columns[idx],
                value: rowData[idx] ?? null,
              });
            }
          }

          changesToStage.push({
            database,
            table,
            rowIndex,
            rowKey: rowKeyOf(rowData, dataResult.columns, activePkColumns),
            originalRow: rowData,
            primaryKeys,
          });
        }

        if (changesToStage.length > 0) {
          stageBatchRowDeletes(changesToStage);
          setSaveStatus({
            success: true,
            message: `${changesToStage.length} fila(s) marcadas para borrado en cola.`,
          });
          setTimeout(() => setSaveStatus(null), 3000);
        }
        return false;
      }

      // 2. If range or cells are selected: set cells to NULL
      const cells = getSelectedCells();
      if (cells.length > 0) {
        handleApplyValueToSelection(null, cells);
      }

      return false;
    },
    [
      dataResult,
      isEditingAllowed,
      displayRows,
      hasPrimaryKey,
      activePkColumns,
      database,
      table,
      stageBatchRowDeletes,
      getSelectedCells,
      handleApplyValueToSelection,
    ],
  );

  // Right-click context menu on grid cells
  const handleCellContextMenu = useCallback(
    ([col, row]: Item, event: any) => {
      event.preventDefault();
      if (col < 0 || row < 0) return;

      // If the right-clicked cell is NOT inside the current multi-cell selection range or selected column/row, update selection to this single cell
      const currentRange = gridSelection?.current?.range;
      const isInsideCurrentRange =
        currentRange &&
        col >= currentRange.x &&
        col < currentRange.x + currentRange.width &&
        row >= currentRange.y &&
        row < currentRange.y + currentRange.height;

      const isColSelected = Boolean(gridSelection?.columns?.hasIndex(col));
      const isRowSelected = Boolean(gridSelection?.rows?.hasIndex(row));

      if (!isInsideCurrentRange && !isColSelected && !isRowSelected) {
        setSelectedCell({ col, row });
        setSelectedRowIndex(row);
        setGridSelection({
          current: {
            cell: [col, row],
            range: { x: col, y: row, width: 1, height: 1 },
            rangeStack: [],
          },
          columns: CompactSelection.empty(),
          rows: CompactSelection.empty(),
        });
      }

      const clientX = lastMousePosRef.current.x;
      const clientY = lastMousePosRef.current.y;

      const menuWidth = 260;
      const menuHeight = 320;
      const x = Math.min(clientX, window.innerWidth - menuWidth - 10);
      const y = Math.min(clientY, window.innerHeight - menuHeight - 10);

      setIsCopySubmenuOpen(false);
      setCellContextMenu({
        x: Math.max(10, x),
        y: Math.max(10, y),
        col,
        row,
      });
    },
    [gridSelection],
  );

  // Resolves the list of row indices targeted by an action (from row selection, cell range, or single context row)
  const getSelectedRowIndices = useCallback(
    (contextRow?: number | null): number[] =>
      resolveSelectedRowIndices(
        gridSelection,
        contextRow !== undefined ? contextRow : selectedRowIndex,
        displayRows.length,
      ),
    [gridSelection, selectedRowIndex, displayRows.length],
  );

  const {
    handleStageDeleteRow,
    handleSaveRow,
    handleCreateRecord,
    handleApplyStagedChanges,
    handleDiscardStagedChanges,
  } = useRecordActions({
    activePkColumns,
    clearTableChanges,
    dataResult,
    database,
    dialect,
    displayRows,
    generateSqlForTable,
    getSelectedRowIndices,
    hasPrimaryKey,
    isEditingAllowed,
    loadData,
    onCellEdited,
    onRefresh,
    pageOffset,
    pageSize,
    selectedRowIndex,
    setIsApplyingStaged,
    setIsNewRecordModalOpen,
    setSaveStatus,
    stageBatchRowDeletes,
    stagedChangeCount,
    table,
  });

  return {
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
  };
}
