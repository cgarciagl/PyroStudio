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
