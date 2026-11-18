const GENERIC_QUERY_TAB_RE = /^Consulta(?:\s+\d+(?:\s+\(Copia\))?|\s*·.*)$/i;

export function isGenericQueryTabTitle(title: string | undefined): boolean {
  const trimmed = title?.trim() ?? "";
  return !trimmed || GENERIC_QUERY_TAB_RE.test(trimmed);
}

function formatLocalTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${y}-${m}-${d}_${hh}-${mm}-${ss}`;
}

/**
 * Sanitizes a free-form title or identifier into a safe cross-platform filename segment.
 */
export function sanitizeFilenameSegment(raw: string, maxLength = 80): string {
  const withoutSqlExt = raw.trim().replace(/\.sql$/i, "");
  const cleaned = withoutSqlExt
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[.\s_]+|[.\s_]+$/g, "");

  if (!cleaned) return "";
  return cleaned.slice(0, maxLength).replace(/[.\s_]+$/g, "");
}

/**
 * Builds the default filename (without extension) for exporting query results.
 * Uses the query's custom title when available, with a local date/time suffix.
 */
export function buildQueryExportDefaultName(
  tabTitle: string | undefined,
  database: string | undefined,
  now: Date = new Date(),
): string {
  const timestamp = formatLocalTimestamp(now);
  const trimmedTitle = tabTitle?.trim() ?? "";

  if (!isGenericQueryTabTitle(trimmedTitle)) {
    const safeTitle = sanitizeFilenameSegment(trimmedTitle);
    if (safeTitle) {
      return `${safeTitle}_${timestamp}`;
    }
  }

  const safeDb = database ? sanitizeFilenameSegment(database, 40) : "";
  return safeDb ? `consulta_${safeDb}_${timestamp}` : `consulta_${timestamp}`;
}

/**
 * Builds the default filename (without extension) for exporting a table.
 */
export function buildTableExportDefaultName(
  table: string,
  now: Date = new Date(),
): string {
  const timestamp = formatLocalTimestamp(now);
  const safeTable = sanitizeFilenameSegment(table, 60) || "tabla";
  return `${safeTable}_${timestamp}`;
}
