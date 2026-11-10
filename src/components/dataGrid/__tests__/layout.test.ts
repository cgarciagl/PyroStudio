import { describe, it, expect } from "vitest";
import { estimateColumnWidth, mergeColumnOrder } from "../layout";

describe("mergeColumnOrder", () => {
  it("keeps saved order, drops vanished columns and appends new ones", () => {
    expect(mergeColumnOrder(["b", "x", "a"], ["a", "b", "c"])).toEqual(["b", "a", "c"]);
  });
});

describe("estimateColumnWidth", () => {
  it("uses at least the minimum width", () => {
    expect(estimateColumnWidth("id", undefined, [], 0)).toBe(90);
  });
  it("grows with header and values, capped at 650", () => {
    expect(estimateColumnWidth("name", "varchar(255)", [], 0)).toBe(Math.round((4 + 15) * 9 + 60));
    expect(estimateColumnWidth("c", undefined, [["x".repeat(10_000)]], 0)).toBe(650);
  });
  it("ignores null values", () => {
    expect(estimateColumnWidth("c", undefined, [[null], [undefined]], 0)).toBe(90);
  });
});
