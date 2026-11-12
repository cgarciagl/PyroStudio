import { useUIStore } from "../stores/uiStore";

/** Readable text of anything thrown by Tauri commands, fetch or JS code. */
export function errorText(err: unknown, fallback = "Error desconocido."): string {
  if (typeof err === "string") return err || fallback;
  if (err instanceof Error) return err.message || fallback;
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string" && msg) return msg;
  }
  return err == null ? fallback : String(err);
}

/**
 * Log a failure and tell the user. Use it where an error used to go only to the
 * console and the user saw nothing (an empty list, a password that was not saved…).
 */
export function reportError(title: string, err: unknown, message?: string): void {
  console.error(`${title}:`, err);
  useUIStore.getState().showAlert({
    title,
    message: message ?? errorText(err),
    details: message ? errorText(err) : undefined,
    variant: "danger",
    icon: "alert",
  });
}
