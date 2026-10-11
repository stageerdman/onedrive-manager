# Deploy OneDrive Manager to DigitalOcean (trial credit — $0 out of pocket)

Goal: the app runs 24/7 on a real Linux VM (a "Droplet") so a move finishes with your
laptop closed. End state: `https://<HOST>` serves the app over HTTPS; a `systemd` service
keeps it up; the auto-resume hook continues any move after a reboot. When the rebalance is
done, **destroy the Droplet** → nothing is charged (it comes out of the $200 trial credit).

Why DigitalOcean over Oracle: Oracle signup stayed blocked. A OneDrive rebalance is an
*occasional* job, not a 24/7 service, so the real bar is "$0 out of pocket for a bounded
job" — which the **$200 / 60-day credit** clears easily. A $6/mo Droplet (1 GB RAM, fine
for `next start`) runs for weeks inside the credit; outbound transfer is 500 GiB/mo free,
and even a multi-TB total rebalance stays well inside it (overage is $0.01/GiB). Signup is
painless (no Oracle-style anti-fraud rejection), and it's a plain x86 Linux VM so native
deps (`better-sqlite3`) build with zero fuss. See `wiki.md` "round 2" for the full survey.

Placeholders to substitute as you go: `<VM_IP>`, `<HOST>` (your DuckDNS hostname),
`<SSH_KEY>` (path to your private key, e.g. `~/.ssh/id_ed25519`).

---

## 0. What you need
- A DigitalOcean account. Signup requires a **real credit card** (for identity) and gives
  **$200 credit valid 60 days**; nothing is charged unless you exceed it or keep resources
  past 60 days. Sign up at <https://www.digitalocean.com>.
- A free hostname so HTTPS can be issued (Let's Encrypt won't certify a raw IP). We use
  **DuckDNS** below — any domain you control works too.
- An SSH key on your Mac. Check with `ls ~/.ssh/id_ed25519.pub`; if missing, create one:
  `ssh-keygen -t ed25519`.
- ~20 minutes.

---

## 1. Create the Droplet
1. DO console → **Create → Droplets**.
2. **Region:** pick one near you (EU: Frankfurt or Amsterdam) — lower latency to Microsoft
   Graph and to you.
3. **Image:** Ubuntu **24.04 (LTS) x64**.
4. **Size:** *Basic* → *Regular (SSD)* → **$6/mo** (1 GB RAM / 1 vCPU / 25 GB). That's the
   comfortable floor for a Next.js server; the 512 MB option can OOM during `npm run build`.
5. **Authentication:** **SSH key** → *Add SSH Key* → paste `~/.ssh/id_ed25519.pub`.
   (Password auth also works but SSH key is cleaner and matches the commands below.)
6. **Hostname:** `onedrive-manager` (cosmetic).
7. **Create Droplet.** When it's up, note the **public IPv4** = `<VM_IP>`.

### Firewall
Unlike Oracle, a bare DO Droplet accepts **all inbound by default** — nothing to open to get
started. Two optional hardening notes:
- The Ubuntu image's `ufw` is **inactive** by default, so ports 80/443 are already reachable.
  If you later enable `ufw`, allow them: `sudo ufw allow 22,80,443/tcp`.
- If you attach a **DO Cloud Firewall** (console → Networking → Firewalls), add inbound TCP
  rules for **22, 80, 443**.

---

## 2. SSH in and install the toolchain
```bash
ssh -i <SSH_KEY> root@<VM_IP>      # DO's default Ubuntu user is root

# Node 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Build tools for better-sqlite3's native addon, plus git and Caddy
sudo apt-get install -y build-essential python3 git
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
```

---

## 3. Point a hostname at the Droplet (DuckDNS, free)
1. Go to <https://www.duckdns.org>, sign in, create a subdomain → `<HOST>` (e.g.
   `my-onedrive.duckdns.org`).
2. Set its IP to `<VM_IP>`.
3. Confirm it resolves: `ping <HOST>` from anywhere shows `<VM_IP>`.

> DO Droplet IPs are static for the life of the Droplet, so no DuckDNS updater cron is
> needed. (If you destroy and recreate the Droplet, update the DuckDNS IP to the new one.)

---

## 4. Get the code onto the box
The repo is **private** (`github.com/stageerdman/onedrive-manager`). Pick one:

