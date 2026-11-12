/**
 * Unique suffix for ids of tabs, messages, rules, connections…
 *
 * `Date.now()` alone repeats within the same millisecond (double click, two tabs opened
 * by one action), which made the second tab replace or reuse the first one. A counter
 * makes it unique in this session and the random part across sessions/windows.
 * The time prefix keeps ids roughly sortable by creation.
 */
let counter = 0;

export function uid(): string {
  counter = (counter + 1) % 1_679_616; // 36^4
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}${counter.toString(36).padStart(4, "0")}${random}`;
}
