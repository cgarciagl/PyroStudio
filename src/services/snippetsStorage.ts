import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { toWorkspaceError } from "./workspaceService";

/**
 * SQL snippets: a `prefix` typed in the editor expands to `body`.
 * In the body, `${campo}` is a tab stop and `:variable` a value asked at execution.
 * - Folder workspace: `snippets/snippets.json` (shared), hash-guarded writes.
 * - Local mode: localStorage on this computer.
 */
export interface SqlSnippet {
  id: string;
  prefix: string;
  name: string;
  description?: string;
  body: string;
}

interface Snapshot {
  snippets: SqlSnippet[];
  contentHash: string;
}

const LOCAL_KEY = "pyro_sql_snippets_v1";
export const SNIPPETS_CHANGED_EVENT = "pyro:snippets-changed";
/** Asks the active query editor to insert a snippet (detail: SqlSnippet). */
export const INSERT_SNIPPET_EVENT = "pyro:insert-snippet";

/** Starting set for a workspace or computer that has none yet. */
export const DEFAULT_SNIPPETS: SqlSnippet[] = [
  {
    id: "snp-default-select",
    prefix: "sel",
    name: "SELECT con filtro",
    body: "SELECT ${columnas}\nFROM ${tabla}\nWHERE ${condicion}\nLIMIT 100;",
  },
  {
    id: "snp-default-count",
    prefix: "cnt",
    name: "Contar por grupo",
    body: "SELECT ${columna}, COUNT(*) AS total\nFROM ${tabla}\nGROUP BY ${columna}\nORDER BY total DESC;",
  },
  {
    id: "snp-default-join",
    prefix: "join",
    name: "JOIN entre dos tablas",
    body: "SELECT a.*, b.*\nFROM ${tabla_a} a\nJOIN ${tabla_b} b ON b.${columna_fk} = a.${columna_pk}\nLIMIT 100;",
  },
  {
    id: "snp-default-by-id",
    prefix: "byid",
    name: "Fila por id (variable)",
    description: "Pide el valor de :id al ejecutar.",
    body: "SELECT *\nFROM ${tabla}\nWHERE id = :id;",
  },
  {
    id: "snp-default-dups",
    prefix: "dups",
    name: "Valores duplicados",
    body: "SELECT ${columna}, COUNT(*) AS veces\nFROM ${tabla}\nGROUP BY ${columna}\nHAVING COUNT(*) > 1\nORDER BY veces DESC;",
  },
];

let cache: Snapshot | null = null;
let pending: Promise<Snapshot> | null = null;

const inWorkspace = () => useWorkspaceStore.getState().isFolderMode();

function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SNIPPETS_CHANGED_EVENT));
}

function readLocal(): SqlSnippet[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as SqlSnippet[]) : DEFAULT_SNIPPETS;
  } catch {
    return DEFAULT_SNIPPETS;
  }
}

async function fetchSnapshot(): Promise<Snapshot> {
  if (!inWorkspace()) return { snippets: readLocal(), contentHash: "" };
  try {
    const snap = await invoke<Snapshot>("workspace_get_snippets");
    // A workspace without the file yet starts from the defaults.
    return snap.contentHash ? snap : { snippets: DEFAULT_SNIPPETS, contentHash: "" };
  } catch (e) {
    throw toWorkspaceError(e);
  }
}

export function newSnippetId(): string {
  return `snp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
}

export const snippetsStorage = {
  cached(): SqlSnippet[] | undefined {
    return cache?.snippets;
  },

  async load(force = false): Promise<SqlSnippet[]> {
    if (!force && cache) return cache.snippets;
    pending ??= fetchSnapshot().finally(() => {
      pending = null;
    });
    cache = await pending;
    notify();
    return cache.snippets;
  },

  /**
   * Applies `mutate` to the latest snippets and saves. On a concurrent edit (another
   * computer), re-reads and re-applies the same change once instead of overwriting it.
   */
  async update(mutate: (s: SqlSnippet[]) => SqlSnippet[]): Promise<void> {
    if (!inWorkspace()) {
      const next = mutate(readLocal());
      localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
      cache = { snippets: next, contentHash: "" };
      notify();
      return;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = attempt === 0 && cache ? cache : await fetchSnapshot();
      try {
        cache = await invoke<Snapshot>("workspace_save_snippets", {
          snippets: mutate(current.snippets),
          expectedHash: current.contentHash,
        });
        notify();
        return;
      } catch (e) {
        const err = toWorkspaceError(e);
        if (err.code !== "WS_CONFLICT" || attempt === 1) throw err;
      }
    }
  },
};

/** React hook: current snippets, reloaded when the workspace changes. */
export function useSnippets(): SqlSnippet[] {
  const workspaceVersion = useWorkspaceStore((s) => s.version);
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener(SNIPPETS_CHANGED_EVENT, bump);
    return () => window.removeEventListener(SNIPPETS_CHANGED_EVENT, bump);
  }, []);
  useEffect(() => {
    void snippetsStorage.load(true).catch(() => {});
  }, [workspaceVersion]);
  return snippetsStorage.cached() ?? [];
}

/** Turns `:variables` and `${campos}` into a short hint for lists. */
export function describeSnippetBody(body: string): string {
  const fields = [...new Set([...body.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1]))];
  const vars = [...new Set([...body.matchAll(/(?<![:\w]):([A-Za-z_]\w*)/g)].map((m) => `:${m[1]}`))];
  return [...fields, ...vars].join(", ");
}
