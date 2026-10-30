import { describe, it, expect, beforeEach } from "vitest";
import { usePreferenceStore } from "../preferenceStore";

describe("first-time hints", () => {
  beforeEach(() => {
    localStorage.clear();
    usePreferenceStore.getState().resetHints();
  });

  it("remembers dismissed hints and persists them", () => {
    usePreferenceStore.getState().markHintSeen("grid");
    usePreferenceStore.getState().markHintSeen("grid");
    expect(usePreferenceStore.getState().seenHints).toEqual(["grid"]);
    expect(JSON.parse(localStorage.getItem("pyro_preferences_v1") || "{}").seenHints).toEqual(["grid"]);
  });

  it("shows every hint again after reset", () => {
    usePreferenceStore.getState().markHintSeen("editor");
    usePreferenceStore.getState().resetHints();
    expect(usePreferenceStore.getState().seenHints).toEqual([]);
  });
});
