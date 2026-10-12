import { create } from "zustand";

export type NoPrimaryKeyMode = "use_all_columns" | "block";

interface PreferenceState {
  safeModeEnabled: boolean;
  requireConfirmationOnCritical: boolean;
  noPrimaryKeyMode: NoPrimaryKeyMode;
  defaultPageSize: number;
  editorFontSize: number;
  editorLineNumbers: boolean;
  editorAutocomplete: boolean;
  confirmProductionActions: boolean;
  toggleSafeMode: () => void;
  setSafeMode: (enabled: boolean) => void;
  setRequireConfirmationOnCritical: (required: boolean) => void;
  setNoPrimaryKeyMode: (mode: NoPrimaryKeyMode) => void;
  setDefaultPageSize: (size: number) => void;
  setEditorFontSize: (size: number) => void;
  setEditorLineNumbers: (show: boolean) => void;
  setEditorAutocomplete: (enabled: boolean) => void;
  setConfirmProductionActions: (confirm: boolean) => void;
}

const PREF_STORAGE_KEY = "pyro_preferences_v1";

interface StoredPreferences {
  safeModeEnabled?: boolean;
  noPrimaryKeyMode?: NoPrimaryKeyMode;
  defaultPageSize?: number;
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

export const usePreferenceStore = create<PreferenceState>((set, get) => {
  const saved = getSavedPreferences();

  return {
    safeModeEnabled: getInitialSafeMode(),
    requireConfirmationOnCritical: true,
    noPrimaryKeyMode: getInitialNoPrimaryKeyMode(),
    defaultPageSize: saved.defaultPageSize ?? 100,
    editorFontSize: saved.editorFontSize ?? 13,
    editorLineNumbers: saved.editorLineNumbers ?? true,
    editorAutocomplete: saved.editorAutocomplete ?? true,
    confirmProductionActions: saved.confirmProductionActions ?? true,

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
