import { create } from "zustand";
import { workspaceService } from "../services/workspaceService";
import type { Environments } from "../utils/envVariables";
import { useWorkspaceStore } from "./workspaceStore";

const LOCAL_ENVS_KEY = "pyro_env_variables_v1";
const ACTIVE_KEY_PREFIX = "pyro_active_env_v1_";

/**
 * Environment variables (`${name}` in queries). With a folder workspace they are
 * shared in `variables/variables.json`; otherwise they stay in this computer.
 * The active environment is always chosen per computer and per workspace.
 */
interface EnvVariablesState {
  environments: Environments;
  active: string | null;
  contentHash: string;
  load: () => Promise<void>;
  save: (environments: Environments) => Promise<void>;
  setActive: (name: string | null) => void;
  /** Variables of the active environment, or `null` when none is active. */
  activeVariables: () => Record<string, string> | null;
}

function scopeKey(): string {
  const ws = useWorkspaceStore.getState();
  return ws.isFolderMode() ? (ws.status?.workspaceId ?? "local") : "local";
}

function readLocal(): Environments {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_ENVS_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export const useEnvVariablesStore = create<EnvVariablesState>((set, get) => ({
  environments: {},
  active: null,
  contentHash: "",

  load: async () => {
    let environments: Environments = {};
    let contentHash = "";
    if (useWorkspaceStore.getState().isFolderMode()) {
      const snapshot = await workspaceService.getVariables();
      environments = snapshot.environments;
      contentHash = snapshot.contentHash;
    } else {
      environments = readLocal();
    }
    const saved = localStorage.getItem(ACTIVE_KEY_PREFIX + scopeKey());
    set({ environments, contentHash, active: saved && environments[saved] ? saved : null });
  },

  save: async (environments) => {
    if (useWorkspaceStore.getState().isFolderMode()) {
      const snapshot = await workspaceService.saveVariables(environments, get().contentHash);
      set({ environments: snapshot.environments, contentHash: snapshot.contentHash });
    } else {
      localStorage.setItem(LOCAL_ENVS_KEY, JSON.stringify(environments));
      set({ environments });
    }
    const { active } = get();
    if (active && !get().environments[active]) get().setActive(null);
  },

  setActive: (name) => {
    const key = ACTIVE_KEY_PREFIX + scopeKey();
    if (name) localStorage.setItem(key, name);
    else localStorage.removeItem(key);
    set({ active: name });
  },

  activeVariables: () => {
    const { active, environments } = get();
    return active ? (environments[active] ?? null) : null;
  },
}));
