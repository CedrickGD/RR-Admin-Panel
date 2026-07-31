# 005 — Press feedback that actually fires + popovers that unfold from their trigger

- **Status**: DONE
- **Commit**: 798e150
- **Severity**: HIGH
- **Category**: Physicality & origin / Cohesion
- **Estimated scope**: 3 CSS files + 1 TSX file + 1 token edit

## Problem

**A. `.btn-primary` press feedback is dead.** The `:active` rule loses to a later `:hover` rule at equal specificity (0,3,0), so a held mouse press keeps the hover lift and never scales:

```css
/* src/theme/app-glue.css:897-898 — current */
.btn:active:not(:disabled),
.btn-icon:active:not(:disabled) { transform: translateY(0) scale(0.97); }
```

```css
/* src/theme/app-glue.css:1049-1054 — current (later in file, wins while pressed+hovered) */
.btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, hsl(var(--ah) var(--as) calc(var(--al) + 6%)), hsl(calc(var(--ah) + 32) var(--as) var(--al)));
  border-color: transparent;
  color: #fff;
  transform: translateY(-1px);
}
```

**B. The filter popover inflates from its own center** using the modal's keyframe (it is not a modal — the exemption doesn't apply), and **the dropdown menu slides the wrong way** — it renders *below* its trigger but enters from 10px further down, reading as "arriving from off-screen" instead of unfolding from the pill:

```css
/* src/theme/app-glue.css:1173 — current (.filter-pop, no transform-origin) */
  animation: kpi-modal-in 0.16s ease-out;
```

```css
/* src/theme/css/controls.css:141 — current (.gdrop-menu, no transform-origin) */
  animation: v2rise 0.16s ease-out;
```

```tsx
// src/components/GlassDropdown.tsx:79 — current (left-anchored variant, origin must flip too)
<div className="gdrop-menu" role="listbox" style={align === "left" ? { right: "auto", left: 0 } : undefined}>
```

**C. Bounce on a hover surface.** `.stat-card` hover uses the overshooting `--ease-lift` — the token file's own header says "no bounce except value pops" — and its accent tick animates the layout properties `top`/`bottom`:

```css
/* src/theme/css/components.css:71 — current */
  transition: border-color 0.15s, background 0.15s, transform 0.18s var(--ease-lift);
```

```css
/* src/theme/css/components.css:83 — current (.stat-card::before) */
  transition: background 0.15s, top 0.18s, bottom 0.18s;
```

```css
/* src/theme/css/components.css:90 — current */
.stat-card:hover::before { background: var(--accent); top: 9px; bottom: 9px; }
```

**D. Missing presses on already-transitioning controls:** `.accent-swatch` transitions transform on hover but has no `:active` (controls.css:203-212); clickable KPI cards (`.kpi-card-clickable`, components.css:141) have hover affordance but no press state.

## Target

```css
/* src/theme/app-glue.css — target: append directly AFTER the .btn-primary:hover rule (~line 1054) */
.btn-primary:active:not(:disabled) { transform: translateY(0) scale(0.97); }
```

```css
/* src/theme/app-glue.css — target: shared popover entrance, add next to the kpi-modal keyframes (~line 1098) */
@keyframes popover-in {
  from { opacity: 0; transform: scale(0.96) translateY(-4px); }
  to   { opacity: 1; transform: none; }
}
```

```css
/* .filter-pop — target (inside its existing rule, app-glue.css ~1159-1174) */
  transform-origin: top right;
  animation: popover-in 0.16s var(--ease-out);
```

```css
/* .gdrop-menu — target (controls.css ~127-142) */
  transform-origin: top right;
  animation: popover-in 0.16s var(--ease-out);
```

```tsx
// src/components/GlassDropdown.tsx:79 — target
<div className="gdrop-menu" role="listbox" style={align === "left" ? { right: "auto", left: 0, transformOrigin: "top left" } : undefined}>
```

```css
/* src/theme/css/components.css — target */
  transition: border-color 0.15s, background 0.15s, transform 0.18s var(--ease-smooth);   /* :71 */
  /* ::before (:74-84): tick grows via transform, not top/bottom */
  transition: background 0.15s, transform 0.18s var(--ease-smooth);
.stat-card:hover::before { background: var(--accent); transform: scaleY(1.2); }
```

(`::before` keeps its static `top: 12px; bottom: 12px;` and gains `transform-origin: center;`.)

```css
/* src/theme/css/controls.css — target: after .accent-swatch:hover (~line 211) */
.accent-swatch:active { transform: scale(1.05); }
```

```css
/* src/theme/css/components.css — target: extend the .kpi-card-clickable rule (~line 141) */
.kpi-card-clickable { cursor: pointer; }
.kpi-card-clickable:active { transform: translateY(0) scale(0.99); }
```

```css
/* src/theme/tokens/spacing.css — target: --ease-lift deleted (its only consumer was components.css:71) */
```

## Repo conventions to follow

- Press scale band used everywhere else: 0.96–0.98 at `--t-fast`/0.13s (e.g. `.sb-item:active { transform: scale(0.97); }`, app-glue.css:742).
- `--ease-out` comes from plan 001. If missing, STOP — run 001 first.
- `popover-in` lives in app-glue.css because keyframes defined there win the cascade and both consumers load earlier or equal; note `@keyframes` are globally scoped, so controls.css can reference it.

## Steps

1. app-glue.css: add the `.btn-primary:active:not(:disabled)` rule immediately after the `:hover` rule (source order is the fix — it must come later).
2. app-glue.css: add `@keyframes popover-in` next to `kpi-modal-in`.
3. app-glue.css `.filter-pop`: swap the `animation:` line and add `transform-origin: top right;`.
4. controls.css `.gdrop-menu`: swap the `animation:` line and add `transform-origin: top right;`.
5. GlassDropdown.tsx:79: extend the align-left inline style with `transformOrigin: "top left"`.
6. components.css: apply the three `.stat-card` edits (transition curve at :71; `::before` transition + `transform-origin: center` at :74-84; hover rule at :90 → `transform: scaleY(1.2)` keeping the `background` change, removing `top`/`bottom` overrides).
7. controls.css: add `.accent-swatch:active`.
8. components.css: add `.kpi-card-clickable:active`.
9. spacing.css: delete the `--ease-lift` line; grep `ease-lift` in src/ must then return zero matches (if any remain, STOP and report instead of deleting).

## Boundaries

- Do NOT touch `kpi-modal-in` / `.kpi-modal` — modals correctly scale from center (exempt).
- Do NOT add exit animations to dropdown/popover — dismissal snapping is intentional (asymmetric timing).
- Do NOT change the `v2rise` keyframe (other consumers).

## Verification

- **Mechanical**: `npm run typecheck` && `npm run build`; `grep -rn "ease-lift" src/` → 0 matches; `grep -n "popover-in" src/theme` → 3 matches (1 def, 2 uses).
- **Feel check**: hold a click on the primary auth/generate button — it visibly presses down (scale 0.97) instead of staying lifted. Open the filter pill popover in DevTools with animations at 10% — it unfolds from its top-right corner (under the pill), not from its center. Open a dropdown — the menu grows downward from the trigger edge, not up from below. KPI tile hover lift no longer overshoots.
- **Done when**: all four defect classes (A–D) are gone and the greps pass.
