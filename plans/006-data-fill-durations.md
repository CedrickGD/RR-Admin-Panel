# 006 — Data fills: one duration, strong ease-out, GPU-safe progress bars

- **Status**: DONE
- **Commit**: 798e150
- **Severity**: MEDIUM-HIGH
- **Category**: Easing & duration / Performance / Cohesion
- **Estimated scope**: 2 CSS files + 2 TSX files

## Problem

Four "value fills a track" animations use four durations (0.3s / 0.6s / 0.7s / 0.8s), all on `--ease-smooth` — a curve whose `(0.4, 0)` start point holds at zero like an ease-in, delaying the exact reveal the user is watching. All exceed or crowd the 300ms UI budget, and two re-fire on every 15s poll:

```css
/* src/theme/css/components.css:288 — current (.rank-fill, replays 700ms on every page mount) */
  animation: v2grow 0.7s var(--ease-smooth) both;
```

```css
/* src/theme/css/components.css:301 — current (.gauge-fill, 800ms sweep on every data refresh) */
  transition: stroke-dashoffset 0.8s var(--ease-smooth);
```

```css
/* src/theme/css/components.css:461 — current (.progress-fill, animates the layout property `width`, re-tweens per poll) */
.progress-fill { height: 100%; border-radius: var(--r-pill); background: var(--accent); transition: width 0.6s var(--ease-smooth); }
```

```tsx
// src/pages/HeatmapPage.tsx:557 — current (drives .progress-fill via width)
<div className="progress-fill" style={{ width: `${Math.round(row.share * 100)}%`, background: row.color }} />
```

Bonus in the same family: the skeleton shimmer eases (`ease-in-out`) where constant motion must be `linear` — the sweep visibly stalls at each cycle boundary:

```css
/* src/theme/css/components.css:478 — current */
  animation: shimmer 1.8s ease-in-out infinite;
```

## Target

All fills: `var(--t-fill)` (0.3s) + `var(--ease-out)` (`cubic-bezier(0.23, 1, 0.32, 1)`) — both tokens added by plan 001. Progress bars animate `transform: scaleX()` instead of `width`.

```css
/* components.css:288 — target */
  animation: v2grow var(--t-fill) var(--ease-out) backwards;
```

```css
/* components.css:301 — target */
  transition: stroke-dashoffset var(--t-fill) var(--ease-out);
```

```css
/* components.css:461 — target */
.progress-fill { width: 100%; height: 100%; border-radius: var(--r-pill); background: var(--accent); transform-origin: left; transition: transform var(--t-fill) var(--ease-out); }
```

```tsx
// src/pages/HeatmapPage.tsx:557 — target
<div className="progress-fill" style={{ transform: `scaleX(${Math.min(1, Math.max(0.02, row.share))})`, background: row.color }} />
```

```css
/* components.css:478 — target */
  animation: shimmer 1.8s linear infinite;
```

## Repo conventions to follow

- `.rank-fill` is the exemplar for GPU-safe fills (already `scaleX` + `transform-origin: left`, components.css:288-291) — `.progress-fill` adopts the same mechanics.
- Update the stale prose in [src/components/ds/RadialGauge.tsx](../src/components/ds/RadialGauge.tsx) line ~6 that documents "(0.8s smooth ease) on mount/update" → "(var(--t-fill) ease-out) on mount/update".

## Steps

1. components.css: apply the three fill edits (:288, :301, :461) exactly as above. Note :288 changes `both` → `backwards` (no forwards fill → no permanent composite promotion).
2. HeatmapPage.tsx:557: swap `width` for `transform: scaleX(...)` as above. Verify `.progress-track` (components.css:460) has `overflow: hidden` — it does; keep it.
3. Grep `className="progress-fill"` in src/ for other callers; apply the same width→scaleX conversion to any found (report them).
4. components.css:478: `ease-in-out` → `linear` on shimmer.
5. RadialGauge.tsx: fix the doc comment.

## Boundaries

- Do NOT touch `.kpi-breakdown-fill` (components.css:386-391) — it has no transition; adding one is out of scope.
- Do NOT touch the `v2grow` keyframe itself (`scaleX(0)→scaleX(1)` with left origin is a correct value reveal).
- Do NOT touch the index.css duplicates (`:1427` progress-fill, `:1343` shimmer) — plan 008 deletes them; if 008 already ran they're gone.
- If `--t-fill`/`--ease-out` are missing from spacing.css, STOP — run plan 001 first.

## Verification

- **Mechanical**: `npm run build`; `grep -n "0.6s\|0.7s\|0.8s" src/theme/css/components.css` → only `.spinner`'s `0.7s linear` remains.
- **Feel check**: open Versions — rank bars and gauges settle within ~0.3s, starting fast (no dead first frames). On Heatmap, let a poll land — region bars glide to new lengths without layout jitter; DevTools Performance shows no purple layout stripes from the bars.
- **Done when**: every fill uses `--t-fill`/`--ease-out`, progress bars animate transform only, shimmer is linear.
