import { useCallback, useEffect, useMemo, useState } from "react";
import type { GridColumn } from "@glideapps/glide-data-grid";
import type { TableDataResult } from "../../types/database";
import { estimateColumnWidth, getStoredLayout, mergeColumnOrder, saveStoredLayout } from "./layout";
import { resolveRawColIndex } from "./selection";

/**
 * Column order, custom widths and frozen columns of the grid, persisted per
 * table in localStorage.
 */
export function useColumnLayout(database: string, table: string, dataResult: TableDataResult | null) {
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [customWidths, setCustomWidths] = useState<Record<string, number>>({});
  const [freezeColumnsCount, setFreezeColumnsCount] = useState<number>(0);

  // Load layout from localStorage when table changes
  useEffect(() => {
    const saved = getStoredLayout(database, table);
    setCustomWidths(saved.customWidths || {});
    setFreezeColumnsCount(saved.freezeColumns ?? 0);
  }, [database, table]);

  // Synchronize column order when dataResult columns change
  useEffect(() => {
    if (!dataResult || !dataResult.columns) return;
    const saved = getStoredLayout(database, table);
    if (saved.columnOrder && saved.columnOrder.length > 0) {
      setColumnOrder(mergeColumnOrder(saved.columnOrder, dataResult.columns));
    } else {
      setColumnOrder([...dataResult.columns]);
    }
  }, [dataResult?.columns, database, table]);

  const effectiveColumnNames = useMemo(() => {
    if (!dataResult || !dataResult.columns) return [];
    if (columnOrder.length === 0) return dataResult.columns;
    return mergeColumnOrder(columnOrder, dataResult.columns);
  }, [dataResult, columnOrder]);

  const getRawColIndex = useCallback(
    (visualCol: number): number =>
      resolveRawColIndex(visualCol, effectiveColumnNames, dataResult?.columns),
    [dataResult, effectiveColumnNames],
  );

  const updateWidths = useCallback(
    (update: (prev: Record<string, number>) => Record<string, number>) => {
      setCustomWidths((prev) => {
        const next = update(prev);
        saveStoredLayout(database, table, {
          columnOrder: effectiveColumnNames,
          customWidths: next,
          freezeColumns: freezeColumnsCount,
        });
        return next;
      });
    },
    [database, table, effectiveColumnNames, freezeColumnsCount],
  );

  const handleColumnResize = useCallback(
    (column: GridColumn, newSize: number) => {
      if (column.id) {
        updateWidths((prev) => ({ ...prev, [column.id!]: Math.max(70, Math.round(newSize)) }));
      }
    },
    [updateWidths],
  );

  const handleColumnMoved = useCallback(
    (startIndex: number, endIndex: number) => {
      setColumnOrder((prev) => {
        const base = prev.length > 0 ? [...prev] : [...effectiveColumnNames];
        const [moved] = base.splice(startIndex, 1);
        base.splice(endIndex, 0, moved);
        saveStoredLayout(database, table, {
          columnOrder: base,
          customWidths,
          freezeColumns: freezeColumnsCount,
        });
        return base;
      });
    },
    [database, table, effectiveColumnNames, customWidths, freezeColumnsCount],
  );

  const autoSizeColumn = useCallback(
    (colName: string) => {
      if (!dataResult) return;
      const rawIdx = dataResult.columns.indexOf(colName);
      if (rawIdx === -1) return;
      const width = estimateColumnWidth(colName, dataResult.column_types?.[rawIdx], dataResult.rows, rawIdx);
      updateWidths((prev) => ({ ...prev, [colName]: width }));
    },
    [dataResult, updateWidths],
  );

  const resetColumnWidths = useCallback(() => {
    setCustomWidths({});
    saveStoredLayout(database, table, {
      columnOrder: effectiveColumnNames,
      customWidths: {},
      freezeColumns: freezeColumnsCount,
    });
  }, [database, table, effectiveColumnNames, freezeColumnsCount]);

  const toggleFreezeColumn = useCallback(
    (colIndex: number) => {
      const newCount = freezeColumnsCount === colIndex + 1 ? 0 : colIndex + 1;
      setFreezeColumnsCount(newCount);
      saveStoredLayout(database, table, {
        columnOrder: effectiveColumnNames,
        customWidths,
        freezeColumns: newCount,
      });
    },
    [database, table, effectiveColumnNames, customWidths, freezeColumnsCount],
  );

  return {
    effectiveColumnNames,
    getRawColIndex,
    customWidths,
    freezeColumnsCount,
    handleColumnResize,
    handleColumnMoved,
    autoSizeColumn,
    resetColumnWidths,
    toggleFreezeColumn,
  };
}
