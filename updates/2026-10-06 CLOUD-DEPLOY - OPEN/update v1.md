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
- [x] Phase 2 — DigitalOcean deploy guide written (`digitalocean-deploy.md`)
- [ ] Phase 2 — owner provisions the box and runs the first unattended move (owner step)
  - ⏸ **Blocked 2026-10-07:** Oracle registration won't complete (can't register). Owner
    has opened a request with Oracle customer support and is **waiting on them** to unblock
    the account. Alternatives were evaluated (see wiki "Re-confirming the host") and Oracle
    remains the choice — no spare home hardware, and free-cloud alternatives fail on egress
    cost or the 12-month clock. No host switch; hold for Oracle support.
  - ✅ **Host switched 2026-10-11:** going with a **DigitalOcean trial-credit Droplet**
    instead of waiting on Oracle (see wiki "round 2"). $0 out of pocket for a bounded
    rebalance, painless signup, x86 VM → existing steps apply. Guide:
    `digitalocean-deploy.md`.
  - ⚠️ **Reverted same day (2026-10-11) — cloud path exhausted (see wiki "round 3"):**
    DO's credit is now **$25 not $200**, and — more importantly — the owner does **not** want
    a trial-credit / paid-plan host at all (a Droplet is a paid plan, credit or not). **Oracle
    is now a hard dead end** — support said they *cannot* resolve the signup failure, so the
    free-forever fallback is gone too. Re-surveyed free-forever VMs incl. Chinese/Russian:
    none fit a Microsoft-upload mover (GCP always-free = 1 GB egress; Chinese = trial + Great
    Firewall; Russian = paid/serverless + MS geo-block risk).
  - 🔀 **New direction — $0 via owned hardware (DECISION PENDING with owner):**
    (1) **run the move on the owner's own laptop overnight** — lid closed, plugged in, sleep
    disabled (Amphetamine/`caffeinate`); bounded job, app already runs locally, auto-resume
    covers interruptions — **recommended, zero setup/cost**; (2) an old phone (Termux)/Pi/NAS
    if one exists; (3) a trial credit (e.g. GCP $300/90d) only if owner relents. Asked the
    owner to pick; **session paused before they answered — resume here.**

## Where we are (handoff — updated 2026-10-11)
The app-side work has been **done and verified since 2026-10-06**: an interrupted move
self-resumes on process start (`resumeInterruptedMoves()` in `lib/graph/move.ts`, wired via
`instrumentation.ts`), so any host that stays up finishes a move with no clicks. **Nothing
in the app is blocking** — this has been purely a *where-does-it-run* question.

That question is now settled negatively for the cloud: after three rounds of research
(see `wiki.md`), **there is no genuinely-free-forever cloud box** that works for a
Microsoft-upload mover in 2026 — Oracle is an unresolvable dead end, GCP always-free has
1 GB egress, and Chinese/Russian options are trial-credit and/or hostile to Microsoft
traffic. The owner does not want a trial-credit/paid host.

**Resume point:** decide between the three **$0 owned-hardware paths** in the status note
above. The strong default is **#1 — run the move on the owner's own laptop overnight**
(lid closed, plugged in, Amphetamine/`caffeinate` to prevent sleep). No new host, no code
change: just launch the app locally, start the move, keep the Mac awake, let it finish.
The Oracle/DigitalOcean guides remain as reference — their commands apply to any Linux box
(e.g. a Raspberry Pi or old laptop) if path #2 is chosen later. The owner was asked to pick
and **paused the session before answering.**
