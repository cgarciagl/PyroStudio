import { describe, it, expect, beforeEach } from "vitest";
import { usePreferenceStore } from "../preferenceStore";

describe("preferenceStore", () => {
  beforeEach(() => {
    localStorage.clear();
    usePreferenceStore.setState({
      safeModeEnabled: true,
      requireConfirmationOnCritical: true,
      noPrimaryKeyMode: "use_all_columns",
    });
  });

  it("should have Safe Mode enabled by default", () => {
    const { safeModeEnabled } = usePreferenceStore.getState();
    expect(safeModeEnabled).toBe(true);
  });

  it("should have noPrimaryKeyMode as use_all_columns by default", () => {
    const { noPrimaryKeyMode } = usePreferenceStore.getState();
    expect(noPrimaryKeyMode).toBe("use_all_columns");
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

  it("should set noPrimaryKeyMode and persist to localStorage", () => {
    const { setNoPrimaryKeyMode } = usePreferenceStore.getState();
    setNoPrimaryKeyMode("block");
    expect(usePreferenceStore.getState().noPrimaryKeyMode).toBe("block");

    const saved = localStorage.getItem("pyro_preferences_v1");
    expect(saved).toContain('"noPrimaryKeyMode":"block"');

    setNoPrimaryKeyMode("use_all_columns");
    expect(usePreferenceStore.getState().noPrimaryKeyMode).toBe("use_all_columns");
    const savedAfter = localStorage.getItem("pyro_preferences_v1");
    expect(savedAfter).toContain('"noPrimaryKeyMode":"use_all_columns"');
  });
});
