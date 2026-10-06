# Single-Account Explorer & Analysis — UX Design Spec

> UX expert spec #2 of 3, authored during INIT (2026-10-06). The single-account
> explorer & analysis view. Preserved verbatim; synthesized into `update v1.md`.

## 0. Purpose & mental model
Answers three questions for ONE account, in priority order:
1. **"What's eating my space?"** (biggest consumers)
2. **"What's safe to delete?"** (old / untouched)
3. **"Where does it live?"** (structure & navigation)

Core insight: **people don't want to browse a file tree — they want the system to rank folders by size and let them drill into the fat ones.** Primary mode is *not* a classic expandable tree. It's a **ranked drill-down list** (largest-first), hierarchy expressed through breadcrumbs, not indentation.

## 1. Primary mode: Largest-first drill-down list
**Ranked list, one folder level at a time, sorted by size descending by default.**
- **Full expandable tree** — rejected as primary. Optimizes for "I know where I'm going"; this user is hunting.
- **Treemap** — good at "biggest jumps out" but hides age, struggles with deep hierarchies/slivers/metadata columns. Keep as a secondary toggle (§6).
- **Ranked drill-down list** — wins: each screen shows the current folder's direct children, biggest-first, each row carrying a size bar AND age/date columns; one click drills in; breadcrumbs track depth. Scales to tens of thousands via virtualization + pagination.

### Row anatomy (core component)
```
[icon] Name ───────────  ████████████░░░ 42.1 GB  31%  1,204 items  Modified 2y ago  Created 2019
```
- Icon: folder vs file-type glyph (muted, single color).
- Name: middle-truncate so extensions stay visible.
- Size bar + value (§2); **% of parent**; item count (folders only); age columns (§4).
- Folder rows have a right chevron, whole row drills. Files open a detail popover (no drill).

## 2. Size visualization
- Horizontal proportional bar inline, scaled to **the largest sibling in the current view** (top row ≈ full width — calibrates the eye).
- Numeric size right-aligned, human units, max 1 decimal.
- **% of parent** gives absolute grounding the relative bar can't.
- Single accent color for all bars (color is reserved for staleness, §4).
- Folder size = **recursive rollup** (all descendants), stated in a tooltip: "Includes everything inside."

## 3. Navigation
- **Breadcrumb bar** pinned top: `← All accounts / [Account] / Documents / Projects / 2023`, each crumb clickable; leading `← All accounts` hands back to the overview.
- **Drill-down:** click folder → children replace list, breadcrumb appends, scroll resets, bars rescale. Back/`Esc`/backspace go up.
- No side tree panel by default (competes with the ranked list). Optional collapsible tree rail is a v2 nicety.
- **Deep-link friendly:** each folder has a URL (`/account/:id/folder/:itemId`).

## 4. Age & "last used" — honest design
Graph exposes `createdDateTime` and `lastModifiedDateTime`; it does **not** expose true "last accessed/opened" for personal OneDrive. We must not pretend otherwise.

**Decision: "Last used" = `lastModifiedDateTime`, labeled "Modified"** (never "Last used"/"Last accessed"), with honest microcopy in the Analysis panel:
> *We can't see when a file was last opened — Microsoft doesn't provide that for personal accounts. "Stale" means not modified in a long time, which is the best available proxy.*

### Columns
| Column | Source | Notes |
|---|---|---|
| Name | `name` | middle-truncate |
| Type | `file.mimeType`/folder | friendly labels (Image, Video, Archive, Document…) |
| Size | recursive rollup / `size` | §2 |
| Created | `createdDateTime` | relative + absolute on hover |
| Modified | `lastModifiedDateTime` | relative + absolute on hover |
| Age | derived (now − created) | quiet secondary metric |

**Staleness as color:** the Modified cell gets a subtle dot/background on a 3-step scale — fresh (≤6mo, neutral), aging (6mo–2y, amber), stale (>2y, red-muted). Thresholds user-adjustable.

