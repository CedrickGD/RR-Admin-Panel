# 001 — Collapse the 3-layer page entrance stack into one quick rise

- **Status**: DONE
- **Commit**: 798e150
- **Severity**: HIGH
- **Category**: Purpose & frequency / Interruptibility / Cohesion
- **Estimated scope**: 2 CSS files + ~11 TSX call sites, small edits

## Problem

Every sidebar navigation (`<div key={page} className="page-enter">`, [src/App.tsx:174](../src/App.tsx)) remounts the page subtree, replaying up to THREE stacked translateY entrance layers at once. Worst case ~600–680ms before the page settles, restarting from zero if the user clicks nav again mid-entrance. Sidebar nav is the app's highest-frequency action (13 destinations).

Layer 1 (keep — this becomes the ONLY page-switch motion):

```css
/* src/theme/app-glue.css:1029 — current */
.page-enter { animation: pageIn 0.26s var(--ease-rise); }
```

Layer 2 (page-root rise, 4 pages):

```tsx
// src/pages/AccessPage.tsx:190, LicensesPage.tsx:311, AnnouncementsPage.tsx:222, FeedbackPage.tsx:173 — current
<div className="page-content page-stack-lg v2-rise">
```

Layer 3 (per-panel + per-tile rises with delays, replayed on every nav):

```css
/* src/theme/app-glue.css:119-138 — current (delete whole block) */
/* ── (a) Transitional page-mount stagger ─────────────────────────
   Carried over from theme-v2 so entrances stay alive until each
   page adopts .v2-stagger explicitly (then delete this block). */
.page-content > .stat-grid > * { animation: v2rise var(--t-rise) var(--ease-rise) both; }
.page-content > .stat-grid > *:nth-child(1) { animation-delay: 0.02s; }
.page-content > .stat-grid > *:nth-child(2) { animation-delay: 0.05s; }
.page-content > .stat-grid > *:nth-child(3) { animation-delay: 0.08s; }
.page-content > .stat-grid > *:nth-child(4) { animation-delay: 0.11s; }
.page-content > .stat-grid > *:nth-child(5) { animation-delay: 0.14s; }
.page-content > .stat-grid > *:nth-child(6) { animation-delay: 0.17s; }
.page-content > .stat-grid > *:nth-child(7) { animation-delay: 0.20s; }
.page-content > .panel,
.page-content > .main-side,
.page-content > section.panel { animation: v2rise 0.45s var(--ease-rise) 0.12s both; }
@media (prefers-reduced-motion: reduce) {
  .page-content > .stat-grid > *,
  .page-content > .panel,
  .page-content > .main-side,
  .page-content > section.panel { animation: none; }
}
```

```css
/* src/theme/app-glue.css:321-326 — current (delete rule + its RM block) */
/* Entrance rise for the Settings two-col identity/backend row
   (matches the transitional panel stagger) */
.page-content > .two-col { animation: v2rise 0.45s var(--ease-rise) 0.08s both; }
@media (prefers-reduced-motion: reduce) {
  .page-content > .two-col { animation: none; }
}
```

The `.v2-stagger` ladder in base.css conflicts with the app-glue ladder (different step timing wins depending on page nesting), and its `both` fill keeps a forwards-filling transform on tiles forever (permanent containing-block/composite promotion — the exact bug the repo documents at app-glue.css:1026-1028):

```css
/* src/theme/css/base.css:209-218 — current */
.v2-rise { animation: v2rise var(--t-rise) var(--ease-rise) both; }
.v2-stagger > * { animation: v2rise var(--t-rise) var(--ease-rise) both; }
.v2-stagger > *:nth-child(1) { animation-delay: 0.00s; }
.v2-stagger > *:nth-child(2) { animation-delay: 0.04s; }
.v2-stagger > *:nth-child(3) { animation-delay: 0.08s; }
.v2-stagger > *:nth-child(4) { animation-delay: 0.12s; }
.v2-stagger > *:nth-child(5) { animation-delay: 0.16s; }
.v2-stagger > *:nth-child(6) { animation-delay: 0.20s; }
.v2-stagger > *:nth-child(7) { animation-delay: 0.24s; }
.v2-stagger > *:nth-child(8) { animation-delay: 0.28s; }
```

## Target

