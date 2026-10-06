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
- **One Azure app registration** (multi-tenant + personal, `AZURE_TENANT_ID=common`)
  connects all accounts; each account goes through OAuth consent separately.
- **Least privilege, staged:** v1 is read-only (`Files.Read.All`). We only request
  `Files.ReadWrite.All` when we actually build move (Phase 6), then re-consent. Don't ask
  for write access the app isn't using yet.

## Security
- Refresh tokens are **encrypted at rest** with `TOKEN_ENCRYPTION_KEY` (AES-256). The
  app's own session cookie is signed with `AUTH_SECRET`. `.env` is never committed.
- Repo is **private** — it's a personal tool wired to the owner's own storage.

## Open decisions (also tracked in issues.txt)
- **Persistence store.** Leaning local **SQLite** (`better-sqlite3`) for a personal,
  single-user app: refresh tokens, user-authored usernames/descriptions, and scan caches.
  Revisit if deployed to Vercel (→ a Marketplace store).
- **App's own gate.** Whether the app needs a login of its own or just runs locally behind
  the OS login. Pending UX input.
