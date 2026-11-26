import { create } from "zustand";
import { getCurrentWebview } from "@tauri-apps/api/webview";
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

/** Density metrics grown to fit `fontSize` (the grid font size preference). */
export const gridMetricsFor = (density: GridDensity, fontSize: number) => {
  const base = GRID_DENSITY_METRICS[density];
  const extra = Math.max(0, Math.round((fontSize - GRID_BASE_FONT_SIZE) * 1.5));
  return { row: base.row + extra, header: base.header + extra, padY: base.padY };
};

/** Font size limits shared by the editor and the grid (Ctrl/Cmd + / - zoom). */
export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 24;
export const clampFontSize = (size: number) =>
  Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size)));
/** Font sizes offered in Settings. */
export const FONT_SIZE_OPTIONS = [12, 13, 14, 15, 16, 18];
/** Zoom step: +1, -1, or "reset" to the default size. */
export type FontZoom = 1 | -1 | "reset";

const isMacPlatform = () =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
/** Default sizes: macOS renders the same px noticeably smaller on large external displays. */
export const DEFAULT_EDITOR_FONT_SIZE = isMacPlatform() ? 14 : 13;
export const DEFAULT_GRID_FONT_SIZE = isMacPlatform() ? 14 : 13;

/** Whole-interface scale (%), applied as the webview zoom so px-sized text scales too. */
export const MIN_UI_SCALE = 80;
export const MAX_UI_SCALE = 150;
export const DEFAULT_UI_SCALE = 100;
export const UI_SCALE_OPTIONS = [90, 100, 110, 125, 150];
const UI_SCALE_STEP = 10;
export const clampUiScale = (scale: number) =>
  Math.min(MAX_UI_SCALE, Math.max(MIN_UI_SCALE, Math.round(scale)));

/** Applies the interface scale to the Tauri webview (no-op outside Tauri, e.g. tests). */
export const applyUiScale = (scale: number) => {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  try {
    void getCurrentWebview()
      .setZoom(clampUiScale(scale) / 100)
      .catch(() => {
        /* zoom not permitted/supported: keep 100% */
      });
  } catch {
    /* no webview */
  }
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
  /** Data grid font size (table and query results); independent of the editor. */
  gridFontSize: number;
  /** Interface scale in % (webview zoom): every text, icon and panel. */
  uiScale: number;
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
  setGridFontSize: (size: number) => void;
  setUiScale: (scale: number) => void;
  /** Ctrl/Cmd + / - / 0 outside the editors and grids; steps of 10%. */
  zoomUi: (step: FontZoom) => void;
  /** Ctrl/Cmd + / - / 0 in the SQL editors; the size is remembered. */
  zoomEditorFont: (step: FontZoom) => void;
  /** Ctrl/Cmd + / - / 0 in the data grids; the size is remembered. */
  zoomGridFont: (step: FontZoom) => void;
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
  gridFontSize?: number;
  uiScale?: number;
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

export const initPreferencesUiScale = () => {
  const saved = getSavedPreferences().uiScale;
  if (typeof saved === "number" && clampUiScale(saved) !== DEFAULT_UI_SCALE) applyUiScale(saved);
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
    editorFontSize:
      typeof saved.editorFontSize === "number" ? clampFontSize(saved.editorFontSize) : DEFAULT_EDITOR_FONT_SIZE,
    uiScale: typeof saved.uiScale === "number" ? clampUiScale(saved.uiScale) : DEFAULT_UI_SCALE,
    // Before this preference existed the grid followed the editor size.
    gridFontSize: clampFontSize(
      typeof saved.gridFontSize === "number"
        ? saved.gridFontSize
        : typeof saved.editorFontSize === "number"
          ? saved.editorFontSize
          : DEFAULT_GRID_FONT_SIZE,
    ),
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
      const editorFontSize = clampFontSize(size);
      savePreferences({ editorFontSize });
      set({ editorFontSize });
    },

    setGridFontSize: (size: number) => {
      const gridFontSize = clampFontSize(size);
      savePreferences({ gridFontSize });
      set({ gridFontSize });
    },

    setUiScale: (scale: number) => {
      const uiScale = clampUiScale(scale);
      savePreferences({ uiScale });
      applyUiScale(uiScale);
      set({ uiScale });
    },

    zoomUi: (step: FontZoom) => {
      get().setUiScale(step === "reset" ? DEFAULT_UI_SCALE : get().uiScale + step * UI_SCALE_STEP);
    },

    zoomEditorFont: (step: FontZoom) => {
      get().setEditorFontSize(step === "reset" ? DEFAULT_EDITOR_FONT_SIZE : get().editorFontSize + step);
    },

    zoomGridFont: (step: FontZoom) => {
      get().setGridFontSize(step === "reset" ? DEFAULT_GRID_FONT_SIZE : get().gridFontSize + step);
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
