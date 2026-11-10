/** Persisted per-table grid layout (column order, widths, frozen columns). */
export interface TableGridLayout {
  columnOrder?: string[];
  customWidths?: Record<string, number>;
  freezeColumns?: number;
}

export const getStoredLayout = (db: string, tbl?: string): TableGridLayout => {
  try {
    const key = tbl ? `pyro_grid_layout_${db}_${tbl}` : `pyro_grid_layout_${db}_query_results`;
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch {
    // fallback
  }
  return {};
};

export const saveStoredLayout = (db: string, tbl: string | undefined, layout: TableGridLayout) => {
  try {
    const key = tbl ? `pyro_grid_layout_${db}_${tbl}` : `pyro_grid_layout_${db}_query_results`;
    localStorage.setItem(key, JSON.stringify(layout));
  } catch {
    // ignore
  }
};

/**
 * Width that fits a column's header (name + type) and a sample of its
 * first 100 values, clamped to a readable range.
 */
export function estimateColumnWidth(
  colName: string,
  colType: string | undefined,
  rows: any[][] | undefined,
  rawIdx: number,
): number {
  const typeLabel = colType ? ` (${colType})` : "";
  let calculatedWidth = (colName.length + typeLabel.length) * 9 + 60;
  if (rows && rows.length > 0) {
    const sampleLimit = Math.min(100, rows.length);
    for (let r = 0; r < sampleLimit; r++) {
      const val = rows[r][rawIdx];
      if (val !== null && val !== undefined) {
        const strLen = String(val).length;
        calculatedWidth = Math.max(calculatedWidth, Math.min(650, strLen * 8.8 + 40));
      }
    }
  }
  return Math.max(90, Math.round(calculatedWidth));
}

/** Saved order first (dropping vanished columns), then any new columns. */
export function mergeColumnOrder(order: string[], columns: string[]): string[] {
  const existing = order.filter((c) => columns.includes(c));
  const missing = columns.filter((c) => !existing.includes(c));
  return [...existing, ...missing];
}
