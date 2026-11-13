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
- **Prod contexts don't share memory.** In `next start`, the instrumentation boot hook and
  route handlers didn't reliably share `globalThis` state: a UI pause never reached a
  boot-resumed runner. All control now goes through the DB: `app_settings.transfers_paused`,
  `moves.control = 'remove'`, preemption = "am I still `topRunnable()`?", live file progress
  = `moves.live_json` (flushed ~1 s). The runner checks at throttled checkpoints (750 ms).
- **Stray second server (2026-11-12).** An orphaned `next dev` (port 3011, started 17:04 by an
  earlier session, logging to `.devserver.log`) shared the DB and ran the old engine, so two
  runners uploaded the same file at once. That's the likely cause of the repeated 409 on
  "27-Bonus Q and A Examples.mp4". It was killed. Before blaming the engine, check
  `ps … | grep next-server`.
- **Throughput.** Each chunk is downloaded, then uploaded, strictly in turn (no overlap), so a
  large file runs at roughly 1/(1/down + 1/up). Overlapping the next chunk's download with the
  current upload is the obvious speed-up if needed.


## Upload-session 401 on one account (2026-11-13)
- Symptom: "27-Bonus Q and A Examples.mp4" (12.7 GB) never progressed. With the new log the
  first chunk PUT returns **401, empty body**, every time, on a fresh session.
- Spike (`spike-401/`): on the target **Soren Osha**, a fresh `createUploadSession` URL
  returns 401 even for a plain GET (session status). `WWW-Authenticate: ... fault="BadContextToken"`.
  Adding a Bearer token doesn't help. Simple PUT (`/content`) works. The same test on
  Stage Erdman → 200/201. URL shapes identical → account-side on Microsoft's end.
  Quota is fine (1 TB free, state normal).
- Lesson: the old chunk loop's `catch` swallowed non-retryable errors and retried them
  silently, so this was invisible. Errors now surface in `data/logs/app.log`.
- Also fixed: download streams had no timeout (one hung at 5.4 MB indefinitely while the
  heartbeat kept the move "alive"), and retries restarted big files from byte 0.
