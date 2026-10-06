"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, AlertTriangle, X, Play } from "lucide-react";
import { formatBytes } from "@/lib/format";
import type { MoveState } from "@/lib/graph/move";

/**
 * Persistent cross-account move tracker, mounted in the app shell so it shows on
 * every screen. Polls while anything is active, and surfaces paused/failed moves
 * with a Resume button (the move continues from where it left off, even days later).
 */
export function MovesBar() {
  const router = useRouter();
  const [moves, setMoves] = useState<MoveState[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let active = true;

    async function tick() {
      try {
        const res = await fetch("/api/moves", { cache: "no-store" });
        const data = await res.json();
        if (active) setMoves(data.moves ?? []);
      } catch {
        /* ignore */
      }
    }

    tick();
    timer = setInterval(tick, 2000);
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  // Show in-flight + paused always; finished ones until dismissed.
  const visible = moves.filter((m) => {
    if (dismissed.has(m.id)) return false;
    return ["copying", "verifying", "deleting", "paused", "error", "complete", "cancelled"].includes(m.status);
  });
  // Don't clutter: only show finished moves if there's recent action.
  const shown = visible.filter(
    (m) => m.isRunning || m.status === "paused" || m.status === "error" || m.status === "complete",
  );
  if (shown.length === 0) return null;

  async function resume(id: string) {
    await fetch(`/api/moves/${id}/resume`, { method: "POST" });
    router.refresh();
  }
  async function cancel(id: string) {
    await fetch(`/api/moves/${id}/cancel`, { method: "POST" });
  }

  return (
    <div className="fixed bottom-4 left-1/2 z-50 w-[min(92vw,30rem)] -translate-x-1/2 space-y-2">
      {shown.map((m) => {
        const pct = m.bytesTotal > 0 ? Math.min(100, Math.round((m.bytesDone / m.bytesTotal) * 100)) : 0;
        const active = m.isRunning;
        return (
          <div key={m.id} className="rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <StatusIcon status={m.status} active={active} />
                <span className="truncate text-sm font-medium">{m.itemName ?? "Move"}</span>
              </div>
              <div className="flex items-center gap-1">
                {(m.status === "paused" || m.status === "error") && (
                  <button
                    onClick={() => resume(m.id)}
                    className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    <Play className="size-3" aria-hidden /> Resume
                  </button>
                )}
                {active && (
                  <button
                    onClick={() => cancel(m.id)}
                    className="rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                  >
                    Cancel
                  </button>
                )}
                {(m.status === "complete" || m.status === "cancelled") && (
                  <button
                    onClick={() => setDismissed((s) => new Set(s).add(m.id))}
                    className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                    aria-label="Dismiss"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                )}
              </div>
            </div>

            {m.bytesTotal > 0 && m.status !== "complete" && (
              <div className="mt-2">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {formatBytes(m.bytesDone)} of {formatBytes(m.bytesTotal)} ({pct}%)
                  {m.filesDone > 0 ? ` · ${m.filesDone} files` : ""}
                </p>
              </div>
            )}
            {m.status === "paused" && m.error && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">{m.error}</p>
            )}
            {m.status === "complete" && (
              <p className="mt-1 text-xs text-green-600 dark:text-green-500">Moved — source removed.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StatusIcon({ status, active }: { status: string; active: boolean }) {
  if (active) return <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />;
  if (status === "complete") return <Check className="size-4 shrink-0 text-green-600 dark:text-green-500" aria-hidden />;
  if (status === "paused" || status === "error")
    return <AlertTriangle className="size-4 shrink-0 text-amber-500" aria-hidden />;
  return <X className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
}
