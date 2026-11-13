"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeftRight, Check, ChevronDown, Pause, Play, Plus, X } from "lucide-react";
import type { MoveState } from "@/lib/graph/move";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TransferHero, type TransferRates } from "@/components/transfers/transfer-hero";
import { RateMeter } from "@/lib/rate";
import { IconButton, QueueRow } from "@/components/transfers/queue-row";
import { AddTransferDialog } from "@/components/transfers/add-transfer-dialog";

export interface AccountInfo {
  id: string;
  label: string;
  connected: boolean;
  free: number | null;
}

const POLL_MS = 1500;

/** The Transfers screen: header controls, the active transfer, the queue, and Done. */
export function TransfersView({ accounts }: { accounts: AccountInfo[] }) {
  const [moves, setMoves] = useState<MoveState[] | null>(null);
  const [paused, setPaused] = useState(false);
  const [adding, setAdding] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const mutating = useRef(false); // ignore polls while an optimistic change is in flight
  const [rates, setRates] = useState<TransferRates | null>(null);
  // Per-file down/up speed over 60 s (uploads land in 10 MiB steps, so shorter windows
  // jump); the overall rate (for time left) over 2 min so the estimate stays calm.
  const meters = useRef<Meters>({
    down: new RateMeter(60_000),
    up: new RateMeter(60_000),
    total: new RateMeter(120_000, 20_000),
    moved: { key: "", lastUploaded: 0, bytes: 0 },
  });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/moves", { cache: "no-store" });
      const data: { paused: boolean; moves: MoveState[] } = await res.json();
      if (mutating.current) return;
      setMoves(data.moves);
      setPaused(data.paused);
      setRates(measure(meters.current, data.moves, data.paused));
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    // Polling an external source; the first call fires immediately.
    const first = setTimeout(refresh, 0);
    const t = setInterval(refresh, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [refresh]);

  const label = (id: string) => accounts.find((a) => a.id === id)?.label ?? "Unknown account";
  const post = (url: string, body?: unknown) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const queue = (moves ?? []).filter((m) => m.status !== "complete");
  const done = (moves ?? []).filter((m) => m.status === "complete");
  const hero = queue.find((m) => m.isRunning) ?? queue.find((m) => m.status !== "stalled") ?? null;
  const upNext = queue.filter((m) => m !== hero);
  const totalQueued = queue.reduce((s, m) => s + Math.max(0, m.bytesTotal - m.bytesDone), 0);

  async function reorder(next: MoveState[]) {
    const ids = next.map((m) => m.id);
    mutating.current = true;
    setMoves([...next, ...done]);
    await post("/api/moves/order", { ids });
    mutating.current = false;
    refresh();
  }

  /** Move an item within the full order (hero included, so moving above it preempts). */
  function shift(id: string, delta: number) {
    const order = hero ? [hero, ...upNext] : [...upNext];
    const from = order.findIndex((m) => m.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= order.length) return;
    const next = [...order];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    setAnnounce(`${m.itemName ?? "Transfer"} moved to position ${to + 1}.${to === 0 ? " Runs now." : ""}`);
    reorder(next);
  }

  function dropOn(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const order = hero ? [hero, ...upNext] : [...upNext];
    const from = order.findIndex((m) => m.id === dragId);
    const to = order.findIndex((m) => m.id === targetId);
    const next = [...order];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    reorder(next);
  }

  async function remove(id: string) {
    mutating.current = true;
    setMoves((ms) => ms?.filter((m) => m.id !== id) ?? null);
    await fetch(`/api/moves/${id}`, { method: "DELETE" });
    mutating.current = false;
    refresh();
  }

  async function togglePause() {
    setPaused(!paused);
    await post("/api/moves/pause", { paused: !paused });
    refresh();
  }

  const order = hero ? [hero, ...upNext] : upNext;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex h-10 items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="text-xl font-semibold">Transfers</h1>
          {queue.length > 0 && (
            <span className="truncate text-xs text-white/50 tabular-nums">
              {queue.length} in queue · {formatBytes(totalQueued)} to go
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {queue.length > 0 && (
            <button
              type="button"
              onClick={togglePause}
              aria-pressed={paused}
              className="glass flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium hover:bg-white/[0.09]"
            >
              {paused ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
              {paused ? "Resume" : "Pause"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex h-9 items-center gap-2 rounded-full px-4 text-sm text-white/80 hover:bg-white/10 hover:text-white"
          >
            <Plus className="size-4" aria-hidden /> Add transfer
          </button>
        </div>
      </header>

      {moves === null ? (
        <div className="glass h-64 animate-pulse rounded-2xl motion-reduce:animate-none" />
      ) : queue.length === 0 ? (
        <div className="glass flex flex-col items-center gap-3 rounded-2xl py-16 text-center">
          <ArrowLeftRight className="size-8 text-white/30" aria-hidden />
          <p className="text-base">No transfers</p>
          <p className="text-sm text-white/50">Move folders between accounts to free up space.</p>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-2 rounded-full bg-sky-300 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-sky-200"
          >
            Add transfer
          </button>
        </div>
      ) : (
        <>
          {hero && (
            <TransferHero
              move={hero}
              rates={hero.isRunning ? rates : null}
              label={label}
              queuePaused={paused}
              actions={
                <>
                  {upNext.length > 0 && (
                    <IconButton label={`Move ${hero.itemName ?? "transfer"} down`} onClick={() => shift(hero.id, 1)}>
                      <ChevronDown className="size-4" aria-hidden />
                    </IconButton>
                  )}
                  <HeroRemove move={hero} label={label} onRemove={() => remove(hero.id)} />
                </>
              }
            />
          )}

          {upNext.length > 0 && (
            <section aria-label="Up next" className="flex flex-col gap-2">
              <h2 className="px-1 text-xs text-white/50">Up next</h2>
              <ul role="list" className="glass divide-y divide-white/[0.06] rounded-2xl">
                {upNext.map((m) => {
                  const idx = order.indexOf(m);
                  return (
                    <QueueRow
                      key={m.id}
                      move={m}
                      position={idx + 1}
                      label={label}
                      canUp={idx > 0}
                      canDown={idx < order.length - 1}
                      onUp={() => shift(m.id, -1)}
                      onDown={() => shift(m.id, 1)}
                      onRemove={() => remove(m.id)}
                      onRetry={() => post(`/api/moves/${m.id}/retry`).then(refresh)}
                      dragging={dragId === m.id}
                      dragProps={{
                        draggable: true,
                        tabIndex: 0,
                        "aria-label": `${m.itemName ?? "Transfer"}, position ${idx + 1}. Alt+Up or Alt+Down to reorder.`,
                        onDragStart: () => setDragId(m.id),
                        onDragEnd: () => setDragId(null),
                        onDragOver: (e) => e.preventDefault(),
                        onDrop: () => dropOn(m.id),
                      }}
                    />
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}

      {done.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-1 text-xs text-white/50 hover:text-white/80">
            <span>Done ({done.length})</span>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                post("/api/moves/clear").then(refresh);
              }}
              className="rounded-full px-2 py-0.5 hover:bg-white/10"
            >
              Clear
            </button>
          </summary>
          <ul role="list" className="glass mt-2 divide-y divide-white/[0.06] rounded-2xl text-sm text-white/50">
            {done.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                <Check className="size-4 shrink-0 text-sky-300" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{m.itemName}</span>
                <span className="hidden text-xs sm:inline">
                  {label(m.sourceAccount)} → {label(m.targetAccount)}
                </span>
                <span className="w-20 text-right tabular-nums">{formatBytes(m.bytesTotal)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <span className="sr-only" aria-live="polite">
        {announce}
      </span>

      {adding && (
        <AddTransferDialog
          accounts={accounts.filter((a) => a.connected)}
          onClose={() => setAdding(false)}
          onAdded={(name) => {
            setAdding(false);
            setAnnounce(`${name} added to the queue.`);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function HeroRemove({
  move,
  label,
  onRemove,
}: {
  move: MoveState;
  label: (id: string) => string;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <IconButton label={`Remove ${move.itemName ?? "transfer"}`} onClick={() => setConfirming(true)}>
        <X className="size-4" aria-hidden />
      </IconButton>
    );
  }
  return (
    <div
      className={cn(
        "glass-strong absolute right-6 top-14 z-10 flex max-w-xs flex-col gap-3 rounded-xl p-3 text-sm text-white/70",
      )}
      role="dialog"
      aria-label="Remove transfer"
    >
      <p>
        Remove <span className="text-white/90">{move.itemName}</span>?{" "}
        {move.bytesDone > 0 && `${formatBytes(move.bytesDone)} already copied to ${label(move.targetAccount)} will be deleted. `}
        Source untouched.
      </p>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-full px-3 py-1 text-white/60 hover:bg-white/10"
        >
          Cancel
        </button>
        <button type="button" autoFocus onClick={onRemove} className="rounded-full px-3 py-1 text-rose-400 hover:bg-rose-400/10">
          Remove
        </button>
      </div>
    </div>
  );
}

/**
 * Feed the meters from one poll and read the speeds back. Speeds only mean something
 * while bytes are actually moving, so everything resets (and nothing is shown) while
 * paused, retrying, deleting the source or checking which files are already there.
 */
interface Meters {
  down: RateMeter;
  up: RateMeter;
  total: RateMeter;
  /**
   * Bytes actually uploaded while watching. Not `bytesDone`: that's a high-water mark
   * (it can include progress from earlier failed attempts and sit still for a while).
   */
  moved: { key: string; lastUploaded: number; bytes: number };
}

function measure(
  m: Meters,
  moves: MoveState[],
  paused: boolean,
): TransferRates | null {
  const run = moves.find((x) => x.isRunning);
  const cur = run?.current;
  if (!run || paused || run.error || run.status !== "copying" || !cur) {
    m.down.reset();
    m.up.reset();
    m.total.reset();
    m.moved = { key: "", lastUploaded: 0, bytes: 0 };
    return null;
  }
  const fileKey = `${run.id}/${cur.name}`;
  m.down.add(fileKey, cur.downloaded);
  m.up.add(fileKey, cur.uploaded);
  const mv = m.moved;
  if (mv.key !== fileKey) {
    // A new file: count from 0 if we were already watching this transfer, else start here.
    mv.lastUploaded = mv.key.startsWith(`${run.id}/`) ? 0 : cur.uploaded;
    mv.key = fileKey;
  }
  mv.bytes += Math.max(0, cur.uploaded - mv.lastUploaded);
  mv.lastUploaded = cur.uploaded;
  m.total.add(run.id, mv.bytes);
  const total = m.total.rate();
  return {
    down: cur.serverSide ? null : m.down.rate(),
    up: cur.serverSide ? null : m.up.rate(),
    total,
    secondsLeft: total && total > 0 ? Math.max(0, run.bytesTotal - run.bytesDone) / total : null,
  };
}
