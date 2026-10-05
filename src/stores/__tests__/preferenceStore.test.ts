import { describe, it, expect, beforeEach } from "vitest";
import { usePreferenceStore } from "../preferenceStore";

describe("preferenceStore", () => {
  beforeEach(() => {
    localStorage.clear();
    usePreferenceStore.setState({
      safeModeEnabled: true,
      requireConfirmationOnCritical: true,
    });
  });

  it("should have Safe Mode enabled by default", () => {
    const { safeModeEnabled } = usePreferenceStore.getState();
    expect(safeModeEnabled).toBe(true);
  });

  it("should toggle Safe Mode state", () => {
    const { toggleSafeMode } = usePreferenceStore.getState();
    toggleSafeMode();
    expect(usePreferenceStore.getState().safeModeEnabled).toBe(false);

    toggleSafeMode();
    expect(usePreferenceStore.getState().safeModeEnabled).toBe(true);
  });

  it("should set Safe Mode explicitly and persist to localStorage", () => {
    const { setSafeMode } = usePreferenceStore.getState();
    setSafeMode(false);
    expect(usePreferenceStore.getState().safeModeEnabled).toBe(false);

    const saved = localStorage.getItem("pyro_preferences_v1");
    expect(saved).toContain('"safeModeEnabled":false');
  });
});
