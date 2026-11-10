import { useCallback } from "react";
import { GridCellKind, type GridCell, type Item } from "@glideapps/glide-data-grid";
import type { TableDataResult } from "../../types/database";
import type { StagedCellUpdate } from "../../stores/stagedChangesStore";
import { formatCellDisplay } from "./cellFormat";

export interface CellContentParams {
  activeFont: string;
  dataResult: TableDataResult | null;
  displayRows: any[][];
  effectiveColumnNames: string[];
  getRawColIndex: (visualCol: number) => number;
  isEditingAllowed: boolean;
  isLight: boolean;
  stagedDeletedRows: Set<number>;
  stagedUpdatesMap: Map<string, StagedCellUpdate>;
}

/**
 * Glide cell supplier: formats each value for the canvas and highlights
 * staged edits and rows marked for deletion.
 */
export function useCellContent({
  activeFont,
  dataResult,
  displayRows,
  effectiveColumnNames,
  getRawColIndex,
  isEditingAllowed,
  isLight,
  stagedDeletedRows,
  stagedUpdatesMap,
}: CellContentParams) {
  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const rowData = displayRows[row];
      const rawColIdx = getRawColIndex(col);
      const colName = effectiveColumnNames[col] || dataResult?.columns[rawColIdx] || "";
      const originalVal = rowData && rawColIdx !== -1 ? rowData[rawColIdx] : null;

      // Check if this cell has a pending staged change
      const cellKey = `${colName}:${row}`;
      const stagedCell = stagedUpdatesMap.get(cellKey);
      const isRowDeleted = stagedDeletedRows.has(row);

      const value = stagedCell ? stagedCell.stagedValue : originalVal;
      const isReadonly = !isEditingAllowed || isRowDeleted;

      // Style overrides for Staged Changes
      let themeOverride: Record<string, any> | undefined;

      if (isRowDeleted) {
        themeOverride = {
          bgCell: isLight ? "rgba(239, 68, 68, 0.16)" : "rgba(239, 68, 68, 0.22)",
          textDark: isLight ? "#991b1b" : "#f87171",
          baseFontStyle: "line-through 11px monospace",
        };
      } else if (stagedCell) {
        themeOverride = {
          bgCell: isLight ? "rgba(245, 158, 11, 0.22)" : "rgba(245, 158, 11, 0.28)",
          textDark: isLight ? "#92400e" : "#fbbf24",
          baseFontStyle: "bold 11px monospace",
        };
      }

      const colType = (rawColIdx !== -1 ? dataResult?.column_types?.[rawColIdx] : "")?.toUpperCase() || "";
      const isBoolean =
        colType === "TINYINT(1)" ||
        colType === "BOOLEAN" ||
        colType.startsWith("TINYINT(1)");
      const isNumeric =
        !isBoolean &&
        (colType.includes("INT") ||
          colType.includes("DECIMAL") ||
          colType.includes("FLOAT") ||
          colType.includes("DOUBLE") ||
          colType.includes("NUMERIC") ||
          colType.includes("REAL") ||
          typeof originalVal === "number");
      const isJson = colType.includes("JSON");

      if (value === null || value === undefined) {
        if (isBoolean && !isRowDeleted && !stagedCell) {
          return {
            kind: GridCellKind.Boolean,
            data: null,
            allowOverlay: false,
            readonly: isReadonly,
            themeOverride,
          };
        }
        return {
          kind: GridCellKind.Text,
          allowOverlay: !isReadonly,
          readonly: isReadonly,
          displayData: "NULL",
          data: "",
          themeOverride: themeOverride || {
            textDark: isLight ? "#8a94a6" : "#8790a3",
            baseFontStyle: `italic 11px ${activeFont}`,
          },
        };
      }

      if (isBoolean && !isRowDeleted && !stagedCell) {
        const boolData =
          value === true ||
          value === 1 ||
          value === "1" ||
          String(value).toLowerCase() === "true";
        return {
          kind: GridCellKind.Boolean,
          data: boolData,
          allowOverlay: false,
          readonly: isReadonly,
          themeOverride,
        };
      }

      if (isNumeric && !isRowDeleted) {
        if (value === "") {
          return {
            kind: GridCellKind.Text,
            allowOverlay: !isReadonly,
            readonly: isReadonly,
            displayData: "",
            data: "",
            themeOverride,
          };
        }
        let strVal = typeof value === "string" ? value.trim() : String(value);
        if (/^-?\d+,\d+$/.test(strVal)) {
          strVal = strVal.replace(",", ".");
        } else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(strVal)) {
          strVal = strVal.replace(/,/g, "");
        } else if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(strVal)) {
          strVal = strVal.replace(/\./g, "").replace(",", ".");
        }

        const numVal = Number(strVal);
        if (!isNaN(numVal)) {
          return {
            kind: GridCellKind.Number,
            data: numVal,
            displayData: strVal,
            contentAlign: "right",
            thousandSeparator: false,
            decimalSeparator: ".",
            allowNegative: true,
            allowOverlay: !isReadonly,
            readonly: isReadonly,
            themeOverride,
          };
        }
      }

      if (value === "") {
        return {
          kind: GridCellKind.Text,
          allowOverlay: !isReadonly,
          readonly: isReadonly,
          displayData: "",
          data: "",
          themeOverride,
        };
      }

      if (value === "NULL") {
        return {
          kind: GridCellKind.Text,
          allowOverlay: !isReadonly,
          readonly: isReadonly,
          displayData: '"NULL"',
          data: "NULL",
          themeOverride: themeOverride || {
            textDark: isLight ? "#0f172a" : "#e2e8f0",
            baseFontStyle: `11px ${activeFont}`,
          },
        };
      }

      if (isJson) {
        const { displayData, fullData } = formatCellDisplay(value, true);
        return {
          kind: GridCellKind.Text,
          allowOverlay: !isReadonly,
          readonly: isReadonly,
          displayData,
          data: fullData,
          themeOverride: themeOverride || {
            textDark: isLight ? "#0284c7" : "#38bdf8",
            baseFontStyle: `11px ${activeFont}`,
          },
        };
      }

      const { displayData, fullData } = formatCellDisplay(value, false);

      return {
        kind: GridCellKind.Text,
        allowOverlay: !isReadonly,
        readonly: isReadonly,
        displayData,
        data: fullData,
        themeOverride,
      };
    },
    [
      displayRows,
      dataResult,
      effectiveColumnNames,
      getRawColIndex,
      isEditingAllowed,
      stagedUpdatesMap,
      stagedDeletedRows,
      isLight,
      activeFont,
    ],
  );
  return getCellContent;
}
