import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isTauriEnvironment } from "../services/tauriDb";
import { usePreferenceStore } from "./preferenceStore";
import { errorText } from "../utils/errors";

export const RELEASES_LATEST_URL = "https://github.com/cgarciagl/PyroStudio/releases/latest";

const LAST_CHECK_KEY = "pyro_update_last_check";
const SKIPPED_VERSION_KEY = "pyro_update_skipped_version";

/** Minimum interval between automatic background checks on startup (24 hours). */
export const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type UpdaterStatus =
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "downloading"
  | "installed"
  | "error";

export interface AvailableUpdateInfo {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
}

export interface UpdateDownloadProgress {
  downloaded: number;
  total?: number;
  percent: number | null;
}

interface UpdaterState {
  status: UpdaterStatus;
  availableUpdate: AvailableUpdateInfo | null;
  isPortable: boolean;
  progress: UpdateDownloadProgress;
  error: string | null;
  isModalOpen: boolean;
  lastCheckedAt: number | null;
  checkForUpdatesManual: () => Promise<void>;
  maybeCheckUpdatesOnStartup: () => Promise<void>;
  installUpdate: () => Promise<void>;
  skipVersion: (version: string) => void;
  dismissModal: () => void;
  openUpdateModal: () => void;
}

let pendingUpdateHandle: Update | null = null;

async function detectPortableMode(): Promise<boolean> {
  if (!isTauriEnvironment()) return false;
  try {
    return await invoke<boolean>("is_portable_mode");
  } catch {
    return false;
  }
}

function readStoredTimestamp(): number | null {
  try {
    const raw = localStorage.getItem(LAST_CHECK_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function saveLastCheckTimestamp(ts: number) {
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(ts));
  } catch {
    // ignore storage errors
  }
}

function readSkippedVersion(): string | null {
  try {
    return localStorage.getItem(SKIPPED_VERSION_KEY);
  } catch {
    return null;
  }
}

function saveSkippedVersion(version: string) {
  try {
    localStorage.setItem(SKIPPED_VERSION_KEY, version);
  } catch {
    // ignore storage errors
  }
}

function clearSkippedVersion() {
  try {
    localStorage.removeItem(SKIPPED_VERSION_KEY);
  } catch {
    // ignore storage errors
  }
}

function toAvailableInfo(update: Update): AvailableUpdateInfo {
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    date: update.date,
    body: update.body,
  };
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  status: "idle",
  availableUpdate: null,
  isPortable: false,
  progress: { downloaded: 0, total: undefined, percent: null },
  error: null,
  isModalOpen: false,
  lastCheckedAt: readStoredTimestamp(),

  maybeCheckUpdatesOnStartup: async () => {
    if (!isTauriEnvironment()) return;
    if (!usePreferenceStore.getState().autoCheckUpdates) return;

    const current = get();
    if (current.status === "checking" || current.status === "downloading") return;

    const lastCheck = readStoredTimestamp();
    if (lastCheck && Date.now() - lastCheck < AUTO_CHECK_INTERVAL_MS) {
      return;
    }

    try {
      const [update, isPortable] = await Promise.all([check(), detectPortableMode()]);
      const now = Date.now();
      saveLastCheckTimestamp(now);
      set({ lastCheckedAt: now, isPortable });

      if (!update) {
        set({ status: "up-to-date", availableUpdate: null, error: null });
        return;
      }

      const skipped = readSkippedVersion();
      pendingUpdateHandle = update;
      const info = toAvailableInfo(update);

      if (skipped === update.version) {
        // Record availability silently without popping up the modal again.
        set({ status: "available", availableUpdate: info, error: null });
        return;
      }

      set({
        status: "available",
        availableUpdate: info,
        error: null,
        isModalOpen: true,
      });
    } catch {
      // Silent failure on automatic startup checks (offline, no latest.json yet, etc.).
    }
  },

  checkForUpdatesManual: async () => {
    if (!isTauriEnvironment()) {
      set({
        status: "error",
        error: "La comprobación automática solo está disponible en la aplicación de escritorio.",
      });
      return;
    }

    const current = get();
    if (current.status === "checking" || current.status === "downloading") return;

    set({ status: "checking", error: null });

    try {
      const [update, isPortable] = await Promise.all([check(), detectPortableMode()]);
      const now = Date.now();
      saveLastCheckTimestamp(now);
      set({ lastCheckedAt: now, isPortable });

      if (!update) {
        pendingUpdateHandle = null;
        set({ status: "up-to-date", availableUpdate: null, error: null });
        return;
      }

      // Manual check overrides any previously skipped version.
      clearSkippedVersion();
      pendingUpdateHandle = update;
      set({
        status: "available",
        availableUpdate: toAvailableInfo(update),
        error: null,
        isModalOpen: true,
      });
    } catch (err) {
      set({
        status: "error",
        error: errorText(err) || "No se pudo comprobar si hay actualizaciones.",
      });
    }
  },

  installUpdate: async () => {
    const update = pendingUpdateHandle;
    if (!update) return;

    set({
      status: "downloading",
      error: null,
      progress: { downloaded: 0, total: undefined, percent: 0 },
    });

    const isPortable = get().isPortable || (await detectPortableMode());
    if (isPortable) {
      let unlisten: (() => void) | null = null;
      try {
        unlisten = await listen<{ downloaded: number; total?: number }>(
          "portable-update-progress",
          (event) => {
            const { downloaded, total } = event.payload;
            const percent =
              total && total > 0
                ? Math.min(100, Math.round((downloaded / total) * 100))
                : null;
            set({
              progress: {
                downloaded,
                total,
                percent,
              },
            });
          },
        );

        await invoke("install_portable_update", { version: update.version });
        set({
          status: "installed",
          progress: {
            downloaded: get().progress.downloaded,
            total: get().progress.total,
            percent: 100,
          },
        });
      } catch (err) {
        set({
          status: "error",
          error:
            errorText(err) ||
            "No se pudo completar la actualización portable. Descarga la nueva versión manualmente desde GitHub.",
        });
      } finally {
        unlisten?.();
      }
      return;
    }

    let downloaded = 0;
    let total: number | undefined;

    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength;
          downloaded = 0;
          set({
            progress: {
              downloaded: 0,
              total,
              percent: total && total > 0 ? 0 : null,
            },
          });
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          const percent = total && total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null;
          set({
            progress: {
              downloaded,
              total,
              percent,
            },
          });
        } else if (event.event === "Finished") {
          set({
            status: "installed",
            progress: {
              downloaded,
              total,
              percent: 100,
            },
          });
        }
      });

      set({ status: "installed" });
      await relaunch();
    } catch (err) {
      set({
        status: "error",
        error:
          errorText(err) ||
          "No se pudo completar la actualización automática. Si usas la versión portable, descárgala manualmente desde GitHub.",
      });
    }
  },

  skipVersion: (version: string) => {
    saveSkippedVersion(version);
    set({ isModalOpen: false });
  },

  dismissModal: () => {
    set({ isModalOpen: false });
  },

  openUpdateModal: () => {
    if (get().availableUpdate) {
      set({ isModalOpen: true });
    }
  },
}));
