import { create } from "zustand";

interface PreferenceState {
  safeModeEnabled: boolean;
  requireConfirmationOnCritical: boolean;
  toggleSafeMode: () => void;
  setSafeMode: (enabled: boolean) => void;
  setRequireConfirmationOnCritical: (required: boolean) => void;
}

const PREF_STORAGE_KEY = "pyro_preferences_v1";

const getInitialSafeMode = (): boolean => {
  try {
    const raw = localStorage.getItem(PREF_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.safeModeEnabled === "boolean") {
        return parsed.safeModeEnabled;
      }
    }
  } catch {
    // fallback
  }
  return true; // Safe mode ON by default
};

export const usePreferenceStore = create<PreferenceState>((set, get) => ({
  safeModeEnabled: getInitialSafeMode(),
  requireConfirmationOnCritical: true,

  toggleSafeMode: () => {
    const next = !get().safeModeEnabled;
    try {
      localStorage.setItem(
        PREF_STORAGE_KEY,
        JSON.stringify({ safeModeEnabled: next }),
      );
    } catch {
      // ignore
    }
    set({ safeModeEnabled: next });
  },

  setSafeMode: (enabled: boolean) => {
    try {
      localStorage.setItem(
        PREF_STORAGE_KEY,
        JSON.stringify({ safeModeEnabled: enabled }),
      );
    } catch {
      // ignore
    }
    set({ safeModeEnabled: enabled });
  },

  setRequireConfirmationOnCritical: (required: boolean) => {
    set({ requireConfirmationOnCritical: required });
  },
}));
