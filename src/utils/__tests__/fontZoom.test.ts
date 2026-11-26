import { describe, expect, it } from "vitest";
import { fontZoomStep } from "../fontZoom";

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; code: string }> = {}) => ({
  key: k,
  code: mods.code ?? "",
  ctrlKey: mods.ctrlKey ?? false,
  metaKey: mods.metaKey ?? false,
  altKey: mods.altKey ?? false,
});

describe("fontZoomStep", () => {
  it("maps Ctrl/Cmd + plus, minus and zero", () => {
    expect(fontZoomStep(key("+", { ctrlKey: true }))).toBe(1);
    expect(fontZoomStep(key("=", { metaKey: true }))).toBe(1);
    expect(fontZoomStep(key("-", { ctrlKey: true }))).toBe(-1);
    expect(fontZoomStep(key("0", { metaKey: true }))).toBe("reset");
  });

  it("accepts the numeric keypad", () => {
    expect(fontZoomStep(key("+", { ctrlKey: true, code: "NumpadAdd" }))).toBe(1);
    expect(fontZoomStep(key("-", { ctrlKey: true, code: "NumpadSubtract" }))).toBe(-1);
  });

  it("ignores keys without the modifier or with Alt", () => {
    expect(fontZoomStep(key("+"))).toBeNull();
    expect(fontZoomStep(key("+", { ctrlKey: true, altKey: true }))).toBeNull();
    expect(fontZoomStep(key("a", { ctrlKey: true }))).toBeNull();
  });
});