**A. Clone with a GitHub token** (quickest):
```bash
mkdir -p /opt/onedrive-manager
git clone https://<GITHUB_TOKEN>@github.com/stageerdman/onedrive-manager.git /opt/onedrive-manager
```

**B. Copy from your Mac** (no GitHub needed) — run on the Mac:
```bash
rsync -av --exclude node_modules --exclude .next \
  ~/dev/onedrive-manager/ root@<VM_IP>:/opt/onedrive-manager/
```

---

## 5. Secrets + the one config change
Create `/opt/onedrive-manager/.env` on the box with the **same values as your local
`.env`**, except the redirect URI:

```dotenv
AZURE_CLIENT_ID=...            # same as local
AZURE_CLIENT_SECRET=...        # same as local
AZURE_TENANT_ID=consumers
AZURE_REDIRECT_URI=https://<HOST>/api/auth/callback   # <-- the only change
TOKEN_ENCRYPTION_KEY=...       # MUST match local if you copy the DB in step 9B
AUTH_SECRET=...                # same as local
```

Then register the new redirect URI in Azure:
**Entra admin center → App registrations → (the reused RecBar app) → Authentication →
Web → Redirect URIs → add** `https://<HOST>/api/auth/callback` → Save. (Leave the existing
`http://localhost:3000/...` one in place so local dev still works.)

---

## 6. Build
```bash
cd /opt/onedrive-manager
npm ci
npm run build
```
`next start` reads `.env` from this directory at runtime, so no extra env wiring is needed.

---

## 7. Run it as a service (auto-start + auto-restart)
Create `/etc/systemd/system/onedrive-manager.service`:
```ini
[Unit]
Description=OneDrive Manager
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/onedrive-manager
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now onedrive-manager
sudo systemctl status onedrive-manager        # should be active (running)
journalctl -u onedrive-manager -f             # live logs
```
`Restart=always` + the auto-resume-on-boot hook = a crashed or rebooted host brings the app
back **and** continues any in-flight move with no clicks.

---

## 8. HTTPS front door (Caddy)
`next start` listens only on `127.0.0.1:3000` (deliberate — never expose Next directly).
Caddy terminates HTTPS and proxies to it. Replace `/etc/caddy/Caddyfile` with:
```
<HOST> {
    reverse_proxy 127.0.0.1:3000
}
```
```bash
sudo systemctl restart caddy
```
Caddy fetches a Let's Encrypt cert for `<HOST>` automatically on first request. Visit
`https://<HOST>` — the app loads over HTTPS.

---

## 9. Bring your accounts over
The box starts with an empty database → no accounts connected yet. Choose:

**A. Re-connect fresh (clean):** open `https://<HOST>`, connect each of the 3 accounts via
the normal OAuth consent. Nothing carries over, including any in-progress move.

**B. Migrate the DB (keeps accounts + continues the current move):**
1. **Stop the Mac app first** (don't run two hosts against the same accounts/move).
2. Copy the DB to the box:
   ```bash
   rsync -av ~/dev/onedrive-manager/data/ root@<VM_IP>:/opt/onedrive-manager/data/
   ```
3. Ensure `TOKEN_ENCRYPTION_KEY` in the box's `.env` **matches** your local one (the stored
   refresh tokens are encrypted with it — a mismatch makes them undecryptable).
4. `sudo systemctl restart onedrive-manager`.

With **B**, the boot hook sees the Jeremy Miner move still `copying` and resumes it on the
box immediately — it'll keep going after you close the laptop.

---

## 10. Verify the whole point
1. On `https://<HOST>`, start (or confirm the resumed) move.
2. **Close your laptop.**
3. Reopen later → the tracker shows progress advanced. A move completes with your machine
   off. Done.

---

## 11. When the rebalance is done → stop paying $0
The whole point of the trial-credit path is that it's bounded. Once your moves are finished:
1. Confirm the target accounts look right (space rebalanced, no move still `copying`).
2. DO console → the Droplet → **Destroy**. This stops all billing against the credit.
3. (Optional) If you kept the DB only on the box, `rsync` `data/` back to the Mac first.

If you'll rebalance again later, a fresh Droplet + this guide takes ~20 min — or keep one
running; a $6/mo Droplet burns ~33 months of runtime out of the $200 credit before the
60-day clock is the binding limit either way.

### Handy
- Update after code changes: `cd /opt/onedrive-manager && git pull && npm ci && npm run build && sudo systemctl restart onedrive-manager`.
- Logs: `journalctl -u onedrive-manager -f`.
