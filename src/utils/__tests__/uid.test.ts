import { describe, it, expect } from "vitest";
import { uid } from "../uid";

describe("uid", () => {
  it("is unique within the same millisecond", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uid()));
    expect(ids.size).toBe(1000);
  });
});
