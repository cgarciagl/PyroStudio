import type { ExportProgressEvent } from "../types/database";
import i18n from "../i18n";

/** Remaining time as "~45 s" / "~3 min" / "~1 h 20 min"; null when it cannot be estimated. */
export function formatEta(progress: ExportProgressEvent, estimatedRows?: number): string | null {
  const rate = progress.rows_per_sec ?? 0;
  if (!estimatedRows || rate <= 0 || progress.rows_written >= estimatedRows) return null;
  const seconds = Math.ceil((estimatedRows - progress.rows_written) / rate);
  if (seconds < 60) return i18n.t("messages:export.etaSeconds", { seconds });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return i18n.t("messages:export.etaMinutes", { minutes });
  return i18n.t("messages:export.etaHoursMinutes", {
    hours: Math.floor(minutes / 60),
    minutes: minutes % 60,
  });
}

/** "12.000 filas · 3.400 filas/s · ~2 min restantes · <etapa>" for the export status line. */
export function formatExportProgress(progress: ExportProgressEvent, estimatedRows?: number): string {
  const locale = i18n.language || "es";
  const parts = [
    i18n.t("messages:export.rowsCount", { rows: progress.rows_written.toLocaleString(locale) }),
  ];
  if (progress.rows_per_sec) {
    parts.push(
      i18n.t("messages:export.rowsPerSec", {
        rate: Math.round(progress.rows_per_sec).toLocaleString(locale),
      }),
    );
  }
  const eta = formatEta(progress, estimatedRows);
  if (eta) parts.push(i18n.t("messages:export.etaRemaining", { eta }));
  parts.push(progress.stage);
  return parts.join(" · ");
}
