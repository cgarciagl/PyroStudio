/**
 * Stable identity for grid rows, used to key staged changes.
 *
 * Staged changes used to be keyed by the row's position in the visible list. That
 * position changes with client search, sorting and paging, so two different records
 * could share a key: a second edit replaced the first one, highlights landed on the
 * wrong row and, worse, edits of two records were merged into a single UPDATE that
 * used the first record's WHERE.
 *
 * Tables with a primary key use the key values (stable across reloads). Without one,
 * each row object gets a session-unique id that is inherited by the copies created
 * when a cell is edited locally.
 */
const ids = new WeakMap<object, string>();
let seq = 0;

export function rowKeyOf(
  row: unknown[],
  columns: string[] | undefined,
  pkColumns: string[],
): string {
  const known = ids.get(row);
  if (known) return known;
  let key: string;
  if (pkColumns.length > 0 && columns) {
    const lower = columns.map((c) => c.toLowerCase());
    const idx = pkColumns.map((c) => lower.indexOf(c.toLowerCase()));
    key = idx.includes(-1)
      ? `row:${++seq}`
      : `pk:${JSON.stringify(idx.map((i) => row[i] ?? null))}`;
  } else {
    key = `row:${++seq}`;
  }
  ids.set(row, key);
  return key;
}

/** The edited copy of a row keeps the identity of the original. */
export function inheritRowKey(from: unknown[] | undefined, to: unknown[]): void {
  if (!from) return;
  const key = ids.get(from);
  if (key) ids.set(to, key);
}
