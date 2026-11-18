import {
  exportToTsv,
  exportToCommaSeparated,
  exportToSqlInsert,
  exportToJsonArray,
  exportToMarkdownTable,
  exportToPhpArray,
  exportToTsArray,
} from "../../utils/formatCopy";

export type SmartCopyFormat = "tsv" | "comma" | "sql" | "json" | "markdown" | "php" | "ts";

/** Serializes a selection matrix into the requested clipboard format. */
export function buildSmartCopyOutput(
  format: SmartCopyFormat,
  columns: string[],
  rows: any[][],
  opts: { database: string; table: string; dialect: Parameters<typeof exportToCommaSeparated>[1] },
): string {
  switch (format) {
    case "tsv":
      return exportToTsv(columns, rows, true);
    case "comma":
      return exportToCommaSeparated(rows, opts.dialect);
    case "sql":
      return exportToSqlInsert(opts.database, opts.table, columns, rows, opts.dialect);
    case "json":
      return exportToJsonArray(columns, rows);
    case "markdown":
      return exportToMarkdownTable(columns, rows);
    case "php":
      return exportToPhpArray(columns, rows);
    case "ts":
      return exportToTsArray(columns, rows);
  }
}

export function copySelectionToClipboard(
  format: SmartCopyFormat,
  columns: string[],
  rows: unknown[][],
  opts: { database: string; table: string; dialect: Parameters<typeof exportToCommaSeparated>[1] },
  onStatus: (status: { success: boolean; message: string } | null) => void,
): void {
  if (rows.length === 0 || columns.length === 0) return;
  const output = buildSmartCopyOutput(format, columns, rows as any[][], opts);
  navigator.clipboard.writeText(output).then(
    () => {
      onStatus({
        success: true,
        message: `Copiado (${format.toUpperCase()}): ${rows.length} fila(s), ${columns.length} col(s).`,
      });
      setTimeout(() => onStatus(null), 3000);
    },
    (err) => {
      onStatus({ success: false, message: `No se pudo copiar al portapapeles: ${err}` });
      setTimeout(() => onStatus(null), 5000);
    },
  );
}
