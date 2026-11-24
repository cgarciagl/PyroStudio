import i18n from "../i18n";

/** Human size: 0 B, 1.5 KB, 12 MB… */
export function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  const value = bytes / Math.pow(k, i);
  const formatted = new Intl.NumberFormat(i18n.language || "es", {
    maximumFractionDigits: 1,
  }).format(value);
  return `${formatted} ${sizes[i]}`;
}
