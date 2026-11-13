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

- **Update, same day:** the 401 was a *transient* Microsoft spell, not a dead account — the
  same session code started working ~15 min later. After a restart the source's download
  URLs also returned 401/503 a few times before succeeding: my.microsoftpersonalcontent.com
  is flaky in both directions. Not the known cause (an Authorization header on the
  uploadUrl PUT — we don't send one). So: a saved session that 401s is kept for a 30-min
  grace period instead of being discarded (losing GBs); download 401/503 → reconnect.
- Throughput: the old loop downloaded a chunk, then uploaded it (lockstep), and
  `Buffer.concat`'d the whole carry on every read (70% CPU). Now: one chunk in flight while
  the next downloads, parts joined once per chunk, 10 MiB chunks → 0.55 → 0.8 MB/s, CPU 2%.
  Download sits exactly one chunk ahead → upload-bound (~1 MB/s, owner's uplink / MS ingest).
- Tab switches waited 4–30 s on Graph `/me/drive` quota per account. `getDriveQuotaCached`
  serves the last value from the DB (refreshes in background after 60 s) → ~10 ms.

## Second 401 spell + alternatives spike (2026-11-13, ~03:05–03:45 UTC)
- 27-Bonus reached 2 GB (16%), then Soren Osha's upload sessions 401'd again
  (`BadContextToken`) for 40+ min. The 30-min grace expired → fresh session → 2 GB lost.
- `spike-401/alternatives.mts`: during the spell, on Soren Osha: Graph v1 + beta upload
  sessions → 401 (even a 640 KB one); **simple `PUT …/content` → 201**. Stage Erdman: all 201.
  So it is the target's upload-session service only, not the token/account/quota.
- `spike-401/legacy-api.mts`: legacy `api.onedrive.com` rejects our Graph token (401) —
  would need a separate auth flow; not worth it.
- Web: the documented cause (Authorization header on the uploadUrl PUT; rclone fixed this
  in 2024) doesn't apply — we never send it. Other reports are account-specific with no
  Microsoft answer. Nothing to fix on our side except resilience.
- Resilience ideas: (1) keep a session until it's actually gone (404/410) or past its
  `expirationDateTime`, not a fixed 30 min; (2) raise the simple-upload limit (Graph allows
  up to 250 MB) so small/medium files go via `/content`, which kept working; (3) when a big
  file's session is refused, defer it and keep moving the folder's other files.
- **Session lifetime — the reported expiry is NOT reliable.** Sessions report a 15-min sliding
  `expirationDateTime` (status GETs don't extend it). A tiny 640 KB test session on Stage
  Erdman did 401 after 20 min idle (`expiry-enforced.mts`) — but the real 12.7 GB 27-Bonus
  session on Soren Osha sat idle 53 min (owner's pause, 04:41→05:35) and resumed fine at
  2.56 GB. So: never give up a session on time alone. A dead session and a 401 spell look
  identical (both 401), so tell them apart with a live probe instead.
- **Shipped (code, 2026-11-13; live after the next Mac-app rebuild):**
  1. Saved session 401s → `targetAcceptsUploads()` opens a throwaway session in the target
     folder, sends one chunk of a declared 640 KB file (nothing gets created), deletes it
     (`probe.mts`: 202 / 204 / no leftover). Probe works → the saved session is dead →
     new session. Probe fails too → Microsoft spell → keep the session and wait.
     401 refusals (`TargetRefusing`) retry every 2 min without using the 25-attempt
     budget, for up to 12 h.
  2. Simple `PUT /content` for files ≤ 60 MB (tested 60 MB on Soren Osha: 201, 84 s).
  3. `lib/spool.ts`: downloaded bytes cached in `data/spool/<moveId>/` (fsync + committed
     length every 64 MiB, stops below 5 GB free) so a replaced session re-uploads from disk
     instead of re-downloading. Test: `npx tsx --tsconfig tsconfig.json --test lib/spool.test.ts`.
  Not done (owner's call): deferring a refused big file to move on with the rest; changing target.
- Seen 05:35–05:56 after the resume: the source's download URL ignored the Range header
  ("Source ignored the resume range") for ~20 min, then honoured it. Another Microsoft-side
  flake; the retry loop rode it out.

## Download 401s after resume — caused by the upload-from-URL attempt (2026-11-13)
- Symptom: after every app start / resume, "Source ignored the resume range (401)" for
  1–20 min (02:15, 05:35–05:56, 07:07–07:22), then fine on its own.
- Timeline (app.log): **each** of those spells began 2–4 s after `server-side-unavailable` —
  the once-per-run upload-from-URL try that hands the source's pre-authenticated download URL
  to the *target* account (`@microsoft.graph.sourceUrl`; always 400 on personal accounts).
  The 01:48 and 03:33 upload-session 401 spells also started right after one. 1 of 7 tries
  (02:27) was not followed by a spell; the 03:04 upload spell had no try before it.
- During a spell the probe (`download-401.mts`) works again only once it has passed; outside
  one, every variant works (302 Location / downloadUrl, with / without Range → 200/206).
  Sending a Bearer header to the pre-authed URL → 401 `BadContextToken` (we never do).
- Likely mechanism (unconfirmed): Microsoft treats the tempauth URL showing up at another
  account as a leaked link and briefly invalidates the context.
- Fix: removed the upload-from-URL attempt entirely (it never worked here and cost ~1 min per
  resume as well). Verified on the next restart: see below.
- **09:33 resume (after a 29-min pause) — same again, on the 07:15 build that still had the
  upload-from-URL try:** `server-side-unavailable` at 09:34:44, download 401s from 09:34:48,
  still going at 10:08. Probed at 09:53: the source's 401 (`BadContextToken`) is
  **account-wide** — every file on Stage Erdman, every URL variant, even from a fresh process
  with a freshly refreshed token. Graph metadata calls keep working. The target's saved
  session and a fresh probe session were both fine (200 / 202).
  Pause length isn't the trigger — the resume is (each resume = new run = one upload-from-URL try).
- Hardening (besides removing the try): a source 401 is now `SourceRefusing` — no 9× re-open
  churn, no "session lost", no attempt burned; it waits like `TargetRefusing` (2-min retries,
  ≤ 12 h). Simple-upload 401s map to Source/TargetRefusing too. The probe deletes a
  `.odm-upload-probe` placeholder when its session is refused or its create fails (a 504'd
  create left a 0-byte one; failed spike sessions left `__odm-*` ones — all cleaned up).

## Why does OneDrive keep refusing? — evidence so far (2026-11-13 ~10:15 UTC)
- Downtime today (log starts 01:46): 01:48–02:05 upload, 02:15 (1 min) download, 03:04–03:46
  upload, 05:35–05:56 download, 07:07–07:22 download, 09:34–10:15+ download → ~2¼ h of
  ~8½ h. 5 of 6 spells began seconds after a resume's upload-from-URL try (removed in cc34da0,
  live since the 10:09 build). The 03:04 one began mid-upload with no trigger.
- During the 09:34 spell, **everything on the storage host** (`my.microsoftpersonalcontent.com`)
  refuses our app for that account — tempauth URLs (any variant, tempauth as Bearer too),
  the host's `_api/v2.0|v2.1/.../content` with the Graph token, `download.aspx` — all 401
  `BadContextToken`. `graph.microsoft.com` metadata calls keep working. tempauth is `v1e.`
  (encrypted claims; readable: appid = our app, exp ≈ +1 h) → nothing to fix client-side.
- Not tried / open: whether the account's files download fine in onedrive.live.com during a
  spell (→ app-specific vs account-wide). Our Azure registration is new (2026-11-12) and
  unverified; no logs exist from the old RecBar registration to compare.
- Web: rclone's 2024 fixes (aee8d90 downloads, dedad9f uploads) = stop sending Authorization
  to pre-authed URLs; we never do. Microsoft is retiring tempauth URLs (SharePoint/OneDrive,
  from 2027-04-01) — consistent with the storage host's auth being in flux.
