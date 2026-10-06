"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes, formatRelativeDate } from "@/lib/format";
import type { ScanState } from "@/lib/graph/scan";

/**
 * Starts / re-runs a scan and polls progress (spec #2 §8: never a blocking
 * spinner — show the running count, keep the page usable). Calls router.refresh()
 * as counts climb so the cached rows stream in, and once more on completion.
 */
export function ScanControl({ accountId, initial }: { accountId: string; initial: ScanState }) {
  const router = useRouter();
  const [state, setState] = useState<ScanState>(initial);
  const polling = useRef(false);

  const isScanning = state.isRunning || state.status === "scanning";

  useEffect(() => {
    if (!isScanning || polling.current) return;
    polling.current = true;
    let lastCount = state.itemsCount;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/accounts/${accountId}/scan`, { cache: "no-store" });
        const next: ScanState = await res.json();
        setState(next);
        if (next.itemsCount !== lastCount) {
          lastCount = next.itemsCount;
          router.refresh(); // stream newly-cached rows in
        }
        if (!next.isRunning && next.status !== "scanning") {
          clearInterval(timer);
          polling.current = false;
          router.refresh();
        }
      } catch {
        /* keep polling; transient */
      }
    }, 1500);
    return () => {
      clearInterval(timer);
      polling.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isScanning, accountId]);

  async function start() {
    await fetch(`/api/accounts/${accountId}/scan`, { method: "POST" });
    const res = await fetch(`/api/accounts/${accountId}/scan`, { cache: "no-store" });
    setState(await res.json());
    router.refresh();
  }

  if (isScanning) {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-muted-foreground tabular-nums">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Scanning… {state.itemsCount.toLocaleString()} items, {formatBytes(state.bytesCount)}
      </span>
    );
  }

  const scanned = state.finishedAt && (state.status === "complete" || state.status === "partial");
  return (
    <div className="inline-flex items-center gap-3">
      {scanned && (
        <span className="text-xs text-muted-foreground">
          {state.status === "partial" ? "Partial scan · " : ""}Last scanned {formatRelativeDate(state.finishedAt)}
        </span>
      )}
      <Button size="sm" variant="outline" onClick={start}>
        <RefreshCw className="size-3.5" aria-hidden />
        {scanned ? "Re-scan" : "Scan now"}
      </Button>
    </div>
  );
}
