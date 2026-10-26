import type { SavedConnection } from "../types/database";

export interface ConnectionFolderGroup {
  /** Folder name, or null for connections without a folder. */
  folder: string | null;
  connections: SavedConnection[];
}

export function normalizeFolder(folder: string | undefined | null): string | null {
  const f = (folder ?? "").trim().replace(/\s+/g, " ");
  return f ? f : null;
}

/** Groups connections by folder: named folders alphabetically, ungrouped last; items by name. */
export function groupByFolder(connections: SavedConnection[]): ConnectionFolderGroup[] {
  const map = new Map<string | null, SavedConnection[]>();
  for (const c of connections) {
    const key = normalizeFolder(c.folder);
    const list = map.get(key) ?? [];
    list.push(c);
    map.set(key, list);
  }
  const byName = (a: SavedConnection, b: SavedConnection) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  return [...map.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b, undefined, { sensitivity: "base" })))
    .map(([folder, list]) => ({ folder, connections: [...list].sort(byName) }));
}

export function folderNames(connections: SavedConnection[]): string[] {
  return groupByFolder(connections)
    .map((g) => g.folder)
    .filter((f): f is string => f !== null);
}
