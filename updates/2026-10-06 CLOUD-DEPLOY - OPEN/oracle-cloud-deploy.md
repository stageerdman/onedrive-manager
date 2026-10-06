# Deploy OneDrive Manager to Oracle Cloud (Always Free)

Goal: the app runs 24/7 on a free Linux VM so a move finishes with your laptop closed.
End state: `https://<your-host>` serves the app over HTTPS; a `systemd` service keeps it
up; the auto-resume hook continues any move after a reboot.

Placeholders to substitute as you go: `<VM_IP>`, `<HOST>` (your DuckDNS hostname),
`<SSH_KEY>`.

---

## 0. What you need
- An Oracle Cloud account (free; requires a card for identity check, **not charged** on
  Always Free resources).
- A free hostname so HTTPS can be issued (Let's Encrypt won't certify a raw IP). We use
  **DuckDNS** below — any domain you control works too.
- ~30 minutes.

---

## 1. Create the Always-Free VM
1. Oracle Cloud console → **Compute → Instances → Create instance**.
2. **Shape:** click *Change shape* → **Ampere (ARM)** → `VM.Standard.A1.Flex`. Set
   **1 OCPU / 6 GB RAM** (well within the Always-Free 4 OCPU / 24 GB allowance). ARM is
   fine — we install native deps from source.
3. **Image:** Canonical **Ubuntu 24.04** (or 22.04).
4. **SSH keys:** upload your public key (`~/.ssh/id_ed25519.pub`) or let it generate one.
5. Create. Note the **public IP** = `<VM_IP>`.

### Open the firewall (two layers — both required)
Oracle blocks inbound by default at the cloud layer *and* inside the Ubuntu image.

**Cloud layer (VCN security list):** Instance → its subnet → *Security List* → add
**Ingress** rules: source `0.0.0.0/0`, TCP, destination ports **80** and **443**.

**OS layer (the Ubuntu image ships locked-down iptables):** SSH in (next step) and run:
```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80  -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

---

## 2. SSH in and install the toolchain
```bash
ssh -i <SSH_KEY> ubuntu@<VM_IP>

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

## 3. Point a hostname at the VM (DuckDNS, free)
1. Go to <https://www.duckdns.org>, sign in, create a subdomain → `<HOST>` (e.g.
   `my-onedrive.duckdns.org`).
2. Set its IP to `<VM_IP>`.
3. Confirm it resolves: `ping <HOST>` from anywhere shows `<VM_IP>`.

---

## 4. Get the code onto the box
The repo is **private**. Pick one:

**A. Clone with a GitHub token** (quickest):
```bash
sudo mkdir -p /opt/onedrive-manager && sudo chown ubuntu:ubuntu /opt/onedrive-manager
git clone https://<GITHUB_TOKEN>@github.com/<you>/onedrive-manager.git /opt/onedrive-manager
```

**B. Copy from your Mac** (no GitHub needed) — run on the Mac:
```bash
rsync -av --exclude node_modules --exclude .next \
  ~/dev/onedrive-manager/ ubuntu@<VM_IP>:/opt/onedrive-manager/
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
TOKEN_ENCRYPTION_KEY=...       # MUST match local if you copy the DB in step 8B
AUTH_SECRET=...                # same as local
```

Then register the new redirect URI in Azure:
**Entra admin center → App registrations → (the reused RecBar app) → Authentication →
Web → Redirect URIs → add** `https://<HOST>/api/auth/callback` → Save. (Leave the
existing `http://localhost:3000/...` one in place so local dev still works.)

---

## 6. Build
```bash
cd /opt/onedrive-manager
npm ci
npm run build
```
`next start` reads `.env` from this directory at runtime (same as `npm start` locally), so
no extra env wiring is needed.

---

## 7. Run it as a service (auto-start + auto-restart)
Create `/etc/systemd/system/onedrive-manager.service`:
```ini
[Unit]
Description=OneDrive Manager
After=network.target

[Service]
Type=simple
User=ubuntu
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
`Restart=always` + the auto-resume-on-boot hook = a crashed or rebooted host brings the
app back **and** continues any in-flight move with no clicks.

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
   rsync -av ~/dev/onedrive-manager/data/ ubuntu@<VM_IP>:/opt/onedrive-manager/data/
   ```
3. Ensure `TOKEN_ENCRYPTION_KEY` in the box's `.env` **matches** your local one (the
   stored refresh tokens are encrypted with it — a mismatch makes them undecryptable).
4. `sudo systemctl restart onedrive-manager`.

With **B**, the boot hook sees the Jeremy Miner move still `copying` and resumes it on the
box immediately — it'll keep going after you close the laptop. 

---

## 10. Verify the whole point
1. On `https://<HOST>`, start (or confirm the resumed) move.
2. **Close your laptop.**
3. Reopen later → the tracker shows progress advanced. A move completes with your machine
   off. Done.

### Handy
- Update after code changes: `cd /opt/onedrive-manager && git pull && npm ci && npm run
  build && sudo systemctl restart onedrive-manager`.
- Logs: `journalctl -u onedrive-manager -f`.
- Keep DuckDNS fresh: add its 5-min updater cron if your VM IP ever changes (static on
  Oracle by default, so usually unnecessary).
