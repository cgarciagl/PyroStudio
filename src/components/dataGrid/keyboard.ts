import type { GridSelection } from "@glideapps/glide-data-grid";

export type GridShortcut = "apply" | "discard" | "copyTsv" | "inspect" | "setNull";

/** True when the key event comes from a text input, the cell editor overlay or a dialog. */
export function isEditableTarget(target: HTMLElement | null): boolean {
  return Boolean(
    target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable ||
        Boolean(target.closest("input")) ||
        Boolean(target.closest("textarea")) ||
        Boolean(target.closest(".gdg-overlay-editor")) ||
        Boolean(target.closest("[role='dialog']"))),
  );
}

/**
 * Maps a keydown on the grid container to a shortcut:
 * Ctrl/Cmd+S apply staged changes, Escape discard them, Ctrl/Cmd+Shift+C copy
 * as TSV, Space inspect the cell and Alt+N set the selection to NULL.
 */
export function resolveGridShortcut(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">,
  state: { stagedChangeCount: number; hasSelectedCell: boolean; gridSelection: GridSelection | undefined },
): GridShortcut | null {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (mod && key === "s") return state.stagedChangeCount > 0 ? "apply" : null;
  if (e.key === "Escape") return state.stagedChangeCount > 0 ? "discard" : null;
  if (mod && e.shiftKey && key === "c") return "copyTsv";
  if (e.key === " " && state.hasSelectedCell) return "inspect";
  if (
    e.altKey &&
    key === "n" &&
    (state.hasSelectedCell ||
      (state.gridSelection?.current?.range && state.gridSelection.current.range.width > 0))
  ) {
    return "setNull";
  }
  return null;
}
