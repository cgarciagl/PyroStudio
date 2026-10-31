import { describe, expect, it } from "vitest";
import { exportFormatAdvice } from "../exportFormatAdvice";

describe("exportFormatAdvice", () => {
  it("stays quiet for small or unknown sizes", () => {
    expect(exportFormatAdvice(undefined, "a.xlsx")).toBeNull();
    expect(exportFormatAdvice(10_000, "a.xlsx")).toBeNull();
  });

  it("stays quiet when a CSV format was chosen", () => {
    expect(exportFormatAdvice(5_000_000, "a.csv")).toBeNull();
    expect(exportFormatAdvice(5_000_000, "a.CSV.GZ")).toBeNull();
  });

  it("recommends CSV for large Excel exports", () => {
    expect(exportFormatAdvice(600_000, "a.xlsx")).toContain("CSV");
    const advice = exportFormatAdvice(3_000_000, "a.xlsx");
    expect(advice).toContain("3 hojas");
    expect(advice).toContain("por partes");
  });
});
