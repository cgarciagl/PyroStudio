import { describe, it, expect, beforeEach, vi } from "vitest";
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

  it("should have Safe Mode disabled by default", async () => {
    vi.resetModules();
    const fresh = await import("../preferenceStore");
    expect(fresh.usePreferenceStore.getState().safeModeEnabled).toBe(false);
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

  it("should have dark theme by default", () => {
    const { theme } = usePreferenceStore.getState();
    expect(theme).toBe("dark");
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

  it("should have es language by default", () => {
    const { language } = usePreferenceStore.getState();
    expect(language).toBe("es");
  });

  it("should set language to en, update DOM/i18n, and persist to localStorage", async () => {
    const { default: i18n } = await import("../../i18n");
    const { setLanguage } = usePreferenceStore.getState();
    setLanguage("en");
    expect(usePreferenceStore.getState().language).toBe("en");
    expect(document.documentElement.getAttribute("data-lang")).toBe("en");
    expect(i18n.language).toBe("en");

    const saved = localStorage.getItem("pyro_preferences_v1");
    expect(saved).toContain('"language":"en"');

    setLanguage("es");
    expect(i18n.language).toBe("es");
  });
});
