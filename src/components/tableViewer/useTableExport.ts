import { useState } from "react";
import { useExportProgress } from "../../hooks/useExportProgress";
import type { ExportSummary } from "../../types/database";
import { dbService } from "../../services/tauriDb";
import { useUIStore } from "../../stores/uiStore";
import { usePreferenceStore } from "../../stores/preferenceStore";
import { exportFormatAdvice } from "../../utils/exportFormatAdvice";
import { errorText } from "../../utils/errors";
import { buildTableExportDefaultName } from "../../utils/exportFilename";
import i18n from "../../i18n";

/** Ask before a huge Excel export (CSV is the better format past a size). */
function confirmLargeExcel(message: string): Promise<boolean> {
  return new Promise((resolve) =>
    useUIStore.getState().showConfirm({
      title: i18n.t("messages:hooks.largeExcelTitle"),
      message,
      variant: "warning",
      icon: "alert",
      confirmText: i18n.t("messages:hooks.largeExcelConfirm"),
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
  const [exportProgress, setExportProgress] = useExportProgress();
  const [exportSummary, setExportSummary] = useState<ExportSummary | null>(null);

  const exportTable = async () => {
    setIsExporting(true);
    setExportProgress({ rows_written: 0, stage: i18n.t("messages:hooks.preparingExport") });
    setExportSummary(null);
    try {
      // Without extension: the dialog adds the one of the chosen type (Excel, CSV, CSV.gz).
      const chosenPath = await dbService.saveExcelDialog(buildTableExportDefaultName(table));
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
