import { create } from "zustand";

export type NoPrimaryKeyMode = "use_all_columns" | "block";
export type AppTheme = "dark" | "light" | "system";
export type AppFontFamily = "maple-mono" | "system";
export type GridDensity = "compact" | "normal" | "comfortable";

/** Row/header heights (px) for the data grid; the grid font is 12px. */
export const GRID_DENSITY_METRICS: Record<GridDensity, { row: number; header: number; padY: number }> = {
  compact: { row: 22, header: 26, padY: 3 },
  normal: { row: 26, header: 30, padY: 4 },
  comfortable: { row: 32, header: 34, padY: 7 },
};

interface PreferenceState {
  theme: AppTheme;
  fontFamily: AppFontFamily;
  safeModeEnabled: boolean;
  requireConfirmationOnCritical: boolean;
  noPrimaryKeyMode: NoPrimaryKeyMode;
  defaultPageSize: number;
  gridDensity: GridDensity;
  editorFontSize: number;
  editorLineNumbers: boolean;
  editorAutocomplete: boolean;
  confirmProductionActions: boolean;
  setTheme: (theme: AppTheme) => void;
  toggleTheme: () => void;
  setFontFamily: (font: AppFontFamily) => void;
  toggleSafeMode: () => void;
  setSafeMode: (enabled: boolean) => void;
  setRequireConfirmationOnCritical: (required: boolean) => void;
  setNoPrimaryKeyMode: (mode: NoPrimaryKeyMode) => void;
  setDefaultPageSize: (size: number) => void;
  setGridDensity: (density: GridDensity) => void;
  setEditorFontSize: (size: number) => void;
  setEditorLineNumbers: (show: boolean) => void;
  setEditorAutocomplete: (enabled: boolean) => void;
  setConfirmProductionActions: (confirm: boolean) => void;
}

const PREF_STORAGE_KEY = "pyro_preferences_v1";

interface StoredPreferences {
  theme?: AppTheme;
  fontFamily?: AppFontFamily;
  safeModeEnabled?: boolean;
  noPrimaryKeyMode?: NoPrimaryKeyMode;
  defaultPageSize?: number;
  gridDensity?: GridDensity;
  editorFontSize?: number;
  editorLineNumbers?: boolean;
  editorAutocomplete?: boolean;
  confirmProductionActions?: boolean;
}

const getSavedPreferences = (): StoredPreferences => {
  try {
    const raw = localStorage.getItem(PREF_STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // fallback
  }
  return {};
};

const getInitialTheme = (): AppTheme => {
  const saved = getSavedPreferences();
  if (saved.theme === "light" || saved.theme === "dark" || saved.theme === "system") {
    return saved.theme;
  }
  return "dark"; // Default is dark
};

const getInitialFontFamily = (): AppFontFamily => {
  const saved = getSavedPreferences();
  if (saved.fontFamily === "system" || saved.fontFamily === "maple-mono") {
    return saved.fontFamily;
  }
  return "maple-mono"; // Default is Maple Mono
};

const getInitialSafeMode = (): boolean => {
  const saved = getSavedPreferences();
  if (typeof saved.safeModeEnabled === "boolean") {
    return saved.safeModeEnabled;
  }
  return true; // Safe mode ON by default
};

const getInitialNoPrimaryKeyMode = (): NoPrimaryKeyMode => {
  const saved = getSavedPreferences();
  if (saved.noPrimaryKeyMode === "block" || saved.noPrimaryKeyMode === "use_all_columns") {
    return saved.noPrimaryKeyMode;
  }
  return "use_all_columns"; // Default: full row identification mode
};

const savePreferences = (patch: Partial<StoredPreferences>) => {
  try {
    const existing = getSavedPreferences();
    localStorage.setItem(PREF_STORAGE_KEY, JSON.stringify({ ...existing, ...patch }));
  } catch {
    // ignore
  }
};

export const applyThemeToDom = (theme: AppTheme) => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const isLight =
    theme === "light" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: light)").matches);

  if (isLight) {
    root.classList.add("theme-light");
    root.classList.remove("theme-dark");
    root.setAttribute("data-theme", "light");
  } else {
    root.classList.add("theme-dark");
    root.classList.remove("theme-light");
    root.setAttribute("data-theme", "dark");
  }
};

