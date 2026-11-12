/** Durations from the server, readable at a glance: 0.84 ms, 12.3 ms, 1.42 s, 3 min 05 s. */
export function formatSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "0 s";
  if (sec < 1) {
    const ms = sec * 1000;
    return `${ms < 10 ? ms.toFixed(2) : ms < 100 ? ms.toFixed(1) : Math.round(ms)} ms`;
  }
  if (sec < 60) return `${sec.toFixed(sec < 10 ? 2 : 1)} s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m} min ${String(s).padStart(2, "0")} s`;
}

/** Case-insensitive match of the filter against any of the given texts. */
export function matchesFilter(filter: string, ...texts: (string | undefined | null)[]): boolean {
  const q = filter.trim().toLowerCase();
  return !q || texts.some((t) => t?.toLowerCase().includes(q));
}
