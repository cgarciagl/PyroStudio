import { describe, expect, it } from "vitest";
import { buildSeries, MAX_CHART_POINTS, numericColumns, suggestChart, toNumber } from "../chartData";

describe("chartData", () => {
  it("parses numbers including numeric strings from DECIMAL columns", () => {
    expect(toNumber(3)).toBe(3);
    expect(toNumber("12.50")).toBe(12.5);
    expect(toNumber("1e3")).toBe(1000);
    expect(toNumber("abc")).toBeNull();
    expect(toNumber("2024-01-01")).toBeNull();
    expect(toNumber(null)).toBeNull();
  });

  it("detects numeric columns ignoring nulls", () => {
    const rows = [["a", 1, "x"], ["b", null, "2"], ["c", "3.5", "y"]];
    expect(numericColumns(["n", "v", "m"], rows)).toEqual([1]);
  });

  it("suggests label + measures for a GROUP BY result", () => {
    const s = suggestChart(["periodo", "total", "promedio"], [["2024", 10, "1.5"], ["2025", 12, "2.0"]]);
    expect(s).toEqual({ labelIndex: 0, valueIndexes: [1, 2] });
  });

  it("returns null when nothing is chartable", () => {
    expect(suggestChart(["a", "b"], [["x", "y"]])).toBeNull();
    expect(suggestChart(["id"], [[1], [2]])).toBeNull();
    expect(suggestChart([], [])).toBeNull();
  });

  it("caps points and flags truncation", () => {
    const rows = Array.from({ length: MAX_CHART_POINTS + 10 }, (_, i) => [`k${i}`, i]);
    const r = buildSeries(rows, 0, [1]);
    expect(r.labels).toHaveLength(MAX_CHART_POINTS);
    expect(r.truncated).toBe(true);
    expect(buildSeries([[null, "x"]], 0, [1])).toMatchObject({ labels: ["NULL"], series: [[0]] });
  });
});
