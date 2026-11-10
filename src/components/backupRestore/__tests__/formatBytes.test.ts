import { describe, it, expect } from "vitest";
import { formatBytes } from "../formatBytes";

describe("formatBytes", () => {
  it("formats zero and scales by 1024", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5 GB");
  });
});
