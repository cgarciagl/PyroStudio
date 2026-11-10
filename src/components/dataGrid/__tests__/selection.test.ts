import { describe, it, expect } from "vitest";
import { CompactSelection, type GridSelection } from "@glideapps/glide-data-grid";
import {
  buildSelectedDataMatrix,
  collectSelectedCells,
  isSelectionRange,
  resolveRawColIndex,
  resolveSelectedRowIndices,
} from "../selection";

const sel = (over: Partial<GridSelection> = {}): GridSelection => ({
  columns: CompactSelection.empty(),
  rows: CompactSelection.empty(),
  current: undefined,
  ...over,
});
const range = (x: number, y: number, width: number, height: number, rangeStack: any[] = []) => ({
  cell: [x, y] as [number, number],
  range: { x, y, width, height },
  rangeStack,
});

const raw = ["id", "name", "age"];
const visual = ["name", "id", "age"]; // reordered
const rows = [
  [1, "ana", 30],
  [2, "bob", 40],
  [3, "eva", 50],
];
const getRaw = (c: number) => resolveRawColIndex(c, visual, raw);

describe("resolveRawColIndex", () => {
  it("maps reordered visual columns to raw indices", () => {
    expect(getRaw(0)).toBe(1);
    expect(getRaw(1)).toBe(0);
  });
  it("falls back to the visual index when unknown", () => {
    expect(resolveRawColIndex(5, visual, raw)).toBe(5);
    expect(resolveRawColIndex(0, visual, undefined)).toBe(0);
  });
});

describe("collectSelectedCells", () => {
  const base = { rowCount: 3, colCount: 3, hasData: true, selectedCell: null };
  it("deduplicates overlapping ranges", () => {
    const cells = collectSelectedCells({
      ...base,
      gridSelection: sel({ current: range(0, 0, 2, 1, [{ x: 1, y: 0, width: 1, height: 2 }]) }),
    });
    expect(cells).toEqual([[0, 0], [1, 0], [1, 1]]);
  });
  it("expands full column selections", () => {
    const cells = collectSelectedCells({ ...base, gridSelection: sel({ columns: CompactSelection.fromSingleSelection(2) }) });
    expect(cells).toEqual([[2, 0], [2, 1], [2, 2]]);
  });
  it("falls back to the single selected cell", () => {
    expect(collectSelectedCells({ ...base, gridSelection: undefined, selectedCell: { col: 1, row: 2 } })).toEqual([[1, 2]]);
  });
});

describe("buildSelectedDataMatrix", () => {
  const base = { rawColumns: raw, effectiveColumnNames: visual, displayRows: rows, getRawColIndex: getRaw, selectedCell: null, selectedRowIndex: null };
  it("extracts a rectangular range in visual order", () => {
    const m = buildSelectedDataMatrix({ ...base, gridSelection: sel({ current: range(0, 1, 2, 5) }) });
    expect(m).toEqual({ columns: ["name", "id"], rows: [["bob", 2], ["eva", 3]] });
  });
  it("extracts full rows", () => {
    const m = buildSelectedDataMatrix({ ...base, gridSelection: sel({ rows: CompactSelection.fromSingleSelection(0) }) });
    expect(m).toEqual({ columns: visual, rows: [["ana", 1, 30]] });
  });
  it("extracts full columns", () => {
    const m = buildSelectedDataMatrix({ ...base, gridSelection: sel({ columns: CompactSelection.fromSingleSelection(2) }) });
    expect(m).toEqual({ columns: ["age"], rows: [[30], [40], [50]] });
  });
  it("uses the single cell and then the row fallback", () => {
    expect(buildSelectedDataMatrix({ ...base, gridSelection: undefined, selectedCell: { col: 0, row: 2 } })).toEqual({ columns: ["name"], rows: [["eva"]] });
    expect(buildSelectedDataMatrix({ ...base, gridSelection: undefined, selectedRowIndex: 1 })).toEqual({ columns: visual, rows: [["bob", 2, 40]] });
    expect(buildSelectedDataMatrix({ ...base, gridSelection: undefined })).toEqual({ columns: [], rows: [] });
  });
});

describe("isSelectionRange", () => {
  it("is false for a single cell and true for ranges", () => {
    expect(isSelectionRange(undefined)).toBe(false);
    expect(isSelectionRange(sel({ current: range(1, 1, 1, 1) }))).toBe(false);
    expect(isSelectionRange(sel({ current: range(1, 1, 2, 1) }))).toBe(true);
    expect(isSelectionRange(sel({ rows: CompactSelection.fromSingleSelection(0) }))).toBe(true);
  });
});

describe("resolveSelectedRowIndices", () => {
  it("uses the row selection when the target is inside it", () => {
    const g = sel({ rows: CompactSelection.fromSingleSelection([0, 2]) });
    expect(resolveSelectedRowIndices(g, 1, 3)).toEqual([0, 1]);
  });
  it("targets only the context row when outside the selection", () => {
    const g = sel({ rows: CompactSelection.fromSingleSelection(0) });
    expect(resolveSelectedRowIndices(g, 2, 3)).toEqual([2]);
    expect(resolveSelectedRowIndices(sel({ current: range(0, 0, 1, 2) }), 2, 3)).toEqual([2]);
  });
  it("collects rows spanned by ranges, clamped to bounds", () => {
    expect(resolveSelectedRowIndices(sel({ current: range(0, 1, 1, 10) }), null, 3)).toEqual([1, 2]);
  });
  it("returns nothing for an out-of-bounds target", () => {
    expect(resolveSelectedRowIndices(undefined, 9, 3)).toEqual([]);
  });
});
