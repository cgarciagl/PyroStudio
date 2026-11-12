import { describe, expect, it } from "vitest";
import { formatScriptProgress } from "../ExecutionStatus";

const progress = (completed: number, total: number) => ({ queryId: "q", completed, total, elapsedMs: 0 });

describe("formatScriptProgress", () => {
  it("names the running statement of a script", () => {
    expect(formatScriptProgress(progress(0, 37))).toBe("Sentencia 1 de 37");
    expect(formatScriptProgress(progress(6, 37))).toBe("Sentencia 7 de 37");
  });

  it("never goes past the last statement", () => {
    expect(formatScriptProgress(progress(37, 37))).toBe("Sentencia 37 de 37");
  });

  it("stays quiet for a single statement or no progress", () => {
    expect(formatScriptProgress(progress(0, 1))).toBeNull();
    expect(formatScriptProgress(null)).toBeNull();
  });
});
