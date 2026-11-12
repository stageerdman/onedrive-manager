# REDESIGN — wiki

- **Bytes never touch disk.** Each file streams source → memory (~6 MiB chunk) → target, so
  "space on this Mac" is the in-memory buffer (download − upload of the current file). The
  "downloading" and "uploading" file are the same file; the UI shows one bar with two fills.
  Pipelining (download file N+1 while uploading N) would need disk staging — not done.
- **Second server process.** The Mac app runs `next start`; a dev server on the same DB must
  run with `ODM_TRANSFERS_WORKER=0` or it could start a second runner. The heartbeat
  (`moves.heartbeat_at`, 5 s, stale after 20 s) also makes the scheduler skip jobs another
  process is driving.
- **Re-walk recount.** Every (re)run of a folder transfer walks the tree from zero and counts
  skipped already-copied files, so progress used to drop to ~0% on each auto-retry. Now
  `files_done`/`bytes_done` are high-water marks.
- **DB migrations** live in `evolve()` in `lib/db.ts` and run on every module load, because dev
  hot-reload reuses the cached connection (so `createConnection()`'s `migrate()` wouldn't rerun).
- **Theme gotcha:** `--font-sans: var(--font-sans)` in `@theme inline` was self-referential →
  serif fallback. Also shadcn's base layer paints `body` with `bg-background`, which covers
  a negative-z fixed background; body is `bg-transparent`.
- **Access expiry** = `token_refreshed_at` + 90 days (Microsoft personal-account refresh tokens
  slide on use); falls back to `updated_at` for rows from before the column existed.
