# OneDrive Manager — Connective Tissue Design Spec
*Auth, Information Architecture, Onboarding, Persistence, Global Shell*

> UX expert spec #3 of 3, authored during INIT (2026-10-06). Preserved verbatim;
> synthesized into `update v1.md`.

## 0. Core Stance (the ruthless cuts)
1. **The app has NO login of its own.** Personal, local, single-user. A second password wall protects nothing the OS doesn't. Security comes from *where it runs*. (§4)
2. **"The app" and "a OneDrive account" are two different nouns and must never blur.** The app is the dashboard; a OneDrive account is a *connected data source* you add to it (like a card in a wallet). Onboarding teaches this once.
3. **Everything persists in one local SQLite file + OS keychain.** No cloud, no user table, no sync. One file to back up, one file to delete to reset.

## 1. Authentication Experience

### 1.1 Mental model
> The app is a container. You *connect* up to three OneDrive accounts into it. Connecting = granting Microsoft Graph consent. That's the only auth that exists.

No "sign up," no app account. Use **"Connect"** (never "Sign in") for every OneDrive action. "Sign in" only appears on Microsoft's hosted consent page — reinforcing the boundary.

### 1.2 Azure app registration reality (state honestly in-product)
- App set to **"Accounts in any org directory and personal Microsoft accounts" (`common`)**, or `consumers` if strictly personal. **Recommend `common`.**
- Scopes: `User.Read`, `Files.Read.All`, `offline_access`. **Read-only by design** — never deletes. (State in onboarding: "This app can only read. It can never change or delete your files.")
- **Authorization Code flow with PKCE.** Redirect URI `http://localhost:<port>/auth/callback`.
- Honest caveat: a self-registered app shows Microsoft's "unverified publisher" notice. Pre-warn: *"You registered this app yourself — Microsoft will show an 'unverified' notice. That's expected; it's your app."*

### 1.3 Adding accounts — the flow (identical for account 1/2/3)
```
[Add OneDrive] → browser opens Microsoft consent (hosted) → user signs into THAT
OneDrive, approves read consent → redirect to localhost callback → app exchanges
code, stores refresh token, fetches profile → "Name this account" → account's Explorer
```
- **Account disambiguation:** always append `prompt=select_account` so Microsoft forces the chooser every time; after callback, check the returned account `id`/UPN against connected accounts and **block duplicates**: *"This OneDrive is already connected as '[label]'."*
- **"Name this account"** (once, right after first connect): **Label** (required, defaults to display name/email, editable) + **Description** (optional one-liner). Both editable later (§3). Two fields only.

### 1.4 Slot model
Exactly **three slots**, not an unbounded list. "Add OneDrive" disables when full; no pagination/search/management. A 4th later is a one-line config bump, not a design problem now.

### 1.5 Token lifecycle & re-consent
- **Refresh tokens** (from `offline_access`) are the durable credential; access tokens are short-lived, refreshed silently before each scan.
- **Expiry/revocation** (≈90 days idle, password change, revoked consent): the account enters **"Reconnect needed"** — not removed, last cached scan stays visible ("as of [date]"). Re-consent = one **"Reconnect"** button running the same flow with `login_hint` = stored UPN (skips chooser).
- **Never dump the user to a dead end** — stale data + inline Reconnect, never a blank error.

### 1.6 Disconnect
Account settings → **Disconnect** → confirm → delete that account's refresh token from keychain + its cached scans; free the slot. Surface: *"Also revoke access at [Microsoft account permissions page]"* (local delete ≠ revoking Microsoft's grant).

## 2. Information Architecture — five surfaces
```
┌─ APP SHELL (persistent top bar: account switcher + nav) ─┐
│ 1. OVERVIEW   → multi-account dashboard (home)           │
│ 2. EXPLORER   → single-account analysis (scoped by switcher) │
│ 3. ADD ONEDRIVE → modal/sheet over current surface       │
│ 4. SETTINGS   → Accounts | Scan behavior | About         │
│ 5. EMPTY/FIRST-RUN → zero-accounts state of Overview     │
└──────────────────────────────────────────────────────────┘
```
No profile/billing/team/notifications. Add-account is a **modal, not a route**.

- **Overview = compare** (home/default); **Explorer = dig** (one level down, scoped to active account). The **global account switcher** is the hinge.

### Routing
```
/                → Overview (or Empty if 0 accounts)
/account/:id     → Explorer for that account
/settings        → Settings (hash sections)
?add=onedrive    → Add-account modal (overlay on any route)
```
Account identity lives in the URL (correct back/refresh behavior).

## 3. Saved usernames + custom descriptions
Property **of an account slot**, two homes: **Settings → Accounts** (canonical editor) and **inline on Overview cards + Explorer header** (label = primary title everywhere, description = subtitle/tooltip; pencil on Explorer header opens the same inline editor).
- **Label:** click-to-edit, saves on blur/enter, required, unique across the three.
- **Description:** click-to-edit textarea, optional, ~140-char soft cap.
- First values collected at connect time (§1.3).
- **Persistence:** two columns on the `accounts` row in SQLite (`label`, `description`). No separate store/versioning/sync.

