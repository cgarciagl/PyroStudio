import type { FontZoom } from "../stores/preferenceStore";

type ZoomKeyEvent = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey">;

/**
 * Font zoom step for Ctrl/Cmd + "+", "-" or "0" (like Navicat or a browser),
 * or null when the event is not a zoom shortcut. Works with the main keyboard
 * on any layout (US "=" / Spanish "+") and with the numeric keypad.
 */
export function fontZoomStep(e: ZoomKeyEvent): FontZoom | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  if (e.key === "+" || e.key === "=" || e.code === "NumpadAdd") return 1;
  if (e.key === "-" || e.key === "_" || e.code === "NumpadSubtract") return -1;
  if (e.key === "0" || e.code === "Numpad0") return "reset";
  return null;
}
