/**
 * Shared minimal UI primitives (class strings) built on the theme tokens from
 * App.css, so they work in light and dark mode without `isLight` branches.
 *
 * Guidelines:
 * - One accent (orange) for the primary action and the active state only.
 * - Secondary actions are "ghost": no background or border until hover.
 * - Semantic color (success/warning/danger) goes on the icon or a dot, not on
 *   whole backgrounds, unless the user must stop and read (destructive confirms).
 * - Status is plain muted text; avoid colored pills for passive information.
 */

export const iconBtn =
  "p-1.5 rounded-md text-fg-muted hover:text-fg hover:bg-hover transition-colors disabled:opacity-40 disabled:pointer-events-none";

export const ghostBtn =
  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-fg-muted hover:text-fg hover:bg-hover transition-colors disabled:opacity-40 disabled:pointer-events-none";

export const primaryBtn =
  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-accent hover:bg-accent-hover text-accent-fg transition-colors disabled:opacity-50 disabled:pointer-events-none";

export const dangerGhostBtn =
  "p-1.5 rounded-md text-fg-muted hover:text-danger hover:bg-hover transition-colors";

export const menuPanel =
  "absolute right-0 mt-1 min-w-[200px] rounded-lg border border-line bg-raised shadow-lg z-50 py-1 text-xs";

export const menuItem =
  "w-full px-3 py-1.5 text-left flex items-center gap-2.5 text-fg hover:bg-hover transition-colors";

export const menuIcon = "w-3.5 h-3.5 text-fg-muted shrink-0";

export const menuSeparator = "my-1 h-px bg-line";

export const tabClass = (active: boolean) =>
  `py-2 px-2.5 border-b-2 whitespace-nowrap text-xs transition-colors ${
    active ? "border-accent text-fg font-medium" : "border-transparent text-fg-muted hover:text-fg"
  }`;

export const mutedText = "text-[11px] text-fg-muted";

/** Secondary action with a border (e.g. "Cancelar" in modal footers). */
export const secondaryBtn =
  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-line bg-surface text-fg hover:bg-hover transition-colors disabled:opacity-50 disabled:pointer-events-none";

/** Solid destructive action, reserved for confirming irreversible operations. */
export const dangerBtn =
  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-danger hover:opacity-90 text-accent-fg transition-colors disabled:opacity-50 disabled:pointer-events-none";

export const inputClass =
  "w-full px-2.5 py-1.5 rounded-md text-xs bg-canvas border border-line text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent transition-colors disabled:opacity-50";

export const selectClass = inputClass;

export const fieldLabel = "block text-[11px] font-medium text-fg-muted mb-1";

/** Plain container for grouped content (metrics, settings blocks…). */
export const cardClass = "rounded-lg border border-line bg-surface";

/** Section heading: one style for every view. */
export const sectionLabel = "text-[11px] font-medium text-fg-muted";

export const modalBackdrop =
  "fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in duration-150";

export const modalPanel =
  "w-full bg-surface border border-line rounded-xl shadow-modal flex flex-col overflow-hidden animate-in zoom-in-95 duration-150";

export const modalHeader = "flex items-center justify-between gap-3 px-5 py-3.5 border-b border-line shrink-0";

export const modalTitle = "text-sm font-semibold text-fg truncate";

export const modalFooter = "flex items-center justify-end gap-2 px-5 py-3 border-t border-line shrink-0";

export const modalSizes = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
} as const;
