import { create } from "zustand";
import { applyLanguageToDom, type AppLanguage } from "../i18n";

export type { AppLanguage };
export type NoPrimaryKeyMode = "use_all_columns" | "block";
export type AppTheme = "dark" | "light" | "system";
export type GridDensity = "compact" | "normal" | "comfortable";

/** Row/header heights (px) for the data grid; the grid font is 12px. */
export const GRID_DENSITY_METRICS: Record<GridDensity, { row: number; header: number; padY: number }> = {
  compact: { row: 22, header: 26, padY: 3 },
  normal: { row: 26, header: 30, padY: 4 },
  comfortable: { row: 32, header: 34, padY: 7 },
};

/** Base font size the density metrics were designed for. */
const GRID_BASE_FONT_SIZE = 12;

/** Density metrics grown to fit `fontSize` (the editor font size preference). */
export const gridMetricsFor = (density: GridDensity, fontSize: number) => {
  const base = GRID_DENSITY_METRICS[density];
  const extra = Math.max(0, Math.round((fontSize - GRID_BASE_FONT_SIZE) * 1.5));
  return { row: base.row + extra, header: base.header + extra, padY: base.padY };
};

/** Options for the query editor's SQL formatter (subset of sql-formatter's config). */
export interface SqlFormatOptions {
  keywordCase: "upper" | "lower" | "preserve";
  functionCase: "upper" | "lower" | "preserve";
  indent: "2" | "4" | "tab";
  logicalOperatorNewline: "before" | "after";
  linesBetweenQueries: number;
  denseOperators: boolean;
  /** SELECT/FROM/GROUP BY/ORDER BY lists: packed into ~60-char lines, or one item per line. */
  listStyle: "compact" | "onePerLine";
}

export const DEFAULT_SQL_FORMAT: SqlFormatOptions = {
  keywordCase: "upper",
  functionCase: "upper",
  indent: "2",
  logicalOperatorNewline: "before",
  linesBetweenQueries: 1,
  denseOperators: false,
  listStyle: "compact",
};

interface PreferenceState {
  theme: AppTheme;
  language: AppLanguage;
  safeModeEnabled: boolean;
  requireConfirmationOnCritical: boolean;
  noPrimaryKeyMode: NoPrimaryKeyMode;
  defaultPageSize: number;
  gridDensity: GridDensity;
  editorFontSize: number;
  editorLineNumbers: boolean;
  editorAutocomplete: boolean;
  confirmProductionActions: boolean;
  sqlFormat: SqlFormatOptions;
  logLevel: LogLevel;
  /** Minutes an open manual transaction runs before the bar warns about locks. */
  longTransactionMinutes: number;
  /** CSV exports start a new file every this many rows; 0 = a single file. */
  csvPartRows: number;
  /** First-time hints already dismissed (`useFirstTimeHint`). */
  seenHints: string[];
  /** First-run wizard finished or skipped (`OnboardingWizard`). */
  onboardingCompleted: boolean;
  /** Continuous virtualization: loads rows progressively as user scrolls down. */
  infiniteScroll: boolean;
  /** Periodically check for app updates on startup (once every 24h). */
  autoCheckUpdates: boolean;
  /** Query editor time limit per statement, in seconds; 0 = no limit (default). */
  queryTimeoutSec: number;
  setQueryTimeoutSec: (seconds: number) => void;
  setInfiniteScroll: (enabled: boolean) => void;
  setAutoCheckUpdates: (enabled: boolean) => void;
  setTheme: (theme: AppTheme) => void;
  setLanguage: (language: AppLanguage) => void;
  toggleTheme: () => void;
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
  setSqlFormat: (patch: Partial<SqlFormatOptions>) => void;
  setLogLevel: (level: LogLevel) => void;
  setLongTransactionMinutes: (minutes: number) => void;
  setCsvPartRows: (rows: number) => void;
  markHintSeen: (id: string) => void;
  /** Shows every first-time hint again. */
  resetHints: () => void;
  setOnboardingCompleted: (completed: boolean) => void;
}

/** Application log level (Rust `logging` module); `info` by default. */
export type LogLevel = "error" | "warn" | "info" | "debug";
export const LOG_LEVELS: LogLevel[] = ["error", "warn", "info", "debug"];
export const LONG_TRANSACTION_MINUTES = [2, 5, 15, 30];
export const CSV_PART_ROWS = [0, 500_000, 1_000_000, 5_000_000];
/** Query editor time limits offered in the run menu (seconds); 0 = no limit. */
export const QUERY_TIMEOUT_OPTIONS = [5, 10, 30, 60, 120, 300, 600, 0];

const PREF_STORAGE_KEY = "pyro_preferences_v1";

