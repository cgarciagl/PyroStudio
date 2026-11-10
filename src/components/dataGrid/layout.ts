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
