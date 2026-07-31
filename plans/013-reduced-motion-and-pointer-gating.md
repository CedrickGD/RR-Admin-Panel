# 013 — Reduced motion that actually reduces + hover gating (RUN LAST)

- **Status**: DONE
- **Commit**: 798e150
- **Severity**: HIGH
- **Category**: Accessibility
- **Estimated scope**: 4 CSS files + 3 TS/TSX files. Depends on plans 001–011 (references their end-state animation names).

## Problem

**A. The biggest moving surface in the app ignores the motion preference.** The full-viewport liquid layers re-declare `animation` in app-glue.css at equal specificity AFTER base.css's gate, so `animation: none` loses the cascade and the background drifts forever for reduced-motion users. The comment above it claims the opposite ("reduced-motion gated", app-glue.css:578):

```css
/* src/theme/app-glue.css:587-600 — current (no gate in this file) */
html::before {
  …
  animation: liquid-a 24s ease-in-out infinite alternate;
}
html::after {
  …
  animation: liquid-b 33s ease-in-out infinite alternate;
}
```

**B. Zero hover gating.** No `@media (hover: hover) and (pointer: fine)` exists in src/ — every `:hover` transform fires as sticky hover on touch: `.btn/.btn-icon` lift (app-glue.css:896), `.btn-primary` lift (:1053), `.stat-card` lift (components.css:88), `.timeline-marker` scale(1.3) (components.css:455), `.accent-swatch` scale(1.15) (controls.css:211), punchcard `scale(1.25)` on a 168-cell grid (index.css:1958-1960).

**C. Hover-only disclosure with no keyboard path:** the map-controls flyout opens ONLY on `:hover` (index.css:1751) even though its trigger is a real button — keyboard focus never reveals zoom in/out/reset.

**D. JS motion has no reduced-motion branch:** 8 MapLibre camera flights (WorldHeatmap.tsx:311, 319, 324, 334, ~1170, ~1194, ~1310, ~1313 — durations 300–900ms; the ~1170 one fires automatically on cross-page focus) and a smooth `scrollIntoView` (LivePage.tsx:~168) that Safari never reduces.

**E. Movement with no coverage:** `.gdrop-menu`/`.filter-pop` popover entrance, `.sidebar` drawer slide (`translateX(-102%)`, transition — unreachable by any `animation: none`), `.rank-fill` grow, `.gauge-fill`/`.progress-fill` sweeps, `.skeleton` shimmer, `.dt-settle`, `.empty-state` rise. Existing blocks meanwhile nuke opacity fades that should stay.

## Target

Reduced motion = fewer and gentler, not zero: opacity cues stay, position changes go.

```css
/* src/theme/app-glue.css — target: add immediately after the liquid-b keyframes (~line 615) */
@media (prefers-reduced-motion: reduce) {
  html::before,
  html::after { animation: none; }
}
```

Fix the comment at app-glue.css:578-586: the text "reduced-motion gated" must be true again (it now is, via this block — keep the wording).

```css
/* src/theme/app-glue.css — target: consolidated gate near the end of the file */
@media (prefers-reduced-motion: reduce) {
  /* Popovers: keep the fade, drop the movement */
  .gdrop-menu,
  .filter-pop { animation: kpi-overlay-fade 0.12s ease-out; }
  /* Drawer: instant (position change), scrim keeps its opacity transition */
  .sidebar { transition-duration: 0.01s; }
  /* Page switch: fade only */
  .page-enter { animation: kpi-overlay-fade 0.2s ease-out; }
}
```

(The existing `.page-enter { animation: none; }` block at app-glue.css:1037-1039 is REPLACED by the fade line above — delete the old block. `kpi-overlay-fade` is defined at app-glue.css:1091.)

```css
/* src/theme/css/components.css — target: one gate at end of file */
@media (prefers-reduced-motion: reduce) {
  .rank-fill { animation: none; }
  .gauge-fill,
  .progress-fill { transition: none; }
  .skeleton { animation: none; }
  .empty-state { animation: dt-settle var(--t-med) ease-out; }  /* fade stays, rise goes */
  .empty-ring { animation: none; }
  /* .dt-settle stays — opacity-only comprehension aid */
  /* .panel-body-clip collapse stays — comprehension aid, per AUDIT §6 */
}
```

```css
/* src/theme/css/base.css — target: RM block becomes fade-only for the login card */
@keyframes v2fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .v2-rise { animation: v2fade 0.2s ease-out backwards; }
}
```

