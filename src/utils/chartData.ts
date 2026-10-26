/** Pure helpers to turn a query result into chartable series. */

export const MAX_CHART_POINTS = 500;

export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "" && /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(value.trim())) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** A column is numeric when every non-null value parses as a number (and at least one exists). */
export function numericColumns(columns: string[], rows: unknown[][]): number[] {
  const sample = rows.slice(0, MAX_CHART_POINTS);
  return columns
    .map((_, i) => i)
    .filter((i) => {
      let seen = 0;
      for (const r of sample) {
        const v = r[i];
        if (v === null || v === undefined || v === "") continue;
        if (toNumber(v) === null) return false;
        seen++;
      }
      return seen > 0;
    });
}

export interface ChartSuggestion {
  labelIndex: number;
  valueIndexes: number[];
}

/**
 * Picks a label (first non-numeric column, else the first column) and up to
 * three numeric measures that are not the label. Returns null if nothing is chartable.
 */
export function suggestChart(columns: string[], rows: unknown[][]): ChartSuggestion | null {
  if (!columns.length || !rows.length) return null;
  const numeric = numericColumns(columns, rows);
  const labelIndex = columns.findIndex((_, i) => !numeric.includes(i));
  const label = labelIndex === -1 ? 0 : labelIndex;
  const values = numeric.filter((i) => i !== label).slice(0, 3);
  if (!values.length) return null;
  return { labelIndex: label, valueIndexes: values };
}

export function buildSeries(rows: unknown[][], labelIndex: number, valueIndexes: number[]) {
  const sliced = rows.slice(0, MAX_CHART_POINTS);
  return {
    labels: sliced.map((r) => (r[labelIndex] === null || r[labelIndex] === undefined ? "NULL" : String(r[labelIndex]))),
    series: valueIndexes.map((vi) => sliced.map((r) => toNumber(r[vi]) ?? 0)),
    truncated: rows.length > MAX_CHART_POINTS,
  };
}
