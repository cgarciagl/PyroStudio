/** Pure operations on object folders: database -> kind -> folder -> object names. */

export type GroupKind = "tables" | "views" | "functions" | "procedures";
export type Folders = Record<string, string[]>;
export type DatabaseGroups = Record<string, Partial<Record<GroupKind, Folders>>>;

const clone = (g: DatabaseGroups): DatabaseGroups => JSON.parse(JSON.stringify(g ?? {}));

function foldersOf(g: DatabaseGroups, db: string, kind: GroupKind): Folders {
  g[db] ??= {};
  g[db][kind] ??= {};
  return g[db][kind]!;
}

export function getFolders(g: DatabaseGroups | undefined, db: string, kind: GroupKind): Folders {
  return g?.[db]?.[kind] ?? {};
}

/** Folder containing an object, or null. */
export function folderOf(g: DatabaseGroups | undefined, db: string, kind: GroupKind, name: string): string | null {
  const folders = getFolders(g, db, kind);
  return Object.keys(folders).find((f) => folders[f].includes(name)) ?? null;
}

/** Moves an object into `folder` (null = root). An object lives in one folder at most. */
export function moveObject(g: DatabaseGroups, db: string, kind: GroupKind, name: string, folder: string | null): DatabaseGroups {
  const next = clone(g);
  const folders = foldersOf(next, db, kind);
  for (const f of Object.keys(folders)) folders[f] = folders[f].filter((n) => n !== name);
  if (folder) (folders[folder] ??= []).push(name);
  return next;
}

export function createFolder(g: DatabaseGroups, db: string, kind: GroupKind, folder: string): DatabaseGroups {
  const next = clone(g);
  const folders = foldersOf(next, db, kind);
  folders[folder.trim()] ??= [];
  return next;
}

/** Renames a folder; merges into an existing folder with the target name. */
export function renameFolder(g: DatabaseGroups, db: string, kind: GroupKind, from: string, to: string): DatabaseGroups {
  const next = clone(g);
  const folders = foldersOf(next, db, kind);
  const target = to.trim();
  if (!target || !(from in folders) || from === target) return next;
  folders[target] = [...new Set([...(folders[target] ?? []), ...folders[from]])];
  delete folders[from];
  return next;
}

/** Removes a folder; its objects go back to the root (nothing is dropped). */
export function deleteFolder(g: DatabaseGroups, db: string, kind: GroupKind, folder: string): DatabaseGroups {
  const next = clone(g);
  delete foldersOf(next, db, kind)[folder];
  return next;
}

/** Drops references to objects that no longer exist (keeps empty folders). */
export function pruneMissing(g: DatabaseGroups, db: string, kind: GroupKind, existing: Set<string>): DatabaseGroups {
  const next = clone(g);
  const folders = foldersOf(next, db, kind);
  for (const f of Object.keys(folders)) folders[f] = folders[f].filter((n) => existing.has(n));
  return next;
}
