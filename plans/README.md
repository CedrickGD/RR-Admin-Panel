# Animation improvement plans

Product of a deep motion audit (8 parallel category audits + vetting) at commit `798e150`. The console's motion foundation is genuinely good — real tokens, deliberate chart-animation kills, a global backdrop-filter ban with documented rationale, one correctly-interruptible collapse pattern. The plans below fix what's broken around that foundation: a 3-layer entrance stack on every nav, a reduced-motion gate lost to the cascade, dead press feedback, per-row infinite pulses, and a legacy motion layer nobody renders.

## Execution order (dependencies flow downward)

| # | Plan | Severity | Status |
| --- | --- | --- | --- |
| 001 | [Single entrance system](001-single-entrance-system.md) — also adds shared tokens `--ease-out`, `--t-fill` | HIGH | DONE |
| 002 | [KPI value pop → opacity-only](002-kpi-value-pop-opacity.md) | HIGH | DONE |
| 003 | [Status-pulse restraint](003-status-pulse-restraint.md) | HIGH | DONE |
| 004 | [Chart tooltip snap](004-chart-tooltip-snap.md) | HIGH | DONE |
| 005 | [Press feedback + popover origins](005-press-feedback-and-popover-origins.md) | HIGH | DONE |
| 006 | [Data-fill durations](006-data-fill-durations.md) | MED-HIGH | DONE |
| 007 | [Modal exit + scrim symmetry](007-modal-exit-and-scrim-symmetry.md) | MEDIUM | DONE |
| 008 | [Dead motion cleanup](008-dead-motion-cleanup.md) | MEDIUM | DONE |
| 009 | [Licenses inline motion](009-licenses-inline-motion.md) | MEDIUM | DONE |
| 010 | [Interaction micro-feedback](010-interaction-micro-feedback.md) | MEDIUM/LOW | DONE |
| 011 | [Row-expand transition](011-row-expand-transition.md) | MEDIUM | DONE |
| 012 | [Input-driven motion perf](012-input-driven-motion-perf.md) | MEDIUM | DONE |
| 013 | [Reduced motion + pointer gating](013-reduced-motion-and-pointer-gating.md) | HIGH | DONE |

Hard dependencies:

- **001 first** — it introduces `--ease-out`/`--t-fill`, consumed by 002, 005, 006, 007, 009, 010.
- **013 last** — its consolidated reduced-motion gates reference end-state animation names from 001, 005, 006, 010 (`popover-in`, `dt-settle`, the fill transitions).
- 003 and 008 both delete the index.css pulse duplicates — whichever runs second skips them (both plans say so).
- 006 and 009 share the scaleX fill mechanics; order between them doesn't matter.

## Deliberate non-findings (do not "fix" these)

- `grid-template-rows` collapse transition (components.css:48-54) — the repo's one correctly-interruptible pattern; layout cost is inherent to animating height on an occasional surface.
- `v2grow`'s `scaleX(0)` — a value reveal with correct `transform-origin: left`, not an element materializing from nothing.
- No exit animations on dropdowns/popovers — dismissal snapping is correct asymmetric timing.
- Modal `transform-origin: center` — modals are exempt from trigger-origin.
- Recharts series `isAnimationActive={false}` everywhere — a correct decision; do not re-enable chart tweens.
- The `backdrop-filter: none !important` global ban and `svg filter: none` kills (app-glue.css:625-646) — documented perf contract.
- MapLibre camera flight durations (700–900ms) — viewport navigation, not UI chrome (they DO get reduced-motion zeroing in 013).

## Verification after the batch

`npm run typecheck` && `npm run build` must pass. Full feel-check requires a deployed preview (the app needs auth + API; see repo memory) — walk the checklist in each plan's Verification section there.
