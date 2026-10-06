# INIT wiki — decisions & lessons

Durable knowledge for OneDrive Manager. Status lives in `update v1.md`; this is what we
learned and decided, and why.

## Microsoft Graph realities
- **No true "last accessed" for personal OneDrive.** Graph exposes
  `lastModifiedDateTime` and `createdDateTime`, not a real last-*opened* time for personal
  accounts. "Staleness" / "last used" must be **derived from lastModified** and the UI
  must say so, so we don't imply data we don't have.
- **No native cross-account move.** Graph can move/copy *within* one drive, but there is
  no single API to move an item from account A's drive to account B's. Cross-account move
  has to be **copy-to-destination → verify → delete-source** (or download→upload for large
  trees). Treat it as a multi-step, resumable, confirm-before-delete operation. This is
  why move is its own late phase, not a quick add-on.
- **Scanning is slow and paged.** A real OneDrive is tens of thousands of items. The
  explorer must scan **progressively**, page through results, and **cache** with a
  "last scanned" timestamp rather than re-walking the tree on every view.

## Scope & permissions
- **Reuse RecBar's Azure registration** (client ID `bae96960-…`, found in
  `~/Library/Application Support/RecBar/config.json`) instead of creating a new one. Registered
  for **personal accounts only**, so `AZURE_TENANT_ID=consumers` (not `common`).
- **Confidential "Web" app + client secret (decided after two failed attempts).** We first
  tried the secret-less public-client auth-code+PKCE flow (RecBar itself is a public client via
  device code). Microsoft rejected the web-redirect code exchange with **AADSTS70002: "must
  include a 'client_secret'"** — a "Web"-platform redirect is always treated as confidential,
  and the secret-less path requires the "Mobile and desktop" platform, which proved unreliable
  for a personal-account localhost redirect with a path. Resolution: register the redirect under
  **Web**, create a **client secret**, and send it (plus PKCE) on token exchange + refresh.
  Verified working: all 3 accounts connected, encrypted refresh tokens stored. RecBar's
  `OneDriveAuth.swift` (device-code) remains a reference only for token/refresh shape.
- **Owning account:** the Azure app registration is owned by the personal Microsoft
  account **`s.microsoft@erdman.xyz`** — log in there at entra.microsoft.com to manage it.
  The web redirect URI `http://localhost:3000/api/auth/callback` has been added.
- **Scope is already `Files.ReadWrite offline_access`** on that registration. So the move
  feature is *permission*-unblocked from the start; keeping v1 read-only is a behaviour
  decision (don't issue writes yet), not a scope limitation. Only the web redirect URI still
  needs adding to the registration.

## Security
- Refresh tokens are **encrypted at rest** with `TOKEN_ENCRYPTION_KEY` (AES-256). The
  app's own session cookie is signed with `AUTH_SECRET`. `.env` is never committed.
- Repo is **private** — it's a personal tool wired to the owner's own storage.

## Cross-account move: no server-to-server for personal accounts (verified)
- Microsoft Graph has **no supported way to copy/move between two separate personal
  Microsoft accounts** server-side. The `copy` action needs both drives under one token;
  **upload-from-URL** (`@microsoft.graph.sourceUrl`) is **rejected for consumer OneDrive**:
  tested 2026-10-06 → `400 invalidRequest: "The sourceUrl provided is not supported"`.
  Re-tested with a `createLink` anonymous sharing link (1drv.ms webUrl) and with
  `?download=1` — both also 400. The feature is not enabled for these accounts in any
  URL form; don't re-attempt.
- **Share-then-copy: TESTED, does not work (2026-10-06).** A invites B (read) → 200; B can
  directly read the item in A's drive (`GET /drives/{Adrive}/items/{id}` → 200). But the
  copy into B's drive (`POST /drives/{Adrive}/items/{id}/copy` with parentReference=B's
  drive) returns **`401 unauthenticated`** — the copy engine can't cross the two accounts'
  security boundary. So cross-account *read* via sharing works, but *copy* does not.
- **Final verdict:** there is NO server-side copy/move between two separate personal
  Microsoft accounts. Streaming the bytes through the app host (Method 1, resumable upload
  session) is the only option. Don't revisit unless the accounts move into one org tenant.
- Therefore a cross-account move **must stream bytes through this machine** (download from
  source → upload to target). It's bandwidth-bound; large folders take real time. The
  engine detects upload-from-URL is unsupported once per move and then streams directly,
  with within-file progress, auto-retry/resume, and verify-before-delete.
- Implication for a future "no computer needed" version: would require both accounts in one
  org tenant (not the case here) or a cloud worker doing the streaming instead of the laptop.

## Open decisions (also tracked in issues.txt)
- **Persistence store.** Leaning local **SQLite** (`better-sqlite3`) for a personal,
  single-user app: refresh tokens, user-authored usernames/descriptions, and scan caches.
  Revisit if deployed to Vercel (→ a Marketplace store).
- **App's own gate.** Whether the app needs a login of its own or just runs locally behind
  the OS login. Pending UX input.
