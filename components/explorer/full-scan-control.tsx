"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatRelativeDate } from "@/lib/format";
import type { FullScanState } from "@/lib/graph/scan";

/**
 * Optional full scan (walks every folder) so account-wide analysis — Biggest files
 * / folders / Stale — is complete. Browsing itself is lazy and needs no scan; this
 * is only for the analysis views. Polls progress and is cancellable.
 */
export function FullScanControl({ accountId, initial }: { accountId: string; initial: FullScanState }) {
  const router = useRouter();
  const [state, setState] = useState<FullScanState>(initial);
  const polling = useRef(false);

  useEffect(() => {
    if (!state.isRunning || polling.current) return;
    polling.current = true;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/accounts/${accountId}/scan`, { cache: "no-store" });
        const next: FullScanState = await res.json();
        setState(next);
        router.refresh();
        if (!next.isRunning) {
          clearInterval(timer);
          polling.current = false;
        }
      } catch {
        /* transient */
      }
    }, 2000);
    return () => {
      clearInterval(timer);
      polling.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isRunning, accountId]);

  async function start() {
    await fetch(`/api/accounts/${accountId}/scan`, { method: "POST" });
    const res = await fetch(`/api/accounts/${accountId}/scan`, { cache: "no-store" });
    setState(await res.json());
    router.refresh();
  }
  async function cancel() {
    await fetch(`/api/accounts/${accountId}/scan`, { method: "DELETE" });
    const res = await fetch(`/api/accounts/${accountId}/scan`, { cache: "no-store" });
    setState(await res.json());
    router.refresh();
  }

  if (state.isRunning) {
    return (
      <span className="inline-flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Full scan… {state.items.toLocaleString()} items
        <Button size="xs" variant="ghost" onClick={cancel}>
          <X className="size-3.5" aria-hidden /> Cancel
        </Button>
      </span>
    );
  }

  const done = state.status === "complete" || state.status === "partial";
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      {done && (
        <>
          {state.status === "partial" ? "Partial" : "Full scan"} · {state.items.toLocaleString()} items
          {state.finishedAt ? ` · ${formatRelativeDate(state.finishedAt)}` : ""}
        </>
      )}
      <Button size="xs" variant="outline" onClick={start}>
        <RefreshCw className="size-3.5" aria-hidden /> {done ? "Re-scan all" : "Full scan"}
      </Button>
    </span>
  );
}
