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

const MS = { day: 86_400_000, month: 2_629_800_000, year: 31_557_600_000 };

/** "today" / "3 days ago" / "5 months ago" / "2y ago". Empty string for null. */
export function formatRelativeDate(iso: string | null): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  if (diff < MS.day) return "today";
  if (diff < MS.month) return `${Math.round(diff / MS.day)}d ago`;
  if (diff < MS.year) return `${Math.round(diff / MS.month)}mo ago`;
  const years = diff / MS.year;
  return `${years < 10 ? years.toFixed(years < 2 ? 1 : 0) : Math.round(years)}y ago`;
}

export function formatAbsoluteDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export type Staleness = "fresh" | "aging" | "stale";

/** Honest staleness from `modified` (spec #2 §4): fresh ≤6mo, aging 6mo–2y, stale >2y. */
export function stalenessLevel(iso: string | null): Staleness {
  if (!iso) return "fresh";
  const diff = Date.now() - Date.parse(iso);
  if (diff > 2 * MS.year) return "stale";
  if (diff > 6 * MS.month) return "aging";
  return "fresh";
}
