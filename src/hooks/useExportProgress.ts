import { useEffect, useState } from "react";
import type { ExportProgressEvent } from "../types/database";

/**
 * Progress events of the streamed Excel/CSV export, shared by the table viewer and the
 * query editor (it was duplicated in both).
 */
export function useExportProgress() {
  const [exportProgress, setExportProgress] = useState<ExportProgressEvent | null>(null);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const stop = await listen<ExportProgressEvent>("excel-export-progress", (e) =>
        setExportProgress(e.payload),
      );
      if (disposed) stop();
      else unlisten = stop;
    })().catch((error) => {
      // Progress is cosmetic: the export still works without it.
      console.error("No se pudo escuchar el progreso de exportación Excel:", error);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  return [exportProgress, setExportProgress] as const;
}
