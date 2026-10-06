# CLOUD-DEPLOY — run moves on an always-on host

**Status:** OPEN · created 2026-10-06 · plan v1

## Goal
Make cross-account moves run **without the owner's computer on**. The owner starts a
move, closes the laptop, and the move streams to completion server-side — no Resume
click, even if the host restarts mid-move.

This supersedes the previous "package as Electron `.app`" next-step. Electron keeps the
app *on this machine*; the real need is the opposite — the move engine living somewhere
that stays up. The dashboard/explorer don't need to be hosted; only the **move engine**
does. (The owner can still open the hosted URL from any browser to kick off or watch a
move — the browser is just the remote control; the job runs in the server process.)

## Why not serverless (the constraint that picks the host)
Two hard facts about this app rule out Vercel/Netlify-style serverless:
1. **A move is a long-running in-memory job.** `startMove` kicks off a streaming loop
   that can run for hours on a 64 GB folder and tracks live state in an in-process
   `Set`. Serverless functions cap execution at ~300 s and don't keep an in-memory job
   alive after the HTTP response returns — a move would be killed mid-stream.
2. **The store is a local SQLite file** (`better-sqlite3` → `data/onedrive-manager.db`),
   a native binary writing to the local disk. Serverless filesystems are ephemeral.

So this app wants **one small always-on box with a persistent disk**, which runs the
code essentially unchanged. Chosen host: **Oracle Cloud Always Free** (genuinely $0,
always-on, real Linux VM + disk). See `oracle-cloud-deploy.md` for the step-by-step.

## Phased roadmap

### Phase 1 — Auto-resume interrupted moves on boot ✅
- A move runs in-memory, so a restart (crash, reboot, redeploy) leaves its row in an
  active status (`copying`/`verifying`/`deleting`) with nothing driving it. Before this,
  `rowToState` only *relabelled* such a move as resumable for display — a human still had
  to click Resume.
- Added `resumeInterruptedMoves()` (`lib/graph/move.ts`): on startup, relaunch every
  move left in an active status. Idempotent copy means it just continues with the files
  not yet copied. `paused` moves (25× auto-retry exhausted = something's actually wrong)
  are deliberately skipped — those still wait for a human.
- Wired via `instrumentation.ts` `register()`, guarded to the `nodejs` runtime.
- **Verify:** done — against the live 64 GB "Jeremy Miner" move. A dev-server restart
  left it `copying`; on boot the hook relaunched it and the file counter advanced
  (119 → 120) with no manual Resume. `resumeMove` early-returns if already running, so no
  double-launch. `tsc`/`eslint` clean.

### Phase 2 — Deployment guide 📄
- Step-by-step for Oracle Cloud Always Free: provision ARM VM, clone + build, `systemd`
  unit for `next start` on 127.0.0.1:3000, Caddy reverse proxy for automatic HTTPS, env
  vars, and the one Azure step (add the prod redirect URI).
- Written as `oracle-cloud-deploy.md` in this folder.
- **Verify:** owner follows it to a live HTTPS URL; a move started there finishes with
  the laptop closed. *(Owner-run — see "Where we are".)*

## Status tracking
- [x] Phase 1 — auto-resume-on-boot hook (code + instrumentation, verified on live move)
- [x] Phase 2 — Oracle Cloud deployment guide written
- [ ] Phase 2 — owner provisions the box and runs the first unattended move (owner step)

## Where we are (handoff — 2026-10-06)
The app-side work is **done and verified**: an interrupted move now self-resumes on
process start, which is the one thing that was missing for a truly hands-off host. The
deployment guide (`oracle-cloud-deploy.md`) is ready to follow.

**Owner's turn:** provision the Oracle Always-Free VM and follow the guide. The only
app-config change is `AZURE_REDIRECT_URI` → the box's HTTPS callback, registered in the
Azure app registration (alongside the existing localhost one). Durable decisions and the
bandwidth caveat are in `wiki.md`.
