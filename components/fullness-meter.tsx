import { cn } from "@/lib/utils";

/**
 * The hero visual (spec #1 §3): one horizontal bar, filled = used. Color encodes
 * *pressure*, not identity — green < 70%, amber 70–90%, red > 90% — so a row of
 * meters triages at a glance. Identity colour is the separate accent dot.
 */
export function FullnessMeter({ fraction, className }: { fraction: number; className?: string }) {
  const pct = Math.min(Math.max(fraction, 0), 1) * 100;
  const color =
    fraction > 0.9 ? "bg-red-500" : fraction >= 0.7 ? "bg-amber-500" : "bg-green-500";

  return (
    <div
      className={cn("h-2.5 w-full overflow-hidden rounded-full bg-muted", className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Storage used"
    >
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}
