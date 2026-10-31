import type { ExportProgressEvent } from "../types/database";

/** Remaining time as "~45 s" / "~3 min" / "~1 h 20 min"; null when it cannot be estimated. */
export function formatEta(progress: ExportProgressEvent, estimatedRows?: number): string | null {
  const rate = progress.rows_per_sec ?? 0;
  if (!estimatedRows || rate <= 0 || progress.rows_written >= estimatedRows) return null;
  const seconds = Math.ceil((estimatedRows - progress.rows_written) / rate);
  if (seconds < 60) return `~${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `~${minutes} min`;
  return `~${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** "12.000 filas · 3.400 filas/s · ~2 min restantes · <etapa>" for the export status line. */
export function formatExportProgress(progress: ExportProgressEvent, estimatedRows?: number): string {
  const parts = [`${progress.rows_written.toLocaleString()} filas`];
  if (progress.rows_per_sec) parts.push(`${Math.round(progress.rows_per_sec).toLocaleString()} filas/s`);
  const eta = formatEta(progress, estimatedRows);
  if (eta) parts.push(`${eta} restantes`);
  parts.push(progress.stage);
  return parts.join(" · ");
}
