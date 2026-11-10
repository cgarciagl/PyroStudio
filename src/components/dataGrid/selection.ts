import type { GridSelection, Item } from "@glideapps/glide-data-grid";

/**
 * Pure selection helpers for the data grid. They translate a glide
 * `GridSelection` (plus the fallback single-cell / single-row state) into
 * cell lists, row indices and data matrices without touching React state.
 */

export interface SelectedCellRef {
  col: number;
  row: number;
}

/** Maps a visual column to the raw column index in the result set. */
export function resolveRawColIndex(
  visualCol: number,
  effectiveColumnNames: string[],
  rawColumns: string[] | undefined,
): number {
  if (!rawColumns) return visualCol;
  const colName = effectiveColumnNames[visualCol];
  if (!colName) return visualCol;
  const idx = rawColumns.indexOf(colName);
  return idx !== -1 ? idx : visualCol;
}

/** Every [col, row] covered by the selection, deduplicated, in discovery order. */
export function collectSelectedCells(params: {
  gridSelection: GridSelection | undefined;
  rowCount: number;
  colCount: number;
  hasData: boolean;
  selectedCell: SelectedCellRef | null;
}): Item[] {
  const { gridSelection, rowCount, colCount, hasData, selectedCell } = params;
  const cellSet = new Set<string>();
  const result: Item[] = [];

  const addCell = (c: number, r: number) => {
    const key = `${c}:${r}`;
    if (!cellSet.has(key)) {
      cellSet.add(key);
      result.push([c, r]);
    }
  };

  if (gridSelection?.columns && gridSelection.columns.length > 0) {
    for (const c of gridSelection.columns.toArray()) {
      for (let r = 0; r < rowCount; r++) addCell(c, r);
    }
  }

  if (gridSelection?.rows && gridSelection.rows.length > 0 && hasData) {
    for (const r of gridSelection.rows.toArray()) {
      for (let c = 0; c < colCount; c++) addCell(c, r);
    }
  }

  if (gridSelection?.current) {
    const { range, rangeStack } = gridSelection.current;
    for (const rng of [range, ...(rangeStack || [])]) {
      for (let r = rng.y; r < rng.y + rng.height; r++) {
        for (let c = rng.x; c < rng.x + rng.width; c++) addCell(c, r);
      }
    }
  }

  if (result.length > 0) return result;
  if (selectedCell) return [[selectedCell.col, selectedCell.row]];
  return [];
}

