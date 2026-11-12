import { useEffect, useState } from "react";

/**
 * Latest payload of a backend event (progress of exports, imports…). The listener is
 * removed on unmount, also when it was still being registered.
 */
export function useTauriEvent<T>(eventName: string) {
  const [payload, setPayload] = useState<T | null>(null);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const stop = await listen<T>(eventName, (e) => setPayload(e.payload));
      if (disposed) stop();
      else unlisten = stop;
    })().catch((error) => {
      // Progress is cosmetic: the operation still works without it.
      console.error(`No se pudo escuchar el evento ${eventName}:`, error);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [eventName]);
  return [payload, setPayload] as const;
}