## 5. The Analysis panel ("surface the problems")
A **segmented control** reframes the same list component via different query/sort:
1. **Browse** (default) — current folder, biggest-first.
2. **Biggest files** — flat, account-wide files by size; each row shows a clickable folder-path crumb.
3. **Biggest folders** — flat list of all folders by recursive size.
4. **Stale** — account-wide, oldest `lastModifiedDateTime`, default filter `>2y`, secondary sort by size. Default sort = a combined **"Cleanup score" (size × age, normalized)** — the single most actionable ranking in the app.

### Sort / filter controls (persist per view)
- **Sort:** size, modified, created, name, item count (header click toggles asc/desc).
- **Filters (chips, combinable):** type, size threshold slider, modified-before, created-before.
- **Search:** name contains, scoped to current subtree.
- **Depth scope** for flat views: "this folder and below" vs "whole account."
- Clear-all chip; empty-state explains what got filtered out.

## 6. Secondary view: Treemap (earns its place, narrowly)
A **list/treemap toggle** (top-right). Renders the current subtree, area = recursive size, click-to-zoom = drill. **Tints rectangles by staleness** (reuses §4). Hover = same metadata popover; clicking returns to the list focused on that node. No columns/sort here — a glance tool.

## 7. Handoff to/from overview
- Entry: overview passes `accountId`.
- Exit: leading breadcrumb `← All accounts` + a persistent account switcher (jump directly between the three).
- Shared header strip: account identity, total used/quota, "last scanned" timestamp.

## 8. Scanning, loading & caching (honest performance)
- **Scan = recursive crawl** (Graph `children` with `$top` paging + delta where available), persisted to our store. The explorer **always reads from the cached snapshot, never live Graph** — this makes drilling instant. Live Graph only for the scan job + file-open actions.
- **"Last scanned: 3 hours ago"** always in the header, next to a **Re-scan** button. Non-negotiable honesty: the user knows it's a snapshot.
- **First scan (progressive, not a spinner):** stream results as they arrive; top folders appear in seconds with sizes ticking up; slim progress bar under the breadcrumb ("Scanning… 12,480 items, 38 GB so far"); folders still counting shimmer + "estimating…"; user can browse already-scanned branches; Analysis views banner "Based on partial scan — 62% complete"; cancelable; partial results kept and marked partial.
- **Re-scan (incremental):** Graph **delta** where supported, else full crawl; runs in background; snapshot stays usable and swaps atomically with a toast "Updated — 340 items changed."
- **Rate-limit honesty:** on 429, "Microsoft is rate-limiting us; slowing down. ETA ~4 min" rather than silent stall.
- **Empty/error:** never-scanned → single primary CTA card with a time estimate once the first page returns a count; failed mid-way → keep partial, "Scan incomplete — [Resume]."

## 9. Visual system (reuse teammate's foundation)
Tailwind + shadcn/ui; one UI sans (Inter) + one mono for sizes/dates (column alignment); small neutral gray scale + one accent (bars/active controls) + one 3-step staleness scale. Reused primitives: virtualized `Table`, `Breadcrumb`, `ToggleGroup`, `Badge`, `Popover`, `Progress`, `Slider`, `Tooltip`, `Skeleton`. Unique components: **SizeBarRow, StalenessCell, ScanProgressBar, Treemap, AnalysisSegmentedControl, FilterChipBar.** Compact ~36px rows, monospaced right-aligned numeric columns, no zebra striping (the size bar is the rhythm).

## 10. Build-roadmap slices
1. **V1 core:** cached-snapshot store + progressive first-scan + Browse list (recursive sizes, bars, breadcrumbs, last-scanned/re-scan). (Jobs 1 & 3)
2. **V1.1 analysis:** segmented control → Biggest files / Biggest folders / Stale + Cleanup-score + filters/sort/search + staleness coloring + honesty microcopy. (Job 2)
3. **V1.2 polish:** treemap toggle, delta re-scan, throttle-aware progress, deep links, account switcher.

## Opinionated calls
Ranked drill-down list is home (not tree/treemap) · "Cleanup score" (size × age) is the best default ranking · tell the truth about "last used" everywhere (labeled "Modified") · the explorer reads only from the cached snapshot, with last-scanned + re-scan always visible.
