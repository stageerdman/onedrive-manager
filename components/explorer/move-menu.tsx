"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRightLeft, Check } from "lucide-react";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface MoveTarget {
  id: string;
  label: string;
  /** Free bytes, or null when unknown. */
  free: number | null;
}

/**
 * Hover-revealed "move to another account": pick a target, confirm, and the item is
 * added to the Transfers queue (copy → verify → delete source happens there).
 */
export function MoveMenu({
  sourceAccountId,
  itemId,
  itemName,
  itemSize,
  targets,
}: {
  sourceAccountId: string;
  itemId: string;
  itemName: string;
  itemSize: number;
  targets: MoveTarget[];
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<MoveTarget | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "added" | "error">("idle");
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      setPicked(null);
      triggerRef.current?.focus();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (targets.length === 0) return null;

  if (state === "added") {
    return (
      <Link href="/transfers" title="Added to Transfers" className="flex size-9 items-center justify-center text-sky-300">
        <Check className="size-4" aria-hidden />
        <span className="sr-only" aria-live="polite">Added to Transfers</span>
      </Link>
    );
  }

  async function add(target: MoveTarget) {
    setState("sending");
    try {
      const res = await fetch("/api/moves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceAccount: sourceAccountId, targetAccount: target.id, itemId }),
      });
      setState(res.ok ? "added" : "error");
      if (res.ok) setOpen(false);
    } catch {
      setState("error");
    }
  }

  const fits = picked ? picked.free == null || picked.free >= itemSize : true;

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Move ${itemName} to another account`}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "flex size-9 items-center justify-center rounded-lg text-white/60 transition duration-150 hover:bg-white/10 hover:text-white",
          "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
          open && "opacity-100",
        )}
      >
        <ArrowRightLeft className="size-4" aria-hidden />
      </button>

      {open && (
        <div role="dialog" aria-label="Move to" className="glass-strong absolute right-0 top-full z-20 mt-1 w-64 rounded-xl p-2">
          {picked ? (
            <div className="flex flex-col gap-3 p-2">
              <p className="text-[13px] text-white/60">
                Move <span className="text-white/90">{itemName}</span> ({formatBytes(itemSize)}) to{" "}
                <span className="text-white/90">{picked.label}</span>
              </p>
              {!fits && <p className="text-[13px] text-amber-300">Not enough free space</p>}
              {state === "error" && <p className="text-[13px] text-rose-400">Couldn&apos;t add it. Try again.</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  autoFocus
                  disabled={!fits || state === "sending"}
                  onClick={() => add(picked)}
                  className="flex-1 rounded-full bg-sky-300 px-3 py-1.5 text-[13px] font-medium text-neutral-950 hover:bg-sky-200 disabled:opacity-40"
                >
                  Add to Transfers
                </button>
                <button
                  type="button"
                  onClick={() => setPicked(null)}
                  className="rounded-full px-3 py-1.5 text-[13px] text-white/60 hover:bg-white/10 hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="px-2 pb-1 pt-1 text-[13px] text-white/50">Move to</p>
              {targets.map((t, i) => (
                <button
                  key={t.id}
                  type="button"
                  autoFocus={i === 0}
                  onClick={() => setPicked(t)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-[15px] hover:bg-white/10"
                >
                  <span className="truncate">{t.label}</span>
                  {t.free != null && (
                    <span className="shrink-0 text-[13px] text-white/50 tabular-nums">{formatBytes(t.free)} free</span>
                  )}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
