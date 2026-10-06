<!--
  This CLAUDE.md is compiled from the AI Control global modules
  (~/.ai-control/modules: CODING, WORKFLOW, STRUCTURE, UX) — the "Working
  agreement" section below — followed by OneDrive Manager's own project
  knowledge, preserved under "Project knowledge". See .project for the marker.
-->

# Working agreement (AI Control)

Compiled from the global modules this project uses (`coding`, `workflow`, `structure`, `ux`).
These are the standing rules for how work is done here; the project-specific knowledge follows.

## Structure
- Carry the standard scaffold: `.project`, `CLAUDE.md`, `.gitignore` (always covers `.env`),
  `.env` (never committed), `updates/`, `issues.txt`.
- Each update is a folder `updates/YYYY-MM-DD NAME - OPEN|CLOSED/` holding `update vX.md`
  (goal + phased roadmap + live status) and `wiki.md` (durable decisions/lessons). Reopen by
  flipping `CLOSED`→`OPEN`.
- Follow the ecosystem's own norms (here: Next.js App Router — `app/`, `components/`, `lib/`).
  Keep it flat and simple; add folders only when the project genuinely grows into them.

## Coding
- Modular by default: every piece understandable and fixable in isolation, with small explicit
  interfaces and low cross-module coupling — a bug should have one obvious home.
- Keep it minimal: build only what's truly needed; no speculative abstraction. Prefer reuse
  over duplication, but don't over-generalize before a second real caller.
- Test what matters (core logic, risky paths, silent-regression risks); skip trivial glue.
- Idiomatic to the ecosystem — read the neighbours first; new code should look like it belongs.

## Workflow
- Commit after every working change — small, focused, one logical unit; honest messages; never
  commit secrets. Everything lives on GitHub and is pushed regularly.
- Non-trivial work starts with a phased roadmap recorded in the update's `update vX.md`; most
  phases end with tests. Keep status current as you go.
- New API / unfamiliar library / genuinely new design → a throwaway research spike run *outside*
  the main code, inside the update folder; capture findings in the update's `wiki.md`.
  (The Microsoft Graph OAuth + drive-scan work is exactly this kind of spike territory.)
- Act as an orchestrator: delegate to focused agents and synthesize.
- Verify by running the actual thing, not just a green test. Confirm the phase does what it set
  out to do before committing and moving on.

## UX
- Any user-facing surface: bring in a dedicated UX-expert agent (several in parallel for a
  multi-part surface) to think it through. This app's experience was designed up front by three
  UX experts (overview dashboard, account explorer, auth/IA) — see the INIT update.
- Cut everything unnecessary — every element must earn its place. Minimal visual system: few
  fonts/colors/sizes on a deliberate scale.
- Build from standardized, reusable, isolated components with clear interfaces. Accessible and
  responsive by default; sensible defaults, fast feedback, honest error states over decoration.

---

# Project knowledge

# OneDrive Manager

A personal, single-user web app that connects the owner's **three personal OneDrive accounts**
via Microsoft Graph OAuth and turns them into one storage command centre. The core job: answer
**"where do I have free space, and what's eating it?"** in seconds — then let the owner drill
into any account to see folder structure with sizes, file/folder age, and the biggest or
longest-untouched items.

What it does:
- Connects up to 3 OneDrive accounts (Microsoft Graph, OAuth consent per account, refresh
  tokens stored encrypted at rest). The app itself is personal — not a public sign-up product.
- **Overview dashboard** — all accounts at once: saved username label, an editable custom
  description, and used / total / free space made instantly scannable.
- **Account explorer & analysis** — folder structure with per-folder size, size visualised so
  the biggest consumers stand out, and analysis views for biggest items and oldest /
  least-recently-touched items. ("Last used" is derived from Graph's `lastModifiedDateTime` /
  `createdDateTime` — true last-*accessed* time is not available for personal accounts.)
- **Cross-account move** *(planned — INIT Phase 6)* — move whole folders/files from one account
  to another to rebalance space. This is the point where scope upgrades from read-only
  `Files.Read.All` to `Files.ReadWrite.All`; Graph has no native cross-account move, so it's
  implemented as copy → verify → delete-source. v1 up to the explorer stays read-only.

Stack: **Next.js (App Router) + TypeScript + Tailwind + shadcn/ui**, Microsoft Graph via MSAL,
deployed on **Vercel**. Small user-authored data (usernames, descriptions) and scan caches
persist in a lightweight local/managed store — see the INIT update for the chosen approach.

## Layout (once scaffolded)
- `app/` — App Router routes (overview, account detail, auth callback, API routes).
- `components/` — reusable shadcn/ui-based components (account card, space meter, item row, …).
- `lib/` — Graph client, OAuth/token handling, scan logic, persistence.
- `updates/` — AI Control update history. The build roadmap lives in the INIT update.

## Secrets (see `.env`, never committed)
- `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID` — one Azure app registration used
  to connect all three accounts (`AZURE_TENANT_ID=common` for personal + work/school).
- `AZURE_REDIRECT_URI` — OAuth redirect (e.g. `http://localhost:3000/api/auth/callback`).
- `TOKEN_ENCRYPTION_KEY` — encrypts stored OAuth refresh tokens at rest.
- `AUTH_SECRET` — signs the app's own session/cookie.

## Status
Project created under AI Control on 2026-10-06. INIT scaffold + build roadmap in `updates/`.
Not yet implemented beyond scaffold. See `issues.txt` for open items.
