import { useEffect, useState } from "react";
import type { ExportProgressEvent, ExportSummary } from "../../types/database";
import { dbService } from "../../services/tauriDb";
import { useUIStore } from "../../stores/uiStore";
import { usePreferenceStore } from "../../stores/preferenceStore";
import { exportFormatAdvice } from "../../utils/exportFormatAdvice";
import { errorText } from "../../utils/errors";

/** Ask before a huge Excel export (CSV is the better format past a size). */
function confirmLargeExcel(message: string): Promise<boolean> {
  return new Promise((resolve) =>
    useUIStore.getState().showConfirm({
      title: "Exportación grande a Excel",
      message,
      variant: "warning",
      icon: "alert",
      confirmText: "Exportar a Excel igualmente",
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    }),
  );
}

/**
 * Excel/CSV export of a whole table, streamed to disk by the backend, with progress.
 * Single responsibility: file choice, confirmation, progress and result.
 */
export function useTableExport(
  database: string,
  table: string,
  rowsCount: number | null | undefined,
  onError: (message: string) => void,
) {
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgressEvent | null>(null);
  const [exportSummary, setExportSummary] = useState<ExportSummary | null>(null);

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

  const exportTable = async () => {
    setIsExporting(true);
    setExportProgress({ rows_written: 0, stage: "Preparando exportación" });
    setExportSummary(null);
    try {
      // Without extension: the dialog adds the one of the chosen type (Excel, CSV, CSV.gz).
      const chosenPath = await dbService.saveExcelDialog(table);
      if (!chosenPath) return;
      const advice = exportFormatAdvice(rowsCount, chosenPath);
      if (advice && !(await confirmLargeExcel(advice))) return;
      const summary = await dbService.exportExcelFile({
        database,
        table,
        file_path: chosenPath,
        csv_part_rows: usePreferenceStore.getState().csvPartRows || undefined,
      });
      setExportSummary(summary);
      setTimeout(() => setExportSummary(null), 8000);
    } catch (err) {
      console.error("Export error:", err);
      onError(errorText(err, "Error al exportar la tabla"));
    } finally {
      setExportProgress(null);
      setIsExporting(false);
    }
  };

  return { isExporting, exportProgress, exportSummary, exportTable };
}
