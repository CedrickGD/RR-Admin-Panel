# 008 — Delete the dead second motion system in index.css

- **Status**: DONE
- **Commit**: 798e150
- **Severity**: MEDIUM
- **Category**: Cohesion & tokens
- **Estimated scope**: 1 CSS file (src/index.css), deletions only

## Problem

`src/index.css` (the legacy layer, loaded first) carries a parallel motion vocabulary: 46 raw literal declarations, zero token references, duplicate keyframe definitions that silently lose to the theme files, references to a keyframe that doesn't exist, and whole rule blocks for markup no TSX renders. It inflates the motion vocabulary, misleads every future edit, and in two spots re-arms latent bugs (a 24px `backdrop-filter` transition; three `transition: all`).

**Verified-dead selectors** (no TSX reference; `.navbar`/`.navbar-mobile-drawer` additionally `display: none`'d by app-glue.css:48-51): `.navbar` motion line (index.css:239), `.navbar-link` (:324), `.navbar-hamburger` (:415), `.navbar-mobile-link` (:445), `.glass-select` (:821), `.error-filter-toggle` (:1076), `.error-filter-chip` (:1150), `.error-filter-clear` (:1193), `.map-node-pulse` (:1841), `.map-node-halo` (:1847), `.map-node-core` (:1855) + keyframes `heatPulse` (:1962), `nodeBreathCore` (:1967), `nodeBreathHalo` (:1971), `.donut-legend-item` (:2007).

**Undefined keyframe references** (fadeInUp exists nowhere in src/):

```css
/* src/index.css:2279 — current */
  animation: fadeInUp 0.16s ease-out;
```
```css
/* src/index.css:2365 — current */
  animation: fadeInUp 0.18s ease-out;
```

**Dead page entrance generation** (loses cascade to app-glue):

```css
/* src/index.css:1575-1581 — current */
.page-enter { animation: page-in 0.3s cubic-bezier(0.22, 1, 0.36, 1); }
@keyframes page-in {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

**Duplicate keyframes + call sites** (identical names redefined later in theme css — the index.css copies never win): `status-pulse`/`-warn`/`-err` rules at :382/:392/:399, keyframes at :387/:394/:401 (plan 003 may already have removed these); `live-pulse` rule :785, keyframes :787; `.spinner` rule :1329, `spin` keyframes :1332; `.skeleton` rule :1343, `shimmer` keyframes :1346; `.progress-fill` transition :1427; `.panel-body-clip` transition :2649; `.panel-collapse-chevron` transition :2570; `.gdrop-chevron` transition :2260; `.gdrop-trigger` transition :2247; `.gdrop-item` transition :2319; `.data-table tbody tr` transition :876 (loses to components.css:266 `0.12s`); `.stat-card` transition line :539; `.timeline-marker` transition :1456 dup of components.css:453; `.accent-swatch` transition :1509 dup of controls.css:209.

## Target

None of the above declarations remain. Live legacy rules that are the SOLE styling for rendered markup stay untouched (e.g. `.error-group-row` :1223, `.world-heatmap-*` :1691/:1722/:1745/:1767, `.map-node-popup-close` :1885, `.user-activity-punchcard-cell` :1958, `.inline-error`).

## Repo conventions to follow

- app-glue.css's header describes the intended architecture: index.css is legacy awaiting neutralization; this plan is that neutralization for motion.

## Steps

For each item below, FIRST verify deadness (`grep -rn "<class-name>" src/ --include=*.tsx`), then delete. If a grep shows a live user, skip that item and record it in the report.

1. Delete the whole dead rule blocks (selector to closing brace, including their `:hover` companions) for: `.navbar-link`, `.navbar-hamburger`, `.navbar-mobile-link`, `.glass-select`, `.error-filter-toggle`, `.error-filter-chip`, `.error-filter-clear`, `.map-node-pulse`, `.map-node-halo`, `.map-node-core`, `.donut-legend-item`, plus keyframes `heatPulse`, `nodeBreathCore`, `nodeBreathHalo`. For `.navbar` (still needed as a display:none target) delete ONLY the `transition:` line at :239.
2. Delete the two `animation: fadeInUp …` lines (:2279, :2365). Leave the rest of those rules.
3. Delete the `.page-enter` rule and `page-in` keyframes (:1575-1581).
4. Delete the duplicate keyframes and their local call-site `animation:`/`transition:` declarations listed above (status-pulse family if still present, live-pulse, spin + `.spinner`/`.spinner-sm` rules if fully duplicated by components.css — compare property-for-property; if identical, delete the whole index.css copy, otherwise only the animation line; same procedure for `.skeleton`).
5. Delete the overridden single declarations: :1427 (`transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);`), :2649 (`transition: grid-template-rows 0.32s cubic-bezier(0.4, 0, 0.2, 1);`), :2570, :2260, :2247 (transition line only), :2319 (transition line only), :876 (transition line only), :539 (transition line only), :1456 (transition line only), :1509 (transition line only). Delete only the declaration line, never the whole rule, for these — the rules carry live layout/color styling.

## Boundaries

- Deletions only — do not rewrite, reformat, or "improve" surviving rules.
- Do NOT touch `.inline-error`, `.error-group-row`, `.world-heatmap-*`, `.user-activity-*`, `.map-node-popup-*`, `.timeline-*` layout/color properties.
- When in doubt about liveness, keep the rule and report it.

## Verification

- **Mechanical**: `npm run build` passes. `grep -n "fadeInUp\|page-in\|heatPulse\|nodeBreath" src/` → 0 matches. `grep -c "transition\|animation" src/index.css` drops by roughly 30+.
- **Feel check**: click through every page at desktop and mobile widths — zero visual change anywhere (this plan must be invisible). Pay attention to: error page filter panel, heatmap hover toolbar, punchcard, licenses table.
- **Done when**: index.css contains no motion declaration that is shadowed, duplicated, undefined, or attached to unrendered markup.
