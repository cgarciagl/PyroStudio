import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { toWorkspaceError } from "./workspaceService";
import type { DatabaseGroups } from "../utils/objectGroups";

/**
 * Persistence of object folders per connection.
 * - Folder workspace: `groups/<connection-id>.json` (shared), hash-guarded writes.
 * - Local mode: localStorage on this computer.
 */
const LOCAL_KEY = "pyro_object_groups_v1";
export const OBJECT_GROUPS_CHANGED_EVENT = "pyro:object-groups-changed";

interface Snapshot {
  databases: DatabaseGroups;
  contentHash: string;
}

const cache = new Map<string, Snapshot>();
const pending = new Map<string, Promise<Snapshot>>();

const inWorkspace = () => useWorkspaceStore.getState().isFolderMode();

function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OBJECT_GROUPS_CHANGED_EVENT));
}

function readLocal(connectionId: string): DatabaseGroups {
  try {
    return (JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}") as Record<string, DatabaseGroups>)[connectionId] ?? {};
  } catch {
    return {};
  }
}

function writeLocal(connectionId: string, databases: DatabaseGroups) {
  const all = (() => {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}") as Record<string, DatabaseGroups>;
    } catch {
      return {};
    }
  })();
  all[connectionId] = databases;
  localStorage.setItem(LOCAL_KEY, JSON.stringify(all));
}

async function fetchSnapshot(connectionId: string): Promise<Snapshot> {
  if (!inWorkspace()) return { databases: readLocal(connectionId), contentHash: "" };
  try {
    return await invoke<Snapshot>("workspace_get_object_groups", { connectionId });
  } catch (e) {
    throw toWorkspaceError(e);
  }
}

export const objectGroupsStorage = {
  cached(connectionId: string): DatabaseGroups | undefined {
    return cache.get(connectionId)?.databases;
  },

  async load(connectionId: string, force = false): Promise<DatabaseGroups> {
    if (!force && cache.has(connectionId)) return cache.get(connectionId)!.databases;
    if (!pending.has(connectionId)) {
      pending.set(
        connectionId,
        fetchSnapshot(connectionId).finally(() => pending.delete(connectionId)),
      );
    }
    const snap = await pending.get(connectionId)!;
    cache.set(connectionId, snap);
    notify();
    return snap.databases;
  },

  /**
   * Applies `mutate` to the latest groups and saves. On a concurrent edit (another
   * computer), re-reads and re-applies the same change once instead of overwriting it.
   */
  async update(connectionId: string, mutate: (g: DatabaseGroups) => DatabaseGroups): Promise<void> {
    if (!inWorkspace()) {
      const next = mutate(readLocal(connectionId));
      writeLocal(connectionId, next);
      cache.set(connectionId, { databases: next, contentHash: "" });
      notify();
      return;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = attempt === 0 && cache.has(connectionId) ? cache.get(connectionId)! : await fetchSnapshot(connectionId);
      try {
        const saved = await invoke<Snapshot>("workspace_save_object_groups", {
          connectionId,
          databases: mutate(current.databases),
          expectedHash: current.contentHash,
        });
        cache.set(connectionId, saved);
        notify();
        return;
      } catch (e) {
        const err = toWorkspaceError(e);
        if (err.code !== "WS_CONFLICT" || attempt === 1) throw err;
      }
    }
  },

  clearCache() {
    cache.clear();
  },
};

/** React hook: groups for a connection, reloaded when the workspace changes. */
export function useObjectGroups(connectionId: string | undefined): DatabaseGroups | undefined {
  const workspaceVersion = useWorkspaceStore((s) => s.version);
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener(OBJECT_GROUPS_CHANGED_EVENT, bump);
    return () => window.removeEventListener(OBJECT_GROUPS_CHANGED_EVENT, bump);
  }, []);
  useEffect(() => {
    if (connectionId) void objectGroupsStorage.load(connectionId, true).catch(() => {});
  }, [connectionId, workspaceVersion]);
  return connectionId ? objectGroupsStorage.cached(connectionId) : undefined;
}
