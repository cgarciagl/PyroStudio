import { rowKeyOf } from "./rowIdentity";
import {
  GridCellKind,
  Item,
  EditableGridCell,
} from "@glideapps/glide-data-grid";
import type {
  PrimaryKeyCondition,
} from "../../types/database";
import { dbService } from "../../services/tauriDb";
import { useUIStore } from "../../stores/uiStore";
import {
  type StagedRowDelete,
  areValuesEqual,
} from "../../stores/stagedChangesStore";
import {
  standardizeNumericString,
} from "../../utils/pasteParser";
import {
  formatCellForSql,
} from "../../utils/formatCopy";

import { qualifiedTable } from "../../services/sqlLiterals";





import type { GridEditingParams } from "./useGridEditing";
import { errorText } from "../../utils/errors";
export type RecordActionsParams = Pick<
  GridEditingParams,
  | "activePkColumns"
  | "clearTableChanges"
  | "dataResult"
  | "database"
  | "dialect"
  | "displayRows"
  | "generateSqlForTable"
  | "hasPrimaryKey"
  | "isEditingAllowed"
  | "loadData"
  | "onRefresh"
  | "pageOffset"
  | "pageSize"
  | "selectedRowIndex"
  | "setIsApplyingStaged"
  | "setIsNewRecordModalOpen"
  | "setSaveStatus"
  | "stageBatchRowDeletes"
  | "stagedChangeCount"
  | "table"
> & {
  getSelectedRowIndices: (contextRow?: number | null) => number[];
  onCellEdited: (cell: Item, newValue: EditableGridCell) => Promise<void>;
};

/**
 * Row-level actions: stage row deletions, save or create a record and apply
 * or discard every staged change of the table.
 */
