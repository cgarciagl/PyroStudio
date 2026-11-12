import { describe, it, expect } from "vitest";
import { formatSeconds, matchesFilter } from "../format";

describe("slow query format", () => {
  it("formats durations at a readable scale", () => {
    expect(formatSeconds(0.00084)).toBe("0.84 ms");
    expect(formatSeconds(0.0123)).toBe("12.3 ms");
    expect(formatSeconds(1.4234)).toBe("1.42 s");
    expect(formatSeconds(185)).toBe("3 min 05 s");
    expect(formatSeconds(0)).toBe("0 s");
  });
  it("filters across several texts, ignoring case", () => {
    expect(matchesFilter("ventas", "SELECT * FROM VENTAS", null)).toBe(true);
    expect(matchesFilter("x", "a", undefined)).toBe(false);
    expect(matchesFilter("  ", "a")).toBe(true);
  });
});
