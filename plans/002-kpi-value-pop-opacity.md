# 002 — KPI value pop: drop the movement, keep the cue

- **Status**: DONE
- **Commit**: 798e150
- **Severity**: HIGH
- **Category**: Purpose & frequency / Interruptibility
- **Estimated scope**: 1 CSS file, 2 small edits

## Problem

Every KPI tile value remounts via `key={value}` ([src/components/KpiStatCard.tsx:85](../src/components/KpiStatCard.tsx)) and replays a 350ms bouncy translate:

```css
/* src/theme/css/base.css:224-229 — current */
/* Value change pop */
.tile-value-pop { animation: v2pop 0.35s var(--ease-pop); }
@keyframes v2pop {
  0%   { opacity: 0.4; transform: translateY(5px); }
  100% { opacity: 1; transform: none; }
}
```

Polls re-fire it automatically (`DEFAULT_REFRESH_MS = 15_000`, `LIVE_REFRESH_MS = 5_000` in src/hooks/useDashboard.ts:12-13; 60s in useAdminStats.ts:5), and every filter/range click pops all 3–6 tiles at once with positional movement + overshoot curve. At that frequency the audit band is "drastically reduce": state indication should be a non-moving cue.

Also, the reduced-motion block kills the pop entirely (base.css:233-235 after plan 001: `.v2-rise, .tile-value-pop { animation: none; }`) — leaving reduced-motion users with silent value swaps and no update signal. Once the pop is opacity-only it is exactly the kind of comprehension aid reduced motion should KEEP.

## Target

```css
/* src/theme/css/base.css — target */
/* Value change pop — opacity-only cue; fires on every poll, so no movement */
.tile-value-pop { animation: v2pop 0.18s var(--ease-out); }
@keyframes v2pop {
  0%   { opacity: 0.45; }
  100% { opacity: 1; }
}
```

```css
/* src/theme/css/base.css reduced-motion block — target (pop stays; it is opacity-only now) */
@media (prefers-reduced-motion: reduce) {
  .v2-rise { animation: none; }
}
```

`--ease-out` is `cubic-bezier(0.23, 1, 0.32, 1)`, added to src/theme/tokens/spacing.css by plan 001. If it is missing, STOP — run plan 001 first.

## Repo conventions to follow

- Keep the existing comment style (`/* Value change pop */` header).
- Duration/curve as tokens where one exists; `0.18s` equals `--t-med` but animation durations in this file are written literally (see `.tile-value-pop 0.35s` today) — keep the literal to match file style.

## Steps

1. `src/theme/css/base.css`: replace lines 224–229 (comment + rule + keyframes) with the target block above.
2. `src/theme/css/base.css`: in the `@media (prefers-reduced-motion: reduce)` block near line 233, remove `.tile-value-pop` from the selector list so only `.v2-rise` remains gated.
3. Do NOT touch `src/components/KpiStatCard.tsx` — `key={value}` is the intended (re)trigger and now costs only a 180ms fade.

## Boundaries

- Do NOT rename `v2pop` (only this file references it after plan 010 adds its own keyframe).
- Do NOT touch `--ease-pop` in spacing.css — plan 010 uses it for the copy-confirmation pop.
- If line content differs from the excerpts (beyond plan-001 edits), STOP and report.

## Verification

- **Mechanical**: `npm run build` passes. `grep -n "translateY" src/theme/css/base.css` → only the `v2rise` keyframe (line ~220).
- **Feel check**: on Overview, switch the range filter — values dim-and-settle in place with zero vertical movement; spamming range buttons never makes tiles jump. With reduced motion emulated (DevTools Rendering panel), the opacity cue still fires.
- **Done when**: `v2pop` contains no `transform` and reduced-motion still shows the value-change cue.