export const applyFontToDom = (font: AppFontFamily) => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (font === "system") {
    root.setAttribute("data-font", "system");
  } else {
    root.setAttribute("data-font", "maple-mono");
  }
};

export const initPreferencesThemeAndFont = () => {
  const theme = getInitialTheme();
  const font = getInitialFontFamily();
  applyThemeToDom(theme);
  applyFontToDom(font);

  if (typeof window !== "undefined" && window.matchMedia) {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");
    mediaQuery.addEventListener("change", () => {
      const currentTheme = usePreferenceStore.getState().theme;
      if (currentTheme === "system") {
        applyThemeToDom("system");
      }
    });
  }
};

export const useIsLightTheme = (): boolean => {
  const theme = usePreferenceStore((s) => s.theme);
  return (
    theme === "light" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: light)").matches)
  );
};

export const usePreferenceStore = create<PreferenceState>((set, get) => {
  const saved = getSavedPreferences();
  const initialTheme = getInitialTheme();
  const initialFont = getInitialFontFamily();

  return {
    theme: initialTheme,
    fontFamily: initialFont,
    safeModeEnabled: getInitialSafeMode(),
    requireConfirmationOnCritical: true,
    noPrimaryKeyMode: getInitialNoPrimaryKeyMode(),
    defaultPageSize: saved.defaultPageSize ?? 100,
    gridDensity:
      saved.gridDensity && saved.gridDensity in GRID_DENSITY_METRICS ? saved.gridDensity : "normal",
    editorFontSize: saved.editorFontSize ?? 13,
    editorLineNumbers: saved.editorLineNumbers ?? true,
    editorAutocomplete: saved.editorAutocomplete ?? true,
    confirmProductionActions: saved.confirmProductionActions ?? true,

    setTheme: (theme: AppTheme) => {
      savePreferences({ theme });
      applyThemeToDom(theme);
      set({ theme });
    },

    toggleTheme: () => {
      const current = get().theme;
      const next: AppTheme = current === "light" ? "dark" : "light";
      savePreferences({ theme: next });
      applyThemeToDom(next);
      set({ theme: next });
    },

    setFontFamily: (font: AppFontFamily) => {
      savePreferences({ fontFamily: font });
      applyFontToDom(font);
      set({ fontFamily: font });
    },

    toggleSafeMode: () => {
      const next = !get().safeModeEnabled;
      savePreferences({ safeModeEnabled: next });
      set({ safeModeEnabled: next });
    },

    setSafeMode: (enabled: boolean) => {
      savePreferences({ safeModeEnabled: enabled });
      set({ safeModeEnabled: enabled });
    },

    setRequireConfirmationOnCritical: (required: boolean) => {
      set({ requireConfirmationOnCritical: required });
    },

    setNoPrimaryKeyMode: (mode: NoPrimaryKeyMode) => {
      savePreferences({ noPrimaryKeyMode: mode });
      set({ noPrimaryKeyMode: mode });
    },

    setDefaultPageSize: (size: number) => {
      savePreferences({ defaultPageSize: size });
      set({ defaultPageSize: size });
    },

    setGridDensity: (density: GridDensity) => {
      savePreferences({ gridDensity: density });
      set({ gridDensity: density });
    },

    setEditorFontSize: (size: number) => {
      savePreferences({ editorFontSize: size });
      set({ editorFontSize: size });
    },

    setEditorLineNumbers: (show: boolean) => {
      savePreferences({ editorLineNumbers: show });
      set({ editorLineNumbers: show });
    },

    setEditorAutocomplete: (enabled: boolean) => {
      savePreferences({ editorAutocomplete: enabled });
      set({ editorAutocomplete: enabled });
    },

    setConfirmProductionActions: (confirm: boolean) => {
      savePreferences({ confirmProductionActions: confirm });
      set({ confirmProductionActions: confirm });
    },
  };
});
