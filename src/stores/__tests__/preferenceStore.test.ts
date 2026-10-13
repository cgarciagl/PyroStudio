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

  it("should have dark theme and Maple Mono font by default", () => {
    const { theme, fontFamily } = usePreferenceStore.getState();
    expect(theme).toBe("dark");
    expect(fontFamily).toBe("maple-mono");
  });

  it("should set theme to light, apply data-theme attribute, and persist", () => {
    const { setTheme } = usePreferenceStore.getState();
    setTheme("light");
    expect(usePreferenceStore.getState().theme).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    const saved = localStorage.getItem("pyro_preferences_v1");
    expect(saved).toContain('"theme":"light"');
  });

  it("should toggle theme between dark and light", () => {
    const { toggleTheme } = usePreferenceStore.getState();
    usePreferenceStore.setState({ theme: "dark" });
    toggleTheme();
    expect(usePreferenceStore.getState().theme).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    toggleTheme();
    expect(usePreferenceStore.getState().theme).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("should set font family to system and persist", () => {
    const { setFontFamily } = usePreferenceStore.getState();
    setFontFamily("system");
    expect(usePreferenceStore.getState().fontFamily).toBe("system");
    expect(document.documentElement.getAttribute("data-font")).toBe("system");

    const saved = localStorage.getItem("pyro_preferences_v1");
    expect(saved).toContain('"fontFamily":"system"');

    setFontFamily("maple-mono");
    expect(usePreferenceStore.getState().fontFamily).toBe("maple-mono");
    expect(document.documentElement.getAttribute("data-font")).toBe("maple-mono");
  });
});
