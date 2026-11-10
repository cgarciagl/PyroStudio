import type { GridColumn } from "@glideapps/glide-data-grid";
import type { ForeignKeyMetadata, TableDataResult } from "../../types/database";
import { evaluateFilterRuleClient, type FilterRule } from "../VisualFilterBuilder";

/** Glide column definitions: key/FK prefix, type, sort indicator and estimated width. */
export function buildGridColumns(params: {
  dataResult: TableDataResult | null;
  effectiveColumnNames: string[];
  activePkColumns: string[];
  fkByColumn: Map<string, ForeignKeyMetadata>;
  customWidths: Record<string, number>;
  sortColumn: string | null;
  sortDirection: "ASC" | "DESC" | null;
}): GridColumn[] {
  const { dataResult, effectiveColumnNames, activePkColumns, fkByColumn, customWidths, sortColumn, sortDirection } =
    params;
  if (!dataResult || !dataResult.columns) return [];
  return effectiveColumnNames.map((col) => {
    const rawIdx = dataResult.columns.indexOf(col);
    const colType = rawIdx !== -1 && dataResult.column_types?.[rawIdx] ? ` (${dataResult.column_types[rawIdx]})` : "";
    const isPk = activePkColumns.includes(col);
    const fk = fkByColumn.get(col.toLowerCase());

    let prefix = "";
    if (isPk) prefix = "🔑 ";
    else if (fk) prefix = "🔗 ";

    let sortIndicator = "";
    if (sortColumn === col) {
      sortIndicator = sortDirection === "ASC" ? " ▲" : " ▼";
    }

    // Auto estimate width based on header title + sampled cell contents
    let estimatedWidth = Math.max(140, (col.length + colType.length) * 9 + 50);
    if (dataResult.rows && dataResult.rows.length > 0 && rawIdx !== -1) {
      const sampleLimit = Math.min(50, dataResult.rows.length);
      for (let r = 0; r < sampleLimit; r++) {
        const val = dataResult.rows[r][rawIdx];
        if (val !== null && val !== undefined) {
          const strLen = String(val).length;
          estimatedWidth = Math.max(estimatedWidth, Math.min(650, strLen * 8.8 + 40));
        }
      }
    }

    return {
      title: `${prefix}${col}${colType}${sortIndicator}`,
      id: col,
      width: customWidths[col] ?? Math.round(estimatedWidth),
      hasMenu: true,
    };
  });
}

/** In-memory sort (query results): NULLs last, numeric-aware string compare. */
export function sortRowsClient(
  rows: any[][],
  rawIdx: number,
  direction: "ASC" | "DESC",
): any[][] {
  return [...rows].sort((a, b) => {
    const valA = a[rawIdx];
    const valB = b[rawIdx];
    if (valA === valB) return 0;
    if (valA === null || valA === undefined) return 1;
    if (valB === null || valB === undefined) return -1;

    let cmp = 0;
    if (typeof valA === "number" && typeof valB === "number") {
      cmp = valA - valB;
    } else {
      cmp = String(valA).localeCompare(String(valB), undefined, {
        numeric: true,
        sensitivity: "base",
      });
    }
    return direction === "ASC" ? cmp : -cmp;
  });
}

/** Rows matching every enabled visual filter rule (evaluated in memory). */
export function filterRowsByRules(rows: any[][], columns: string[], rules: FilterRule[]): any[][] {
  const activeRules = rules.filter((r) => r.enabled && r.column.trim());
  if (activeRules.length === 0) return rows;
  return rows.filter((row) =>
    activeRules.every((rule) => {
      const colIdx = columns.indexOf(rule.column);
      if (colIdx === -1) return true;
      return evaluateFilterRuleClient(row[colIdx], rule);
    }),
  );
}

/** Rows where any cell contains the search term (case-insensitive). */
export function searchRows(rows: any[][], searchTerm: string): any[][] {
  if (!searchTerm.trim()) return rows;
  const term = searchTerm.toLowerCase();
  return rows.filter((row) =>
    row.some((val) => (val !== null && val !== undefined ? String(val).toLowerCase().includes(term) : false)),
  );
}
