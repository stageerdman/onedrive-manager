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

/** "10 Feb" style short date. */
export function formatDayMonth(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Whole days from now until `iso` (negative when past). */
export function daysUntil(iso: string): number {
  return Math.floor((Date.parse(iso) - Date.now()) / MS.day);
}

/** "850 kB/s" / "1.2 MB/s" / "14 MB/s" — decimal units, one decimal under 10. */
export function formatRate(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "0 kB/s";
  const mb = bytesPerSecond / 1e6;
  if (mb < 1) return `${Math.max(1, Math.round(bytesPerSecond / 1e3))} kB/s`;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB/s`;
}

/**
 * Coarse time left, rounded so it doesn't twitch: "under a minute", "about 25 min",
 * "1 h 20 min", "about 4½ h", "about 3 days".
 */
export function formatTimeLeft(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  if (seconds < 60) return "under a minute";
  const min = seconds / 60;
  if (min < 60) return `about ${Math.max(5, Math.round(min / 5) * 5)} min`;
  if (min < 120) {
    const m = Math.round((min - 60) / 10) * 10;
    return m === 0 ? "1 h" : m === 60 ? "2 h" : `1 h ${m} min`;
  }
  const h = min / 60;
  if (h >= 48) return `about ${Math.round(h / 24)} days`;
  const halves = Math.round(h * 2) / 2;
  return `about ${Math.floor(halves)}${halves % 1 ? "½" : ""} h`;
}