interface StoredPreferences {
  theme?: AppTheme;
  language?: AppLanguage;
  safeModeEnabled?: boolean;
  noPrimaryKeyMode?: NoPrimaryKeyMode;
  defaultPageSize?: number;
  gridDensity?: GridDensity;
  editorFontSize?: number;
  editorLineNumbers?: boolean;
  editorAutocomplete?: boolean;
  confirmProductionActions?: boolean;
  sqlFormat?: Partial<SqlFormatOptions>;
  logLevel?: LogLevel;
  longTransactionMinutes?: number;
  csvPartRows?: number;
  seenHints?: string[];
  onboardingCompleted?: boolean;
  infiniteScroll?: boolean;
  autoCheckUpdates?: boolean;
  queryTimeoutSec?: number;
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

const getInitialLanguage = (): AppLanguage => {
  const saved = getSavedPreferences();
  if (saved.language === "es" || saved.language === "en" || saved.language === "system") {
    return saved.language;
  }
  return "es"; // Default is Spanish
};

const getInitialSafeMode = (): boolean => {
  const saved = getSavedPreferences();
  if (typeof saved.safeModeEnabled === "boolean") {
    return saved.safeModeEnabled;
  }
  return false; // Safe mode OFF by default: the user opts in
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

export const initPreferencesTheme = () => {
  const theme = getInitialTheme();
  applyThemeToDom(theme);

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

export const initPreferencesLanguage = () => {
  const language = getInitialLanguage();
  applyLanguageToDom(language);
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
  const initialLanguage = getInitialLanguage();

  return {
    theme: initialTheme,
    language: initialLanguage,
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
    sqlFormat: { ...DEFAULT_SQL_FORMAT, ...saved.sqlFormat },
    logLevel: saved.logLevel && LOG_LEVELS.includes(saved.logLevel) ? saved.logLevel : "info",

    longTransactionMinutes:
      saved.longTransactionMinutes && LONG_TRANSACTION_MINUTES.includes(saved.longTransactionMinutes)
        ? saved.longTransactionMinutes
        : 5,

    csvPartRows: saved.csvPartRows && CSV_PART_ROWS.includes(saved.csvPartRows) ? saved.csvPartRows : 0,

    seenHints: Array.isArray(saved.seenHints) ? saved.seenHints : [],

    markHintSeen: (id: string) => {
      const current = get().seenHints;
      if (current.includes(id)) return;
      const seenHints = [...current, id];
      savePreferences({ seenHints });
      set({ seenHints });
    },

    onboardingCompleted: saved.onboardingCompleted ?? false,

    setOnboardingCompleted: (completed: boolean) => {
      savePreferences({ onboardingCompleted: completed });
      set({ onboardingCompleted: completed });
    },

    infiniteScroll: saved.infiniteScroll ?? false,

    setInfiniteScroll: (enabled: boolean) => {
      savePreferences({ infiniteScroll: enabled });
      set({ infiniteScroll: enabled });
    },

    autoCheckUpdates: saved.autoCheckUpdates ?? true,

    setAutoCheckUpdates: (enabled: boolean) => {
      savePreferences({ autoCheckUpdates: enabled });
      set({ autoCheckUpdates: enabled });
    },

    queryTimeoutSec:
      typeof saved.queryTimeoutSec === "number" && QUERY_TIMEOUT_OPTIONS.includes(saved.queryTimeoutSec)
        ? saved.queryTimeoutSec
        : 0,

    setQueryTimeoutSec: (seconds: number) => {
      const next = QUERY_TIMEOUT_OPTIONS.includes(seconds) ? seconds : 0;
      savePreferences({ queryTimeoutSec: next });
      set({ queryTimeoutSec: next });
    },

    resetHints: () => {
      savePreferences({ seenHints: [] });
      set({ seenHints: [] });
    },

    setLongTransactionMinutes: (minutes: number) => {
      savePreferences({ longTransactionMinutes: minutes });
      set({ longTransactionMinutes: minutes });
    },

    setCsvPartRows: (rows: number) => {
      savePreferences({ csvPartRows: rows });
      set({ csvPartRows: rows });
    },

    setLogLevel: (level: LogLevel) => {
      savePreferences({ logLevel: level });
      set({ logLevel: level });
    },

    setTheme: (theme: AppTheme) => {
      savePreferences({ theme });
      applyThemeToDom(theme);
      set({ theme });
    },

    setLanguage: (language: AppLanguage) => {
      savePreferences({ language });
      applyLanguageToDom(language);
      set({ language });
    },

    toggleTheme: () => {
      const current = get().theme;
      const next: AppTheme = current === "light" ? "dark" : "light";
      savePreferences({ theme: next });
      applyThemeToDom(next);
      set({ theme: next });
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

    setSqlFormat: (patch: Partial<SqlFormatOptions>) => {
      const next = { ...get().sqlFormat, ...patch };
      savePreferences({ sqlFormat: next });
      set({ sqlFormat: next });
    },
  };
});
