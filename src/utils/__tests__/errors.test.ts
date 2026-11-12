import { describe, it, expect } from "vitest";
import { errorText } from "../errors";

describe("errorText", () => {
  it("reads strings, Errors and objects with a message", () => {
    expect(errorText("boom")).toBe("boom");
    expect(errorText(new Error("bad"))).toBe("bad");
    expect(errorText({ message: "obj" })).toBe("obj");
  });
  it("uses the fallback for empty values", () => {
    expect(errorText("", "fb")).toBe("fb");
    expect(errorText(undefined, "fb")).toBe("fb");
    expect(errorText(new Error(""), "fb")).toBe("fb");
  });
});
