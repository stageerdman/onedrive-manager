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
- [ ] Phase 1 — Graph OAuth connect (spike)
- [ ] Phase 2 — quota + identity
- [ ] Phase 3 — overview dashboard
- [ ] Phase 4 — drive scan (spike)
- [ ] Phase 5 — explorer & analysis
- [ ] Phase 6 — cross-account move (spike, scope upgrade)
- [ ] Phase 7 — polish & deploy

**Blocked on user:** only one small Azure step — add the web redirect URI
(`http://localhost:3000/api/auth/callback`) to the reused RecBar registration. The
client ID is already in `.env` and the scopes are already consented, so Phase 1 is
otherwise unblocked.

## Next step
Phase 0 is done. Next is **Phase 1 — Microsoft Graph OAuth**: a PKCE auth-code flow
(spike first) to connect each account and persist encrypted refresh tokens. The Azure
redirect URI is already added, so this is unblocked.
