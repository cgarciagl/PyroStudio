/** Rows per sheet in Excel (one more is the header). */
export const EXCEL_MAX_ROWS = 1_048_575;
/** From here on an Excel export is slow and heavy, even below the sheet limit. */
export const LARGE_EXPORT_ROWS = 500_000;

/**
 * Advice shown before a large export to a format that does not suit it, or
 * `null` when the chosen format is fine. `estimatedRows` comes from the table
 * statistics, so it is approximate.
 */
export function exportFormatAdvice(estimatedRows: number | null | undefined, filePath: string): string | null {
  if (!estimatedRows || estimatedRows < LARGE_EXPORT_ROWS) return null;
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".gz")) return null;
  const rows = `~${estimatedRows.toLocaleString()}`;
  if (estimatedRows > EXCEL_MAX_ROWS) {
    const sheets = Math.ceil(estimatedRows / EXCEL_MAX_ROWS);
    return `La tabla tiene ${rows} filas: Excel admite ${EXCEL_MAX_ROWS.toLocaleString()} por hoja, así que el archivo tendrá unas ${sheets} hojas y será lento de generar y de abrir. Para este volumen se recomienda CSV.gz (comprimido) o CSV por partes (Preferencias → Base de datos).`;
  }
  return `La tabla tiene ${rows} filas: un Excel de ese tamaño tarda en generarse y en abrirse. Para este volumen se recomienda CSV o CSV.gz.`;
}
