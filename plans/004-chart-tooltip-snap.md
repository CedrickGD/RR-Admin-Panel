# 004 — Chart tooltips: kill the 400ms default tween

- **Status**: DONE
- **Commit**: 798e150
- **Severity**: HIGH
- **Category**: Easing & duration
- **Estimated scope**: 5 TSX files, 6 Tooltip sites + 3 dead-prop cleanups

## Problem

Every Recharts `<Tooltip>` in the app runs at the library default `animationDuration: 400, animationEasing: 'ease'` (verified in node_modules/recharts/es6/component/Tooltip.js:98-99). The tooltip visibly lags the cursor on every chart hover — the highest-frequency motion in the app. Budget for tooltips is 125–200ms, and in a crisp dashboard the right value for a cursor-following tooltip is *instant*.

The six sites, none of which set any animation prop today:

- src/components/charts/TimezoneUsageChart.tsx:104
- src/components/KpiStatCard.tsx:136
- src/components/UserActivityPanel.tsx:192
- src/components/UserActivityPanel.tsx:227
- src/pages/OverviewPage.tsx:326
- src/pages/TrafficPage.tsx:241

Example (verified):

```tsx
// src/pages/OverviewPage.tsx:326-339 — current
<Tooltip
  cursor={{ stroke: "rgba(255,255,255,0.08)", strokeWidth: 1 }}
  content={({ active, payload, label }) => (
    ...
  )}
/>
```

Separately, three chart series carry contradictory dead props — `isAnimationActive={false}` plus `animationDuration={600}` / `animationEasing="ease-out"` — stale config that re-arms a 600ms tween the moment anyone flips the flag:

```tsx
// src/pages/OverviewPage.tsx:356-357 (also 366-367 and 385-386) — current
                    animationDuration={600}
                    animationEasing="ease-out"
```

## Target

```tsx
// each <Tooltip> — target: add as first prop
<Tooltip
  isAnimationActive={false}
  cursor={{ stroke: "rgba(255,255,255,0.08)", strokeWidth: 1 }}
  ...
/>
```

And the three `animationDuration`/`animationEasing` pairs in OverviewPage.tsx deleted (the `isAnimationActive={false}` on those series stays).

## Repo conventions to follow

- The repo already sets `isAnimationActive={false}` on all 9 chart series (e.g. src/pages/OverviewPage.tsx:341) — this extends the same deliberate decision to tooltips.

## Steps

1. Add `isAnimationActive={false}` to the `<Tooltip>` at each of the six sites listed above (keep existing props untouched; place the new prop first).
2. `src/pages/OverviewPage.tsx`: delete the `animationDuration={600}` and `animationEasing="ease-out"` lines from the three series (pairs at 356-357, 366-367, 385-386).
3. Grep `\<Tooltip` in `src/` to confirm no seventh site exists; if one does, apply step 1 to it too and note it.

## Boundaries

- Do NOT touch series props other than the two dead lines named.
- Do NOT touch the custom `content={...}` render functions.
- If a listed line number has drifted, locate the `<Tooltip>` in the same component and proceed; if the component has no Tooltip, STOP and report.

## Verification

- **Mechanical**: `npm run typecheck` && `npm run build` pass. `grep -rn "animationDuration" src/` → zero matches.
- **Feel check**: hover across the Overview composed chart — the tooltip tracks the cursor with zero easing lag; same on Traffic, the KPI drill-down chart, timezone cards, and the punchcard panel.
- **Done when**: every `<Tooltip>` in src/ has `isAnimationActive={false}` and no chart carries dead animation props.
