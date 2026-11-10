import { describe, it, expect } from "vitest";
import { nextSortDirection } from "../useHeaderActions";

describe("nextSortDirection", () => {
  it("cycles ASC → DESC → unsorted on the same column", () => {
    expect(nextSortDirection(null, null, "id")).toBe("ASC");
    expect(nextSortDirection("id", "ASC", "id")).toBe("DESC");
    expect(nextSortDirection("id", "DESC", "id")).toBeNull();
  });
  it("starts ascending on a different column", () => {
    expect(nextSortDirection("id", "DESC", "name")).toBe("ASC");
  });
});