(Replaces the block left by plans 001/002 at base.css ~233. The `.auth-card .inline-error` v2rise from plan 010 is also covered by adding `.auth-card .inline-error { animation: v2fade var(--t-med) ease-out backwards; }` to app-glue's consolidated gate.)

**Hover gating** — per site, move ONLY the transform out of the base hover rule into a gated rule placed directly after it (color/background hover feedback stays for touch):

```css
/* pattern — example for components.css .stat-card */
.stat-card:hover {
  background: var(--surface-2);
  border-color: var(--line-hi);
}
@media (hover: hover) and (pointer: fine) {
  .stat-card:hover { transform: translateY(-1px); }
  .stat-card:hover::before { transform: scaleY(1.2); }   /* keep the background change ungated */
}
```

Apply the same split at: app-glue.css:896 (`.btn/.btn-icon` — move `transform: translateY(-1px)`), app-glue.css:1049-1054 (`.btn-primary:hover` — move the `transform` line only), components.css:455 (`.timeline-marker:hover` — move the `transform`, keep the box-shadow), controls.css:211 (`.accent-swatch:hover`), index.css:1960 (`.user-activity-punchcard-cell:hover`). `:active` press scales stay ungated (correct on touch).

**Keyboard path for the map flyout** — extend the open condition:

```css
/* src/index.css:1751 — target */
.world-heatmap-hovbar:hover .world-heatmap-hovbar-items,
.world-heatmap-hovbar:focus-within .world-heatmap-hovbar-items {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
}
```

**JS branches** — new util + call-site wraps:

```ts
// src/utils/motion.ts — target (new file)
/** True when the OS asks for reduced motion. Read live — users toggle it mid-session. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Duration helper for JS-driven motion (MapLibre camera, smooth scroll). */
export function motionDuration(ms: number): number {
  return prefersReducedMotion() ? 0 : ms;
}
```

- WorldHeatmap.tsx: wrap all 8 camera durations: `duration: motionDuration(700)` etc. (sites at 311, 319, 324, 334-338, ~1170, ~1194, ~1310, ~1313 — grep `duration:` in the file to catch all).
- LivePage.tsx (~168): `row.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" })`.

## Repo conventions to follow

- Consolidated gates live at the end of each file that owns the animations (app-glue owns app chrome, components.css owns DS widgets, base.css owns primitives).
- `kpi-overlay-fade` and `dt-settle` are the repo's opacity-only keyframes — reuse, don't mint new ones (except `v2fade` in base.css, which becomes the primitive fade).

## Steps

1. app-glue.css: liquid gate after the keyframes; verify comment truthfulness at :578.
2. app-glue.css: delete the old `.page-enter` RM block (1037-1039); add the consolidated end-of-file gate (popovers, sidebar, page-enter, `.auth-card .inline-error`).
3. components.css: end-of-file gate as specced.
4. base.css: add `v2fade`, replace the RM block.
5. Hover-gating splits at the six listed sites (transform-only moves; verify each base rule keeps its non-transform declarations).
6. index.css: add `:focus-within` to the hovbar open condition.
7. Create src/utils/motion.ts; wire WorldHeatmap.tsx (8 sites) and LivePage.tsx.
8. Full-file sweep: `grep -n "transform" src/theme/css/*.css src/theme/app-glue.css src/index.css` and confirm every `:hover` transform found is inside a `(hover: hover)` gate.

## Boundaries

- Do NOT gate `:active` press feedback or focus rings.
- Do NOT stop the `.spinner`/`.animate-spin` rotation under reduced motion (activity indication; tiny element) — document as a deliberate keep.
- Do NOT touch the `hdr-frost` scroll animation (background/box-shadow only — no transform).
- Do NOT introduce a React context for reduced motion — the two JS call sites read the media query directly.

## Verification

- **Mechanical**: `npm run typecheck` && `npm run build`. `grep -c "prefers-reduced-motion" src/theme/app-glue.css` ≥ 2; `grep -rn "hover: hover" src/` ≥ 6.
- **Feel check**: DevTools → Rendering → emulate `prefers-reduced-motion: reduce`: the background is STILL (the big one), page switches fade without rising, popovers fade in place, drawers snap, fills appear instantly, KPI value cue still fires, modal still fades. Emulate touch: tapping a KPI tile doesn't leave it stuck lifted. Tab to the map-controls button — the flyout opens.
- **Done when**: every moving surface in the coverage map is either gated, gentled, or documented as a deliberate keep.
