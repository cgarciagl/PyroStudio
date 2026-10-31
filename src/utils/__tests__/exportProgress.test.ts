import { describe, it, expect } from "vitest";
import { formatEta, formatExportProgress } from "../exportProgress";

describe("export progress", () => {
  it("estimates the remaining time from the rate", () => {
    expect(formatEta({ rows_written: 1000, stage: "", rows_per_sec: 100 }, 2000)).toBe("~10 s");
    expect(formatEta({ rows_written: 0, stage: "", rows_per_sec: 100 }, 30000)).toBe("~5 min");
    expect(formatEta({ rows_written: 0, stage: "", rows_per_sec: 1 }, 5400)).toBe("~1 h 30 min");
  });

  it("has no estimate without rate, total or once past the estimate", () => {
    expect(formatEta({ rows_written: 10, stage: "" }, 100)).toBeNull();
    expect(formatEta({ rows_written: 10, stage: "", rows_per_sec: 5 })).toBeNull();
    expect(formatEta({ rows_written: 200, stage: "", rows_per_sec: 5 }, 100)).toBeNull();
  });

  it("omits the rate when it is not known yet", () => {
    expect(formatExportProgress({ rows_written: 0, stage: "Preparando" })).toBe("0 filas · Preparando");
  });
});
