# OneDrive Manager — Overview Dashboard Design Spec

> UX expert spec #1 of 3, authored during INIT (2026-10-06). The multi-account
> overview / landing dashboard. Preserved verbatim; synthesized into `update v1.md`.

## 1. The one job

Answer **"where do I have free space?"** in under 2 seconds. Everything else on this screen is secondary and must visually yield to that question. The unit of truth is **free space**, not used space — because the user's actual decision is "what can I put *where*."

Opinionated consequence: the biggest, boldest number on every card is **free GB**, not used GB. Most storage UIs lead with "used" — that's a billing mindset, not a planning mindset. We lead with headroom.

## 2. Layout & information hierarchy

**Single screen, no scroll on desktop.** Three accounts fit on one viewport. If it scrolls, we've failed.

```
┌─────────────────────────────────────────────────────────────┐
│  OneDrive Manager                              [+ Add drive]  │  ← App bar (56px)
├─────────────────────────────────────────────────────────────┤
│   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐     │
│   │  CARD A      │   │  CARD B      │   │  CARD C      │     │  ← 3-up grid
│   └──────────────┘   └──────────────┘   └──────────────┘     │
│   Total free across all drives: 847 GB                        │  ← Aggregate line (quiet)
└─────────────────────────────────────────────────────────────┘
```

**Hierarchy within the screen (top to bottom of attention):**
1. The three fullness meters — read as a *row* of bars the eye compares in one sweep.
2. The free-GB number on each card.
3. Account identity (custom description, then username).
4. Used/total detail.
5. Everything else (last-synced, actions).

**Grid:** 3 equal columns, generous gutter (24px). Each card ~320–380px wide. On tablet/narrow: stack to 1 column, cards keep full layout.

## 3. The account card

```
┌────────────────────────────────────────┐
│  ● Personal — Photos & backups      ✎   │  ← Custom description (primary identity)
│  jakub.cervenka@icloud.com              │  ← Saved username (secondary, muted)
│  ┌────────────────────────────────────┐ │
│  │████████████████░░░░░░░░░░░░░░░░░░░░│ │  ← Fullness meter (the hero)
│  └────────────────────────────────────┘ │
│   847 GB free                            │  ← Hero number (largest text on card)
│   153 GB of 1 TB used                    │  ← Supporting detail (muted)
│  ────────────────────────────────────── │
│  Synced 4m ago            Explore  →     │  ← Footer: status + entry to detail
└────────────────────────────────────────┘
```

### Identity block (top)
- **Custom description is the headline** — how the user actually thinks about the drive ("Photos & backups", "Work overflow"). Larger, high-contrast.
- **Username below it, muted** — the "which account is this really" confirmation. A small colored dot (the account's assigned accent) precedes the description for consistent identity color used anywhere the drive appears.
- No description set → soft placeholder *"Add a description"* (acts as the inline-edit affordance, §5).

### Fullness meter (the hero visual)
- Single horizontal bar, full card width, ~10px tall, rounded. Filled = used, empty = free.
- **Color encodes pressure, not identity:** green (&lt;70%) → amber (70–90%) → red (&gt;90%). Glance at the row of bars and the red one is where you *can't* put things.
- Keep the account accent dot separate from the meter color (identity = dot, pressure = bar).

### Numbers
- `847 GB free` — largest number on the card, weight 600.
- `153 GB of 1 TB used` — one muted line beneath.

### Footer
- Left: `Synced 4m ago` (muted, tiny) — doubles as a re-sync click target.
- Right: **`Explore →`** — handoff into the explorer (§6).

## 4. Making free space scannable (the core job)
1. **The bar row.** Three bars at the same scale/position → the eye compares fill instantly; color does the triage.
2. **Consistent "free" number position** on every card.
3. **Aggregate line** under the grid: *"Total free across all drives: 847 GB."*

**Deliberate cut:** no pie/donut charts, no per-folder breakdown, no sparklines on this screen — aligned bars beat angled slices. Breakdown belongs in the explorer.

**Ordering:** cards stay in a **fixed user-defined order** (drag to reorder, persisted), NOT auto-sorted by fullness. At n=3, spatial memory beats dynamic sorting.

## 5. Inline editing — description & username
- **Description:** click text (or ✎ on hover) → inline input in place, no modal, no layout shift. Enter/blur saves, Esc cancels. Optimistic save.
- **Username:** OAuth-derived, immutable and muted. The custom description IS the "saved name" in practice — one editable field per card, not two.

## 6. Navigation into account detail (handoff)
- Entry points: `Explore →` and clicking the card body (except the editable description/meter).
- Handoff contract: passes `accountId` + accent color + custom description so the explorer header renders the same identity with zero flicker.
- Clicked card's identity header persists as the explorer's header; Back returns with that card highlighted.

## 7. States: 0 / 1 / 2 / 3 accounts
- **0:** centered focal point, one line + **`Connect OneDrive`**, faint ghost of three card outlines. One job: start OAuth.
- **1–2:** real cards left-aligned; remaining slot(s) render as a dashed **"+ Add another drive"** ghost card of identical dimensions.
- **3:** grid full; `+ Add drive` drops to the app bar only. A 4th is allowed but demoted (wraps to a second row).
- **Reconnect needed:** card dims, meter greyed, `Reconnect` replaces the free number; identity stays visible.
- **Loading:** skeleton meter + numbers, identity shown immediately (cached).

## 8. Visual system
- **Type:** one typeface, two roles — `Inter` / system `ui-sans-serif`. Hero number 28/600, description 16/600, body 14/400, meta 13/400 muted. Tabular numerals on all storage figures.
- **Color:** neutral shadcn tokens (full light/dark via CSS vars) + pressure scale `green-500`/`amber-500`/`red-500` (the only meaningful saturated colors) + 3 calm account-accent hues (indigo/teal/rose) assigned by connection order (identity only).
- **Spacing:** 4px base `4/8/12/16/24/32`; card padding 24, gutter 24, stack 12.
- **Radius/elevation:** cards `rounded-xl`, 1px border + near-flat shadow; meter `rounded-full`.

## 9. Component list (Tailwind + shadcn/ui)
Reused: `Card`, `Button`, `Input`, `Skeleton`, `Tooltip`, `Badge`, `AlertDialog`, toast/`Sonner`.
Custom: **`<FullnessMeter />`** (build & test first), **`<AccountCard />`** (`active|loading|reconnect`), **`<GhostAddCard />`**, **`<InlineEditText />`**, **`<AggregateBar />`**, **`<ConnectEmptyState />`**.

## 10. Ruthless cuts
No charts/donuts · no per-folder breakdown here · no auto-sorting of cards · no separate nickname field · no account-management chrome on home (disconnect behind a per-card `⋯`) · no cross-drive search.

> The screen earns its keep if a user glances, sees one amber and two green bars, and knows "put the new backup on drive B" without reading a word.
