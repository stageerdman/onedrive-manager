import { cn } from "@/lib/utils";

/** Thin storage meter. `warn` turns it amber (nearly full). */
export function SpaceMeter({ used, total, warn = false }: { used: number; total: number; warn?: boolean }) {
  const pct = total > 0 ? Math.min(100, Math.max(0, (used / total) * 100)) : 0;
  return (
    <div
      role="meter"
      aria-label="Storage used"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className="h-1.5 w-full overflow-hidden rounded-full bg-white/10"
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-700 ease-out", warn ? "bg-amber-300" : "bg-sky-300")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
