import { useUIStore } from "../stores/uiStore";
import { OBJECT_LABELS } from "./objectIcons";

export type BrowsableKind = "tables" | "views" | "functions" | "procedures" | "queries";

/** Opens (or focuses) the object browser tab for a database and object kind. */
export function openObjectBrowser(database: string, kind: BrowsableKind) {
  useUIStore.getState().openTab({
    id: `objects-${database}-${kind}`,
    title: `${OBJECT_LABELS[kind]} · ${database}`,
    type: "objects",
    database,
    objectKind: kind,
  });
}
