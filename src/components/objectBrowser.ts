import { useUIStore } from "../stores/uiStore";
import { OBJECT_LABELS } from "./objectIcons";

export type BrowsableKind = "tables" | "views" | "functions" | "procedures" | "queries";

/** Opens (or focuses) the object browser tab for a database and object kind. */
export function openObjectBrowser(database: string, kind: BrowsableKind) {
  useUIStore.getState().openTab({
    id: objectBrowserTabId(database, kind),
    title: `${OBJECT_LABELS[kind]} · ${database}`,
    type: "objects",
    database,
    objectKind: kind,
  });
}

/** Table/view selected in each object browser tab, keyed by tab id. */
const browserSelection = new Map<string, string>();

export const objectBrowserTabId = (database: string, kind: BrowsableKind) => `objects-${database}-${kind}`;

export function setObjectBrowserSelection(tabId: string, table: string | null) {
  if (table) browserSelection.set(tabId, table);
  else browserSelection.delete(tabId);
}

/** Table selected in an object browser tab, if any (used as the base of a new query). */
export const getObjectBrowserSelection = (tabId: string) => browserSelection.get(tabId) ?? null;
