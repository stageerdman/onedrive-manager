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

## Re-confirming the host (2026-10-07) — Oracle stands
When Oracle registration got stuck, we re-evaluated the field against the same conditions
(free forever + always-on + persistent disk + fat egress for ~128 GB per 64 GB move):
- **Owned home hardware + Cloudflare Tunnel / Tailscale** — truly $0 and unmetered egress,
  the best fit on paper, but the owner has **no spare machine** to dedicate. Out.
- **Fly.io** — simplest cloud operation, always-on + volume, but pay-as-you-go and egress
  ~$0.02/GB ≈ $2.50/move. Viable cheap fallback, not $0.
- **Google Cloud e2-micro always-free** — free VM + disk, but only 1 GB/mo free egress then
  ~$0.12/GB ≈ $15/move. Rejected on egress cost.
- **AWS / Azure free tiers** — 12-month trials, fail "free forever". Rejected.
**Decision:** no host switch. Oracle Always Free remains the only option meeting all four
conditions at $0. The registration block is being handled via **Oracle customer support**;
we wait for them rather than downgrade the host. Fly.io is the fallback only if Oracle never
unblocks.

## Free-only re-search, round 1 (2026-10-09) — no free-FOREVER plan B besides Oracle
Owner reaffirmed **free-only** and asked for deeper research. Correction to the egress figure
above: a move charges **~64 GB egress per 64 GB move, not 128 GB** — the download from the
source account is *ingress* (free on every provider); only the upload to the target is metered.
Every free cloud path was tested against the real workload (route ~64 GB egress through a
long-running process + keep a SQLite file). All fail except Oracle:
- **GitHub Actions** — free minutes (2000/mo private, unlimited public) + unmetered runner
  internet egress, so it *looks* perfect. **Ruled out on ToS/account risk:** GitHub's
  Acceptable Use Policy forbids using Actions "solely to interact with third-party websites,"
  "general computing," long-running network processes, and "bypassing platform limits to get
  free compute," and they actively detect+ban that exact pattern. Streaming 64 GB to OneDrive
  for hours is the textbook abuse signature — it would risk the account hosting this repo.
- **Google Cloud Run jobs** — tasks run up to 7 days (fine), but same GCP egress meter: 1 GB/mo
  free then $0.12/GB. Not free for a mover.
- **GCP e2-micro** — re-confirmed: free VM, but 1 GB/mo egress → ~$7.60 per 64 GB move (was
  mis-stated as $15 on the old 128 GB figure). Still fails free-only.
- **Render/Railway/Koyeb free** — sleep when idle + ephemeral disk. Fail.
- **Fly.io free tier** — dead for new orgs in 2026. Not free.
- **Home always-on device + Cloudflare Tunnel** (old phone/Pi/NAS/secondary PC) — the *other*
  genuinely-$0 path (unmetered home egress, no cloud signup). Asked the owner 2026-10-09:
  **no device available.** Out.
**Round-1 conclusion (later superseded — see round 2):** among free-*forever* hosts, Oracle is
the only one that fits. Oracle anti-fraud signup fixes still stand and are worth trying: sign up
over **phone mobile hotspot** (home/CGNAT IPs are blocklisted — the #1 cause), incognito,
**no VPN**; **real Visa/MC credit card** (prepaid/virtual auto-rejected); **address exactly
matching card billing**.

## Free-only re-search, round 2 (2026-10-09) — the reframe + the actual answer
Owner pushed again ("there are solutions — Russian/European clouds, something new, a workaround").
The unlock was dropping the **free-forever** assumption: this app's job (rebalance 3 OneDrives)
is **occasional, not a 24/7 service**. The real bar is "moves finish at **$0 out of pocket** on
a box that stays up while the laptop's off" — not "a host that lives free for years." That bar
is easily cleared.

**ANSWER — trial credit on a real VPS (genuinely $0 for a bounded rebalance):**
- **DigitalOcean $200 credit / 60 days** is the pick. Droplets include **500 GiB/mo outbound
  free**, inbound free, overage only **$0.01/GiB** — so even a 2 TB total rebalance ≈ $20, far
  inside the credit. A $6/mo **1 GB-RAM** droplet (comfortable for `next start`, unlike the
  512 MB free tiers) is fully covered. **Real Linux VM → zero code changes; the
  oracle-cloud-deploy.md steps (systemd + Caddy + clone/build) apply verbatim, only
  `AZURE_REDIRECT_URI` differs.** Signup is painless (no Oracle-style rejection). Run the moves
  with the laptop closed, then **destroy the droplet → $0 paid**.
- Same-bucket backups for future rounds: **Vultr $250–300**, **GCP $300 / 90 days** (confirmed
  it does NOT auto-charge at trial end), **Alibaba up to $1,300**. Effectively years of free
  rebalancing across providers.

**Perpetual-ish free, if a never-expiring box is wanted:**
- **Vultr Free Tier Program** — real VM free for **1 year**: 1 vCPU / **512 MB RAM** / 10 GB SSD,
  **2 TB/mo outbound free**, Frankfurt DC. Caveats: 512 MB is tight for a full Next.js server
  (may OOM — might need to run only the move engine), and admission is gated (business email +
  random approval). Good bandwidth, real friction.
- **Oracle** remains the only free-forever Western VM with fat egress — the hotspot retry above.

**Russian clouds (owner asked) — surveyed, not recommended here:**
- **Cloud.ru Evolution** has a genuine always-free VM (1 vCPU / 1 GB / 30 GB + ~4,000 bonus ₽),
  but it would route the owner's **personal Microsoft OAuth tokens + all traffic through a
  Russian host** — exactly the path most likely to be throttled/geo-restricted, plus EU
  signup/payment friction and a Russian-only console. Worst fit for a Microsoft-targeting mover.
- **Yandex Cloud** free tier is serverless-only (no always-free VM); **VK Cloud / Selectel /
  Timeweb** are pay-as-you-go with no real always-free VM. Russian clouds add no better option.

**European clouds:** no true always-free VM (Scaleway/Netcup/Infomaniak all paid; Hetzner
~€4.35/mo flat w/ 20 TB egress is the best *paid* box but owner declined paid). **Cloudflare
Containers** = free egress ethos but paid-only ($5/mo Workers Paid) + not a persistent VM. Out.

**Round-2 conclusion:** recommend **DigitalOcean trial-credit droplet** for the (bounded)
rebalance — $0 out of pocket, real VM, reliable signup, deploy guide applies as-is. Keep Oracle
hotspot-retry / Vultr 1-yr free tier as the fallback only if the app must truly run 24/7 forever.

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
