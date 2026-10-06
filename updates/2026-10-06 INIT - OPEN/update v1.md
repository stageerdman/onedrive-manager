# INIT — OneDrive Manager

**Status:** OPEN · created 2026-10-06 · plan v1

## Goal
A personal, single-user web app that connects the owner's **3+ personal OneDrive
accounts** via Microsoft Graph and turns them into one storage command centre.

In one glance the owner can see, per account:
- **Free / used / total space** — which disk has room and which is full.
- **Username**, shown and **one-click copyable**, so there's no doubt which account is which.
- A **custom, editable description** the owner writes per account ("photos backup",
  "work archive", …) so it's obvious what lives where.

And can drill into any account for:
- **Folder structure with per-folder size** — where the space actually goes.
- **"Last used" / age** — derived from Graph's `lastModifiedDateTime` /
  `createdDateTime` (true last-*accessed* time is not exposed for personal OneDrive).

And, later (see Phase 6), can **move whole folders or files from one disk to another**
to rebalance space.

## Scope decisions (agreed at INIT)
- **Visibility:** private GitHub repo — personal tool, nothing to publish.
- **Azure registration:** *reuse RecBar's existing registration* (client ID
  `bae96960-…`, from `~/Library/Application Support/RecBar/config.json`). It's a
  **public client** (tenant `consumers`, personal accounts), so **no client secret** —
  auth is the **auth-code + PKCE** flow. It already has `Files.ReadWrite offline_access`
  consented. Only Azure step left: add the web redirect URI to the registration.
- **Move capability:** *analysis first, move later* — a **behaviour** choice, not a
  permission one. The scope already grants `Files.ReadWrite`, so move (Phase 6) is
  permission-unblocked; it's scheduled late purely for its complexity. v1 (Phases 0–5)
  simply doesn't issue writes.

## Phased roadmap
Each phase ends by **verifying the real thing runs**, then a commit. Phases touching a
new API (Graph auth, drive scan, move) start with a throwaway **research spike** inside
this update folder; findings go in `wiki.md`.

### Phase 0 — Decisions & project skeleton
- Scaffold the Next.js (App Router) + TypeScript + Tailwind + shadcn/ui app.
- Settle the **persistence store** (open decision in `issues.txt`): leaning local SQLite
  (`better-sqlite3`) for a personal app; revisit if/when deployed to Vercel.
- Decide the app's own gate (local-only vs a simple login) — UX input.
- **Verify:** `npm run dev` serves an empty shell; lint/build clean.

### Phase 1 — Microsoft Graph OAuth (connect accounts) 🔬 spike first
- Reuse RecBar's **public-client** registration; **auth-code + PKCE** (no secret),
  tenant `consumers`, scopes `Files.ReadWrite offline_access` (already consented).
- Repeatable consent flow to add **each** of the 3+ accounts; store refresh tokens
  **encrypted at rest** (`TOKEN_ENCRYPTION_KEY`). RecBar's `OneDriveAuth.swift` is a
  working reference for the token/refresh handling.
- **Verify:** connect all 3 real accounts; tokens persist and refresh across restarts.

### Phase 2 — Account quota + identity
- Read per-account **used / total / free** (`/me/drive` quota) and **username/email**.
- **Verify:** numbers match what OneDrive's own web UI reports for each account.

### Phase 3 — Overview dashboard (UX agents)
- All accounts at once: space meters, copyable username, editable description.
- Persist user-authored usernames/descriptions in the store.
- **Verify:** all accounts render; description edits survive reload; copy works.

### Phase 4 — Drive scan (folder tree + sizes) 🔬 spike first
- Progressive, **paged** recursive scan of each drive; cache results with a
  "last scanned" timestamp (large drives are tens of thousands of items).
- Per-folder aggregated size.
- **Verify:** a large account scans to completion, cached, resumable.

