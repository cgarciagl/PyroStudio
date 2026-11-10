export const MAX_CANVAS_TEXT_LENGTH = 1000;

/**
 * Prepares display text for a canvas cell. Massive strings are truncated
 * with a size indicator to protect canvas text measurement and memory,
 * while preserving full content in the underlying cell data.
 */
export function formatCellDisplay(
  value: unknown,
  isJson: boolean = false
): { displayData: string; fullData: string } {
  if (value === null || value === undefined) {
    return { displayData: "NULL", fullData: "" };
  }
  const str =
    typeof value === "string"
      ? value
      : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);

  if (isJson) {
    const displayData = str.length > 60 ? `${str.slice(0, 57)}...` : str;
    return { displayData, fullData: str };
  }

  if (str.length > MAX_CANVAS_TEXT_LENGTH) {
    const excessKb = Math.max(1, Math.round((str.length - MAX_CANVAS_TEXT_LENGTH) / 1024));
    const displayData = `${str.slice(0, MAX_CANVAS_TEXT_LENGTH)}… (+${excessKb} KB)`;
    return { displayData, fullData: str };
  }

  return { displayData: str, fullData: str };
}
