import { describe, it, expect, vi, beforeEach } from "vitest";
import { AUTO_CHECK_INTERVAL_MS, useUpdaterStore } from "../updaterStore";
import { usePreferenceStore } from "../preferenceStore";

const checkMock = vi.fn();
const relaunchMock = vi.fn();

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: () => checkMock(),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: () => relaunchMock(),
}));

vi.mock("../../services/tauriDb", () => ({
  isTauriEnvironment: () => true,
}));

describe("updaterStore", () => {
  beforeEach(() => {
    localStorage.clear();
    checkMock.mockReset();
    relaunchMock.mockReset();
    usePreferenceStore.setState({ autoCheckUpdates: true });
    useUpdaterStore.setState({
      status: "idle",
      availableUpdate: null,
      progress: { downloaded: 0, total: undefined, percent: null },
      error: null,
      isModalOpen: false,
      lastCheckedAt: null,
    });
  });

  it("checks on startup when no recent check exists and opens modal on new release", async () => {
    checkMock.mockResolvedValue({
      version: "1.1.0",
      currentVersion: "1.0.0",
      date: "2026-11-17",
      body: "Bug fixes",
      downloadAndInstall: vi.fn(),
    });

    await useUpdaterStore.getState().maybeCheckUpdatesOnStartup();

    expect(checkMock).toHaveBeenCalledTimes(1);
    const state = useUpdaterStore.getState();
    expect(state.status).toBe("available");
    expect(state.availableUpdate?.version).toBe("1.1.0");
    expect(state.isModalOpen).toBe(true);
  });

  it("skips startup check when checked within the 24h cooldown", async () => {
    localStorage.setItem("pyro_update_last_check", String(Date.now() - AUTO_CHECK_INTERVAL_MS / 2));

    await useUpdaterStore.getState().maybeCheckUpdatesOnStartup();

    expect(checkMock).not.toHaveBeenCalled();
  });

  it("skips startup check when autoCheckUpdates preference is disabled", async () => {
    usePreferenceStore.setState({ autoCheckUpdates: false });

    await useUpdaterStore.getState().maybeCheckUpdatesOnStartup();

    expect(checkMock).not.toHaveBeenCalled();
  });

  it("does not open modal on startup for a skipped version, unless checked manually", async () => {
    checkMock.mockResolvedValue({
      version: "1.1.0",
      currentVersion: "1.0.0",
      downloadAndInstall: vi.fn(),
    });
    useUpdaterStore.getState().skipVersion("1.1.0");

    await useUpdaterStore.getState().maybeCheckUpdatesOnStartup();
    expect(useUpdaterStore.getState().isModalOpen).toBe(false);

    await useUpdaterStore.getState().checkForUpdatesManual();
    expect(useUpdaterStore.getState().isModalOpen).toBe(true);
  });
});