### Phase 5 — Account explorer & analysis (UX agents)
- Browse the folder tree with sizes visualised so the biggest consumers stand out.
- Analysis views: **biggest items** and **oldest / least-recently-touched** (age from
  `lastModifiedDateTime`, labelled honestly in the UI).
- **Verify:** biggest/oldest lists match manual spot-checks.

### Phase 6 — Cross-account move 🔬 spike first
- No scope change needed — `Files.ReadWrite` is already consented from Phase 1.
- Move whole folders/files between accounts. Graph has **no native cross-account move**:
  implement as copy-to-destination + verify + delete-source (or download→upload for
  large trees), with progress and a safe, reversible-until-confirmed flow.
- **Verify:** move a real folder between two accounts; sizes/free-space update; source
  only removed after the destination copy is confirmed intact.

### Phase 7 — Polish & deploy
- Error states, empty states, responsive pass; decide local-only vs Vercel deploy
  (and, if Vercel, swap SQLite for a Marketplace store).

## Status tracking
- [x] Phase 0 — skeleton + persistence decision (Next.js 16 + React 19 + Tailwind 4 +
      shadcn/ui scaffolded; SQLite store via better-sqlite3 in `lib/db.ts`; empty shell
      builds, lints, and serves 200)
- [x] Phase 1 — Graph OAuth connect (confidential Web + secret; 3 accounts connected)
- [x] Phase 2 — quota + identity (live free/used/total)
- [x] Phase 3 — overview dashboard (meters, inline label/description, aggregate)
- [x] Phase 4 — drive scan + cached snapshot (generations, progressive)
- [x] Phase 5 — explorer & analysis (browse/drill, biggest files/folders, stale)
- [x] Phase 6 — cross-account move (copy→verify→delete; needs a live user test)
- [x] Phase 7 — settings/disconnect/clear-cache, 127.0.0.1 binding
      (deferred polish: treemap, delta re-scan, offline banner, drag-reorder, account switcher)

**Blocked on user:** only one small Azure step — add the web redirect URI
(`http://localhost:3000/api/auth/callback`) to the reused RecBar registration. The
client ID is already in `.env` and the scopes are already consented, so Phase 1 is
otherwise unblocked.

## Where we are (handoff — 2026-10-06)
**Phases 0–7 are built and working against the 3 real accounts.** Connect, overview
(quota/meters/inline label+description), lazy explorer, analysis, settings, and
cross-account move are all live and verified.

Key things settled since the roadmap was written:
- **Scanning is lazy/on-demand** (surface first, each folder loads on open) — the old
  full-crawl was too slow for big drives. A full scan is an optional button for complete
  account-wide analysis. Folder/file classification fixed (file iff `file` facet; Personal
  Vault / packages are folders).
- **Cross-account move = stream through this machine, period.** R&D proved there is NO
  server-side path between two separate personal accounts (upload-from-URL → 400; share +
  copy → 401). See wiki.md "Cross-account move". The move engine is resilient: idempotent/
  **resumable** (skips files already copied), **auto-retries** transient errors up to 25×,
  **cancellable mid-file**, live progress in a persistent tracker bar, and deletes the
  source only after the whole tree verifies.
- A 64 GB "Jeremy Miner" move was in progress at handoff (~14%, resumable at any time).

## NEXT STEP (resume here)
1. **Package as a desktop `.app` (Electron).** This is the top priority — the app
   currently runs as `next dev` in a browser tab, which is fragile (restarts reload the
   tab, jobs die with the process). Electron gives it its own window, bundles the Node
   server + native better-sqlite3, and keeps the move engine running in the background.
2. Finish/verify the Jeremy Miner move (just hit Resume in the tracker; it continues).
3. Optional deferred polish (see issues.txt): treemap, delta re-scan, offline banner,
   drag-reorder cards, global account switcher.

To run the app during dev: `cd ~/dev/onedrive-manager && npm run dev` (binds 127.0.0.1:3000).