## 4. Token & data persistence (the honest answer)
| Data | Sensitivity | Store |
|---|---|---|
| OAuth **refresh tokens** (1/account) | **High — the keys** | **OS keychain** (macOS Keychain / Win Credential Manager / libsecret), one entry per account |
| Access tokens | Ephemeral | **In memory only** |
| Account metadata (id, UPN, label, description, status) | Low | **Local SQLite** |
| Scan caches (tree, sizes, ages, stale/large results) | Low | **Local SQLite** |

- **Refresh tokens → OS keychain**, not DB/`.env`/plaintext. On platforms without a keychain, fall back to an **encrypted token file** with a user-supplied key.
- **Everything else → one SQLite file** (e.g. `~/.onedrive-manager/app.db`); show its path in Settings → About.
- **Scan cache is explicitly a cache** — every scan timestamped ("as of [time]" + Rescan); "Clear cached scans" loses nothing.
- **No app-level DB encryption** (it holds no secrets — tokens are in the keychain). Rely on OS disk encryption (FileVault/BitLocker) and *say so*.
- **No app login** (restated): a locally-run personal app guarded by its own password gains nothing. Default: **bind to `127.0.0.1` only.**

## 5. Global navigation / shell
One persistent top bar, no sidebar:
```
[◆ OneDrive Manager]   [Overview]  ┆  [▾ Account switcher]   [⚙]
   wordmark→home          nav          context selector     settings
```
- **Account switcher (key control):** dropdown of the three slots — status dot (●green connected / ●amber reconnect-needed / ○empty), label, free-space micro-stat. Select → that Explorer. "All accounts" → Overview. "+ Add OneDrive" at the bottom while a slot is free. Status dots make "reconnect needed" visible from anywhere.

## 6. Cross-app states
- **Zero accounts / first-run:** centered panel — "Connect your first OneDrive", read-only reassurance, **[Connect OneDrive]**, three honest notes (Microsoft's own page · "unverified" is expected · up to three accounts). Faint three-slot scaffold behind. No wizard.
- **Scan in progress:** never a blocking spinner; partial results stream ("Scanning… 12,400 items / 3.2 GB"), previous cache dimmed underneath; per-account mini progress on Overview; skeletons only for the first-ever scan.
- **Reconnect needed:** amber dot everywhere + inline banner "Access to '[label]' expired. [Reconnect]"; stale data stays usable.
- **Offline / Microsoft unreachable:** global non-modal banner "You're offline — showing cached scans. Last updated [time]."; Rescan disabled; app degrades to a read-only snapshot browser.
- **Scan error (partial):** finish what succeeded, dismissible note "Some folders couldn't be read (rate-limited). [Retry]."
- **Empty-but-connected:** friendly "This OneDrive is nearly empty — [X] of [Y]." (not an error).

## 7. State matrix
| Status | Dot | Switcher | Overview card | Explorer | Primary action |
|---|---|---|---|---|---|
| Empty slot | ○ grey | "+ Add OneDrive" | Dashed placeholder | n/a | Connect |
| Connected, no scan | ● green | normal | "Not scanned yet" | Skeleton + prompt | Scan now |
| Connected, scanning | ● green+spin | progress | mini progress | streaming/partial | Cancel |
| Connected, scanned | ● green | free-space stat | full data | full data | Rescan |
| Reconnect needed | ● amber | "Reconnect" | stale + banner | stale + banner | Reconnect |
| Offline | unchanged | dimmed | cached + banner | cached + banner | (Rescan disabled) |

## 8. Scope cuts (non-goals)
App login/user accounts · password reset/MFA · >3 accounts as a feature · any write/delete/move (read-only scopes) · multi-user/sharing · notifications center · DB encryption + master password · cloud sync of settings · onboarding carousel · a separate profile/connections page (folded into Settings → Accounts).

## 9. Build roadmap fold-in (sequence)
1. SQLite schema (`accounts`) + keychain token adapter + `127.0.0.1` binding.
2. OAuth PKCE connect flow w/ `prompt=select_account`, duplicate guard, "Name this account."
3. App shell + account switcher + routing + empty/first-run state.
4. Silent refresh + reconnect-needed state (`login_hint` reconnect).
5. Settings → Accounts (label/description editors, disconnect, data-location/reset).
6. Cross-app loading/offline/error states as shared components.

> **One-line summary:** No app login; three OneDrive slots connected via Microsoft PKCE consent (read-only, `common` tenant); five surfaces hung off a single top-bar account switcher; refresh tokens in the OS keychain, everything else in one local SQLite file; the account switcher is the hinge between Overview and Explorer; every account carries a user-authored label + description edited inline.
