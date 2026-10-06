/**
 * Human-readable storage sizes. Base-1024 units (what OneDrive reports), one
 * decimal max, tabular-friendly. `formatBytes(0)` → "0 B".
 */
const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

export function formatBytes(bytes: number, maxFractionDigits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / 1024 ** i;
  // Whole numbers for bytes; up to maxFractionDigits for larger units.
  const digits = i === 0 ? 0 : maxFractionDigits;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: digits })} ${UNITS[i]}`;
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
