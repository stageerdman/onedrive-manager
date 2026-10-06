"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Loader2, Check, AlertTriangle } from "lucide-react";
import { formatBytes } from "@/lib/format";
import type { MoveState } from "@/lib/graph/move";

export interface MoveTarget {
  id: string;
  label: string;
}

/**
 * Per-row cross-account move (spec: copy → verify → delete-source). Pick a target
 * drive, confirm the destructive step explicitly, then watch progress inline.
 * Nothing is deleted on the source until the copy is verified server-side.
 */
export function MoveMenu({
  sourceAccountId,
  itemId,
  itemName,
  targets,
}: {
  sourceAccountId: string;
  itemId: string;
  itemName: string;
  targets: MoveTarget[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<MoveTarget | null>(null);
  const [move, setMove] = useState<MoveState | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setPending(null);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Poll an in-flight move.
  useEffect(() => {
    if (!move || move.status === "complete" || move.status === "error") return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/moves/${move.id}`, { cache: "no-store" });
        const next: MoveState = await res.json();
        setMove(next);
        if (next.status === "complete") {
          clearInterval(timer);
          router.refresh();
        } else if (next.status === "error") {
          clearInterval(timer);
        }
      } catch {
        /* transient */
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [move, router]);

  async function begin(target: MoveTarget) {
    const res = await fetch(`/api/accounts/${sourceAccountId}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, targetAccountId: target.id }),
    });
    const state: MoveState = await res.json();
    setOpen(false);
    setPending(null);
    setMove(state);
  }

  if (targets.length === 0) return null;

  // Active / finished move status pill.
  if (move) {
    if (move.status === "error") {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-destructive" title={move.error ?? ""}>
          <AlertTriangle className="size-3.5" aria-hidden /> Move failed
        </span>
      );
    }
    if (move.status === "complete") {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-500">
          <Check className="size-3.5" aria-hidden /> Moved
        </span>
      );
    }
    const label =
      move.status === "deleting" ? "Removing original…" : move.status === "verifying" ? "Verifying…" : "Copying…";
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> {label}{" "}
        {move.bytesTotal > 0 ? formatBytes(move.bytesDone) : ""}
      </span>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        title="Move to another drive"
      >
        <ArrowRightLeft className="size-3.5" aria-hidden />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 w-60 rounded-lg border bg-background p-1 shadow-md">
          {pending ? (
            <div className="p-2">
              <p className="mb-2 text-xs text-muted-foreground">
                Copy <span className="font-medium text-foreground">{itemName}</span> to{" "}
                <span className="font-medium text-foreground">{pending.label}</span>, then delete it here?
                The original is removed only after the copy is verified.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => begin(pending)}
                  className="flex-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Move
                </button>
                <button
                  type="button"
                  onClick={() => setPending(null)}
                  className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="px-2 py-1 text-xs text-muted-foreground">Move to…</p>
              {targets.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setPending(t)}
                  className="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  {t.label}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
