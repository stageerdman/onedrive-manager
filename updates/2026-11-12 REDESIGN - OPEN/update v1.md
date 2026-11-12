# REDESIGN — v1

**Goal:** a modern, minimal ("Steve Jobs filter"), glassy app with three tabs (Accounts,
Transfers, Settings), and Transfers as a real priority queue with pause.

## Roadmap
1. **Engine → queue** — one transfer at a time by `priority`; global pause (stops the active
   one, resumable); reorder (moving above the active one preempts it); remove (deletes partial
   copy on target); stalled-after-25-retries needs manual Retry; live per-file down/up counters
   in memory; heartbeat so a second server process never double-runs a job; progress is
   monotonic across re-walks. ✅
2. **Shell** — background photo + scrim, glass utilities, Geist, 3 big icon tabs (Transfers
   dot while running), logo as app/Mac icon. ✅
3. **Accounts** — card = name, free (hero), meter, used/total, "access until" (90-day sliding
   refresh-token lifetime; amber <14 d; expired → Reconnect). Whole card opens the account. ✅
4. **Explorer** — back arrow, title (account / folder with account eyebrow), one Scan button
   (re-reads current level), rows sorted by size with size bar; hover move → Add to Transfers.
   Analysis views, breadcrumbs, full scan removed. ✅
5. **Transfers** — Source → This Mac → Destination hero with space figures, current file
   down/up bar, overall progress, retry notice; queue with drag + ↑/↓ + Alt+arrows; Pause;
   Add-transfer dialog (From → What → To); Done list with Clear. ✅
6. **Settings** — rename, clear cache, disconnect. ✅
7. **Verify** on the real app (Mac app rebuild) — pause/resume/queue against the live move. ✅

## Status
Phases 1–6 built; lint + typecheck clean; screens verified via headless screenshots on an
isolated dev server (`ODM_TRANSFERS_WORKER=0`, port 3418).

Verified on the rebuilt Mac app against the live "Jeremy Miner" move: auto-resume on boot,
pause (runner stops at its next checkpoint, status → queued), resume, live current-file
counters, monotonic progress. Not exercised live: reorder/preempt and remove (needs a
second real transfer; logic is DB-driven via `topRunnable()` / `control`).