- One page-switch motion: `pageIn 0.26s var(--ease-rise)` on `.page-enter`. Nothing else animates on navigation.
- `.v2-stagger` deleted (CSS + all TSX usages). `.v2-rise` kept ONLY for the login card (rare surface), with `backwards` fill instead of `both`.
- Two new shared tokens added for later plans.

```css
/* src/theme/tokens/spacing.css — target (add after --ease-lift line, keep existing tokens) */
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);        /* @kind other */ /* strong ease-out: entrances, fills */
  --t-fill: 0.3s;      /* @kind other */ /* data fills: gauges, rank bars, progress */
```

```css
/* src/theme/css/base.css — target (replaces lines 209-218) */
.v2-rise { animation: v2rise var(--t-rise) var(--ease-rise) backwards; }
```

```css
/* src/theme/tokens/spacing.css:25 — target */
  --t-rise: 0.3s;      /* @kind other */ /* entrance rise */
```

## Repo conventions to follow

- Motion tokens live in [src/theme/tokens/spacing.css](../src/theme/tokens/spacing.css) under the `/* Motion — purposeful, fast... */` header.
- Exemplar of the desired end state: `.page-enter` at app-glue.css:1029 — single tokenized rise, no fill mode (see the comment at app-glue.css:1026-1028 explaining why no fill).

## Steps

1. `src/theme/tokens/spacing.css`: change `--t-rise: 0.4s;` to `--t-rise: 0.3s;` and add the two new tokens (`--ease-out`, `--t-fill`) at the end of the Motion block, formats matching the excerpt above.
2. `src/theme/app-glue.css`: delete the whole block lines 119–138 (the "(a) Transitional page-mount stagger" comment through the closing `}` of its reduced-motion block).
3. `src/theme/app-glue.css`: delete lines 321–326 (`.page-content > .two-col` entrance comment, rule, and its reduced-motion block). Leave the surrounding Settings rules intact.
4. `src/theme/css/base.css`: replace lines 209–218 with the single `.v2-rise` rule above (delete `.v2-stagger > *` and all eight `nth-child` delay rules).
5. `src/theme/css/base.css:233-235`: the reduced-motion block currently reads `.v2-rise, .v2-stagger > *, .tile-value-pop { animation: none; }` — remove `.v2-stagger > *, ` from the selector list (result: `.v2-rise, .tile-value-pop { animation: none; }`).
6. TSX — remove the `v2-stagger` class token from every className in `src/pages/` (grep `v2-stagger`; expected sites: OverviewPage.tsx:196, TrafficPage.tsx:155, HeatmapPage.tsx:494, ErrorsPage.tsx:451, WorkersPage.tsx:521, VersionsPage.tsx:298 and :357). Remove only the class token and its separating space; keep `stat-grid stat-grid-N` etc.
7. TSX — remove the `v2-rise` class token from the four page roots: AccessPage.tsx:190, LicensesPage.tsx:311, AnnouncementsPage.tsx:222, FeedbackPage.tsx:173 (`"page-content page-stack-lg v2-rise"` → `"page-content page-stack-lg"`). Do NOT touch the two `v2-rise` usages in `src/components/LoginForm.tsx` (lines 41 and 61) — login is a rare surface and keeps its rise.
8. Grep `v2-stagger` repo-wide (src/) — must return only the belt-and-braces rule `.v2-stagger > .kpi-overlay` in app-glue.css:1103-1106; delete that rule too (nothing can match it anymore).

## Boundaries

- Do NOT touch `.page-enter`/`pageIn` (app-glue.css:1029-1039) — it is the surviving entrance.
- Do NOT touch `v2rise` keyframes (base.css:219-222) — still used by `.v2-rise` and later plans.
- Do NOT touch `.tile-value-pop` (plan 002 owns it).
- Do NOT add new dependencies. No markup changes beyond the listed className edits.
- If a listed line doesn't match the code you find, STOP and report.

## Verification

- **Mechanical**: `npm run typecheck` passes; `npm run build` passes. `grep -rn "v2-stagger" src/` → zero matches. `grep -rn "v2-rise" src/` → only base.css definition, its RM block, and LoginForm.tsx:41,61.
- **Feel check** (deployed preview / `npm run dev` won't run against real API — reviewer with a browser): click through all 13 sidebar destinations rapidly — each page does ONE quick 260ms rise, no per-tile cascade, no blank-then-pop tiles, and hammering nav never shows a page held invisible.
- **Done when**: navigation shows exactly one entrance layer and all greps above are clean.
