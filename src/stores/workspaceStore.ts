import { create } from "zustand";
import type { SavedConnection } from "../types/database";
import type { MigrationReport, WorkspaceQuery, WorkspaceStatus } from "../types/workspace";
import { toWorkspaceError, workspaceService } from "../services/workspaceService";

/**
 * Reactive mirror of the active workspace. The folder on disk is the source of
 * truth: lists are re-read after every write, on activation and on window focus.
 */
export type WorkspaceLoadState = "idle" | "loading" | "ready" | "error";

interface WorkspaceStoreState {
  status: WorkspaceStatus | null;
  loadState: WorkspaceLoadState;
  error: string | null;
  connections: SavedConnection[];
  queries: WorkspaceQuery[];
  /** Files that could not be read (corrupt, incompatible, sync conflict copies). */
  fileErrors: string[];
  /** Bumped after each reload so non-reactive readers can refresh. */
  version: number;

  isFolderMode: () => boolean;
  isReady: () => boolean;
  init: () => Promise<void>;
  reload: () => Promise<void>;
  createWorkspace: (name: string) => Promise<boolean>;
  openWorkspace: () => Promise<boolean>;
  relocateWorkspace: () => Promise<boolean>;
  useLocalStorage: () => Promise<void>;
  importLegacy: (
    connections: SavedConnection[],
    favorites: import("../types/database").SqlFavorite[]
  ) => Promise<MigrationReport>;
}

export const useWorkspaceStore = create<WorkspaceStoreState>((set, get) => {
  const applyStatus = async (status: WorkspaceStatus | null) => {
    if (!status) return false; // dialog cancelled
    set({ status });
    await get().reload();
    return true;
  };

  return {
    status: null,
    loadState: "idle",
    error: null,
    connections: [],
    queries: [],
    fileErrors: [],
    version: 0,

    isFolderMode: () => {
      const s = get().status;
      return !!s && s.availability !== "local";
    },
    isReady: () => get().status?.availability === "available" && get().loadState === "ready",

    init: async () => {
      try {
        const status = await workspaceService.getStatus();
        set({ status });
        await get().reload();
      } catch (e) {
        set({ loadState: "error", error: toWorkspaceError(e).message });
      }
    },

    reload: async () => {
      let status = get().status;
      try {
        status = await workspaceService.getStatus();
      } catch {
        /* keep previous status */
      }
      if (!status || status.availability === "local") {
        set((s) => ({ status, connections: [], queries: [], fileErrors: [], loadState: "ready", error: null, version: s.version + 1 }));
        return;
      }
      if (status.availability !== "available") {
        // Never present an unreachable workspace as an empty one.
        set((s) => ({ status, connections: [], queries: [], loadState: "error", error: status!.error, version: s.version + 1 }));
        return;
      }
      set({ status, loadState: get().loadState === "ready" ? "ready" : "loading" });
      try {
        const [c, q] = await Promise.all([
          workspaceService.listConnections(),
          workspaceService.listQueries(),
        ]);
        set((s) => ({
          connections: c.connections,
          queries: q.queries,
          fileErrors: [...c.errors, ...q.errors],
          loadState: "ready",
          error: null,
          version: s.version + 1,
        }));
      } catch (e) {
        set((s) => ({ loadState: "error", error: toWorkspaceError(e).message, version: s.version + 1 }));
      }
    },

    createWorkspace: async (name) => applyStatus(await workspaceService.createDialog(name)),
    openWorkspace: async () => applyStatus(await workspaceService.openDialog()),
    relocateWorkspace: async () => applyStatus(await workspaceService.relocateDialog()),
    useLocalStorage: async () => {
      await applyStatus(await workspaceService.useLocal());
    },

    importLegacy: async (connections, favorites) => {
      const report = await workspaceService.importLegacy(connections, favorites);
      await get().reload();
      return report;
    },
  };
});
