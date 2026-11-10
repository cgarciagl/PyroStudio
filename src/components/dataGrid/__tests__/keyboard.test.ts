import { describe, it, expect } from "vitest";
import { resolveGridShortcut } from "../keyboard";

const key = (k: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});
const idle = { stagedChangeCount: 0, hasSelectedCell: false, gridSelection: undefined };
const pending = { ...idle, stagedChangeCount: 2 };

describe("resolveGridShortcut", () => {
  it("applies and discards only when there are staged changes", () => {
    expect(resolveGridShortcut(key("s", { ctrlKey: true }), pending)).toBe("apply");
    expect(resolveGridShortcut(key("S", { metaKey: true }), pending)).toBe("apply");
    expect(resolveGridShortcut(key("s", { ctrlKey: true }), idle)).toBeNull();
    expect(resolveGridShortcut(key("Escape"), pending)).toBe("discard");
    expect(resolveGridShortcut(key("Escape"), idle)).toBeNull();
  });
  it("copies as TSV with Ctrl/Cmd+Shift+C", () => {
    expect(resolveGridShortcut(key("C", { ctrlKey: true, shiftKey: true }), idle)).toBe("copyTsv");
    expect(resolveGridShortcut(key("c", { ctrlKey: true }), idle)).toBeNull();
  });
  it("inspects and sets NULL only with a selection", () => {
    expect(resolveGridShortcut(key(" "), idle)).toBeNull();
    expect(resolveGridShortcut(key(" "), { ...idle, hasSelectedCell: true })).toBe("inspect");
    expect(resolveGridShortcut(key("n", { altKey: true }), idle)).toBeNull();
    expect(resolveGridShortcut(key("n", { altKey: true }), { ...idle, hasSelectedCell: true })).toBe("setNull");
  });
});