export function useRecordActions({
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
}: RecordActionsParams) {
  // Stage Row Deletion for all selected rows instead of deleting immediately
  const handleStageDeleteRow = (contextRow?: number | null) => {
    if (!dataResult) return;

    if (!isEditingAllowed) {
      useUIStore.getState().showAlert({
        title: "Operación Bloqueada",
        message:
          "Esta tabla no tiene una clave primaria y la configuración actual bloquea modificaciones sin clave.",
        variant: "warning",
        icon: "alert",
      });
      return;
    }

    const rowIndices = getSelectedRowIndices(contextRow);
    if (rowIndices.length === 0) return;

    const lowerCols = dataResult.columns.map((c) => c.toLowerCase());

    if (hasPrimaryKey) {
      for (const pkCol of activePkColumns) {
        const pkIdx = lowerCols.indexOf(pkCol.toLowerCase());
        if (pkIdx === -1) {
          useUIStore.getState().showAlert({
            title: "Columna Faltante",
            message: `La columna de clave primaria '${pkCol}' no está presente en los resultados.`,
            variant: "danger",
            icon: "alert",
          });
          return;
        }
      }
    }

    const changesToStage: Omit<StagedRowDelete, "type">[] = [];

    for (const rIdx of rowIndices) {
      const currentRow = displayRows[rIdx];
      if (!currentRow) continue;

      const primaryKeys: PrimaryKeyCondition[] = [];
      if (hasPrimaryKey) {
        for (const pkCol of activePkColumns) {
          const pkIdx = lowerCols.indexOf(pkCol.toLowerCase());
          const pkVal = currentRow[pkIdx];
          primaryKeys.push({ column: pkCol, value: pkVal });
        }
      } else {
        for (let idx = 0; idx < dataResult.columns.length; idx++) {
          primaryKeys.push({
            column: dataResult.columns[idx],
            value: currentRow[idx] ?? null,
          });
        }
      }

      changesToStage.push({
        database,
        table,
        rowIndex: rIdx,
        rowKey: rowKeyOf(currentRow, dataResult.columns, activePkColumns),
        originalRow: currentRow,
        primaryKeys,
      });
    }

    if (changesToStage.length > 0) {
      stageBatchRowDeletes(changesToStage);

      setSaveStatus({
        success: true,
        message:
          changesToStage.length === 1
            ? `Fila #${rowIndices[0] + 1} marcada para eliminación en cambios pendientes.`
            : `${changesToStage.length} filas marcadas para eliminación en cambios pendientes.`,
      });
      setTimeout(() => setSaveStatus(null), 3000);
    }
  };

  // Save complete row from EditRecordModal
  const handleSaveRow = async (updatedRow: any[]) => {
    if (selectedRowIndex === null || !dataResult || !displayRows[selectedRowIndex]) return;

    for (let c = 0; c < dataResult.columns.length; c++) {
      const oldVal = displayRows[selectedRowIndex][c];
      const newVal = updatedRow[c];
      if (!areValuesEqual(oldVal, newVal)) {
        onCellEdited([c, selectedRowIndex], {
          kind: GridCellKind.Text,
          data: newVal === null ? "NULL" : String(newVal),
        } as EditableGridCell);
      }
    }
  };

  // Create new record
  const handleCreateRecord = async (newRowValues: any[]) => {
    if (!database || !table) {
      throw new Error("No se ha especificado la tabla destino para insertar el registro.");
    }

    const rawCols = dataResult?.columns || [];
    const colsToInsert: string[] = [];
    const valsToInsert: string[] = [];

    for (let i = 0; i < rawCols.length; i++) {
      const colName = rawCols[i];
      let val = newRowValues[i];

      const isPk = activePkColumns.includes(colName);
      if (isPk && (val === null || val === undefined || val === "")) {
        continue;
      }

      const colType = (dataResult?.column_types?.[i] || "").toUpperCase();
      const isColNumeric =
        colType.includes("INT") ||
        colType.includes("DECIMAL") ||
        colType.includes("FLOAT") ||
        colType.includes("DOUBLE") ||
        colType.includes("NUMERIC") ||
        colType.includes("REAL");
      if (isColNumeric && typeof val === "string") {
        val = standardizeNumericString(val);
      }

      colsToInsert.push(dialect.quoteIdentifier(colName));
      valsToInsert.push(formatCellForSql(val, dialect));
    }

    if (colsToInsert.length === 0) {
      throw new Error("No se proporcionó ningún valor para insertar.");
    }

    const insertSql = `INSERT INTO ${qualifiedTable(dialect, database, table)} (${colsToInsert.join(", ")}) VALUES (${valsToInsert.join(", ")});`;

    try {
      await dbService.executeConfirmedQuery(insertSql, database);
      setSaveStatus({
        success: true,
        message: `Registro insertado exitosamente en \`${table}\`.`,
      });
      setTimeout(() => setSaveStatus(null), 3500);
      setIsNewRecordModalOpen(false);

      if (onRefresh) {
        onRefresh();
      } else {
        await loadData(pageOffset, pageSize);
      }
    } catch (err: unknown) {
      const msg = errorText(err, "Error al insertar registro");
      throw new Error(msg);
    }
  };

  // Apply all staged changes transaccationally to MariaDB/MySQL
  const handleApplyStagedChanges = async () => {
    if (stagedChangeCount === 0) return;
    setIsApplyingStaged(true);
    const sqlStatements = generateSqlForTable(database, table, dialect);

    try {
      await dbService.executeTransaction(database, sqlStatements);
      clearTableChanges(database, table);
      setSaveStatus({
        success: true,
        message: `${sqlStatements.length} cambio(s) aplicados atómicamente a ${database}.${table}.`,
      });
      setTimeout(() => setSaveStatus(null), 4000);
      // Reload fresh data from table
      await loadData(pageOffset, pageSize);
    } catch (err: unknown) {
      const msg = errorText(err, "Error al aplicar lote");
      setSaveStatus({
        success: false,
        message: `Error en transacción: ${msg}`,
      });
      setTimeout(() => setSaveStatus(null), 7000);
    } finally {
      setIsApplyingStaged(false);
    }
  };

  // Discard local staged changes and reload table
  const handleDiscardStagedChanges = () => {
    clearTableChanges(database, table);
    setSaveStatus({
      success: true,
      message: "Cambios pendientes descartados.",
    });
    setTimeout(() => setSaveStatus(null), 3000);
    loadData(pageOffset, pageSize);
  };

  return {
    handleStageDeleteRow,
    handleSaveRow,
    handleCreateRecord,
    handleApplyStagedChanges,
    handleDiscardStagedChanges,
  };
}
