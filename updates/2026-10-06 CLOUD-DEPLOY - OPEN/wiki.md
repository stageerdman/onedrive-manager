# CLOUD-DEPLOY — durable decisions & lessons

## Why an always-on VM, not serverless
The move engine is a **long-running, in-memory, stateful** job (streams bytes through the
host for hours, tracks progress in an in-process `Set`, writes state to a local SQLite
file). Serverless (Vercel/Netlify) breaks all three: ~300 s execution cap kills long
moves, no in-memory job survives the response, and the filesystem is ephemeral so SQLite
can't persist. The fix is a small always-on box with a persistent disk that runs the
Next.js app unchanged. Proven R&D from the INIT update stands: there is **no server-side
cross-account path** between two separate personal accounts, so bytes must route through
the host — which is exactly why the host must stay up.

## Host choice: Oracle Cloud Always Free
Picked because it's the only option that is simultaneously (a) genuinely $0 with no time
limit, (b) always-on (doesn't sleep/spin-down like Render/Railway free tiers, which would
kill an in-flight move), and (c) a real Linux VM, so `better-sqlite3`, the local DB file,
and hour-long jobs work with zero code changes. Fly.io is the simpler-to-operate runner-up
but is pay-as-you-go (cents/month, not $0). Render/Railway free tiers were rejected: they
sleep when idle and have no persistent disk on the free plan (SQLite data lost on restart).

## Auto-resume on boot
A move row left in an active status (`copying`/`verifying`/`deleting`) with no live
in-memory runner means the process died mid-move. `rowToState` already *relabels* that as
`paused` for the UI, but nothing **relaunched** the runner — so before this change a host
restart meant a dead move until a manual Resume. `resumeInterruptedMoves()` (called from
`instrumentation.ts` `register()`, nodejs-runtime only) relaunches those on startup. This
is the piece that makes the host truly hands-off: the move survives crashes/reboots/
redeploys with no clicks.

- **Why skip `paused`:** a move only reaches the *stored* `paused` status after 25×
  auto-retry failed — a genuine problem (bad token, deleted source, quota). Auto-looping
  those on every boot would spin pointlessly; they still wait for a human.
- **No double-launch:** `resumeMove` early-returns when the id is already in `running`,
  and `register()` runs once per process, so a resume can't stack a second runner.
- **Lesson (dev):** adding/editing server files recompiles `next dev`, which restarts the
  process and therefore re-runs `register()` → relaunches the live move. Harmless here
  (the copy is idempotent; bytes only move forward) but it does interrupt and restart the
  in-flight move. On the always-on prod host this is a non-event — the process just stays
  up.

## Bandwidth reality
Every byte of a move routes *through* the box: down from the source account, up to the
target. A 64 GB move ≈ 128 GB of transfer. Oracle's Always-Free egress allowance (10
TB/month) swallows this easily for personal use, but it's the shape to remember if the
host ever changes.

## Operational shape (see oracle-cloud-deploy.md for commands)
- `next start` binds `127.0.0.1:3000` (already the npm `start` script) — do **not** expose
  Next directly. A **Caddy** reverse proxy in front gives automatic HTTPS (Let's Encrypt)
  and proxies to 127.0.0.1:3000. HTTPS is required anyway for the OAuth redirect.
- Run it as a `systemd` service so it auto-starts on boot and restarts on crash — which,
  combined with the auto-resume hook, is what closes the loop.
- `.env` lives on the box (never committed). `AZURE_REDIRECT_URI` must point at the box's
  HTTPS callback and be registered in the Azure app registration.