/** Rectangular data matrix for the active selection (columns, rows, range, cell or row). */
export function buildSelectedDataMatrix(params: {
  gridSelection: GridSelection | undefined;
  rawColumns: string[];
  effectiveColumnNames: string[];
  displayRows: any[][];
  getRawColIndex: (visualCol: number) => number;
  selectedCell: SelectedCellRef | null;
  selectedRowIndex: number | null;
}): { columns: string[]; rows: any[][] } {
  const {
    gridSelection,
    rawColumns,
    effectiveColumnNames,
    displayRows,
    getRawColIndex,
    selectedCell,
    selectedRowIndex,
  } = params;

  const rowByName = (r: any[], cols: string[]) =>
    cols.map((colName) => {
      const rawIdx = rawColumns.indexOf(colName);
      return rawIdx !== -1 ? r[rawIdx] : null;
    });

  // 1. Column selection: full columns
  if (gridSelection?.columns && gridSelection.columns.length > 0) {
    const selectedColIndices = gridSelection.columns.toArray();
    const cols = selectedColIndices.map((ci) => effectiveColumnNames[ci] || rawColumns[ci]);
    const rows = displayRows.map((r) =>
      selectedColIndices.map((ci) => {
        const rawIdx = getRawColIndex(ci);
        return rawIdx !== -1 ? r[rawIdx] : null;
      }),
    );
    return { columns: cols, rows };
  }

  // 2. Row selection: full rows
  if (gridSelection?.rows && gridSelection.rows.length > 0) {
    const cols = effectiveColumnNames;
    const rows = gridSelection.rows
      .toArray()
      .filter((ri) => ri >= 0 && ri < displayRows.length)
      .map((ri) => rowByName(displayRows[ri], cols));
    return { columns: cols, rows };
  }

  // 3. Rectangular cell range selection
  if (gridSelection?.current?.range) {
    const { x, y, width, height } = gridSelection.current.range;
    if (width > 0 && height > 0) {
      const selectedColNames = effectiveColumnNames.slice(x, x + width);
      const rows: any[][] = [];
      const endRow = Math.min(y + height, displayRows.length);
      for (let r = y; r < endRow; r++) {
        const rowData = displayRows[r];
        if (!rowData) continue;
        const rowVals: any[] = [];
        for (let c = x; c < x + width; c++) {
          const rawIdx = getRawColIndex(c);
          rowVals.push(rawIdx !== -1 ? rowData[rawIdx] : null);
        }
        rows.push(rowVals);
      }
      return { columns: selectedColNames, rows };
    }
  }

  // 4. Single selected cell
  if (selectedCell) {
    const rawIdx = getRawColIndex(selectedCell.col);
    const colName = effectiveColumnNames[selectedCell.col] || rawColumns[rawIdx] || "";
    const rowData = displayRows[selectedCell.row];
    const val = rowData && rawIdx !== -1 ? rowData[rawIdx] : null;
    return { columns: [colName], rows: [[val]] };
  }

  // 5. Fallback single row index
  if (selectedRowIndex !== null && displayRows[selectedRowIndex]) {
    const cols = effectiveColumnNames;
    return { columns: cols, rows: [rowByName(displayRows[selectedRowIndex], cols)] };
  }

  return { columns: [], rows: [] };
}

/** True if a multi-cell range, row selection, or column selection is active. */
export function isSelectionRange(gridSelection: GridSelection | undefined): boolean {
  if (!gridSelection) return false;
  if (gridSelection.rows && gridSelection.rows.length > 0) return true;
  if (gridSelection.columns && gridSelection.columns.length > 0) return true;
  if (gridSelection.current?.range) {
    const { width, height } = gridSelection.current.range;
    if (width > 1 || height > 1) return true;
    if (gridSelection.current.rangeStack && gridSelection.current.rangeStack.length > 0) return true;
  }
  return false;
}

/**
 * Rows an action (delete, duplicate…) should target. A context-menu row
 * outside the current selection targets only itself.
 */
export function resolveSelectedRowIndices(
  gridSelection: GridSelection | undefined,
  target: number | null | undefined,
  rowCount: number,
): number[] {
  const inBounds = (r: number) => r >= 0 && r < rowCount;
  const hasTarget = target !== null && target !== undefined;

  // 1. Explicit row selection via checkboxes or row headers
  if (gridSelection?.rows && gridSelection.rows.length > 0) {
    if (!hasTarget || gridSelection.rows.hasIndex(target)) {
      return Array.from(new Set(gridSelection.rows.toArray())).filter(inBounds);
    }
    return [target].filter(inBounds);
  }

  // 2. Rectangular selection spanning rows
  if (gridSelection?.current?.range) {
    const allRanges = [gridSelection.current.range, ...(gridSelection.current.rangeStack || [])];
    const isTargetInsideAnyRange =
      hasTarget && allRanges.some((rng) => target >= rng.y && target < rng.y + rng.height);

    if (!hasTarget || isTargetInsideAnyRange) {
      const rowSet = new Set<number>();
      for (const rng of allRanges) {
        for (let r = rng.y; r < rng.y + rng.height; r++) {
          if (inBounds(r)) rowSet.add(r);
        }
      }
      if (rowSet.size > 0) return Array.from(rowSet);
    }
  }

  // 3. Fallback to target row
  if (hasTarget && inBounds(target)) return [target];
  return [];
}
