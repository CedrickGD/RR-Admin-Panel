# 009 — LicensesPage: retire `transition: all` and hand-rolled timings

- **Status**: DONE
- **Commit**: 798e150
- **Severity**: MEDIUM
- **Category**: Performance / Cohesion
- **Estimated scope**: 1 TSX file, 5 inline-style edits

## Problem

LicensesPage is the only page that hand-rolls motion in JSX, with three `transition: "all 0.2s"` (animating padding/border-radius/font-size/box-shadow off-GPU on state flips), a row hover at 0.2s where the DS table uses 0.12s, and a usage meter animating layout `width` at a third ad-hoc duration:

```tsx
// src/pages/LicensesPage.tsx:208 — current
<tr key={lic.id} style={{ borderBottom: "1px solid var(--line)", transition: "background 0.2s" }} onMouseEnter={e => e.currentTarget.style.background = "var(--surface-2)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
```

```tsx
// src/pages/LicensesPage.tsx:233 — current
<div style={{ height: "100%", width: `${lic.max_uses === -1 ? 100 : Math.min(100, (lic.usage_count / Math.max(1, lic.max_uses)) * 100)}%`, background: "var(--accent)", transition: "width 0.3s" }} />
```

```tsx
// src/pages/LicensesPage.tsx:291 — current (delete icon button)
                        transition: "all 0.2s"
```

```tsx
// src/pages/LicensesPage.tsx:337 and :343 — current (Standard/Master toggle, both branches)
… boxShadow: !isMaster ? "0 1px 3px rgba(0,0,0,0.1)" : "none", transition: "all 0.2s" }}
```

## Target

Inline styles may reference CSS custom properties — use the repo tokens:

```tsx
// :208 — target (row hover matches DS .data-table 0.12s)
… style={{ borderBottom: "1px solid var(--line)", transition: "background 0.12s" }} …
```

```tsx
// :233 — target (GPU-safe scaleX fill, same mechanics as .progress-fill after plan 006)
<div style={{ height: "100%", width: "100%", transformOrigin: "left", transform: `scaleX(${lic.max_uses === -1 ? 1 : Math.min(1, lic.usage_count / Math.max(1, lic.max_uses))})`, background: "var(--accent)", transition: "transform var(--t-fill) var(--ease-out)" }} />
```

(The parent at :232 already has `overflow: "hidden"` — keep it.)

```tsx
// :291 — target
                        transition: "background var(--t-med) var(--ease-smooth), color var(--t-med) var(--ease-smooth)"
```

```tsx
// :337 and :343 — target (both buttons)
… transition: "background var(--t-med) var(--ease-smooth), color var(--t-med) var(--ease-smooth), box-shadow var(--t-med) var(--ease-smooth)" }}
```

## Repo conventions to follow

- Tokens: `--t-med` 0.18s, `--t-fill` 0.3s, `--ease-smooth`, `--ease-out` (the latter two exist after plan 001 — STOP if `--ease-out`/`--t-fill` are missing).
- Exemplar: `.data-table tbody tr { … transition: background 0.12s; }` (src/theme/css/components.css:266).

## Steps

1. Apply the five inline-style replacements above (:208, :233, :291, :337, :343). At :233, note the width math moves into the scaleX ratio (0–1, no `* 100`), and the element gains `width: "100%"` + `transformOrigin: "left"`.
2. Grep `transition: "all` in src/ — must return zero after this plan.

## Boundaries

- Do NOT restructure the table into DS `.data-table` classes (out of scope; keep JSX inline styling approach).
- Do NOT remove the `onMouseEnter`/`onMouseLeave` hover handlers (functional; only the timing changes).
- Do NOT touch any non-motion inline style property.

## Verification

- **Mechanical**: `npm run typecheck` && `npm run build`; `grep -rn 'transition: "all' src/` → 0 matches.
- **Feel check**: on Licenses — row hover feels identical to other tables; the usage meter fills with a quick left-anchored sweep; toggling Standard/Master crossfades background/color only (no font/padding wobble).
- **Done when**: LicensesPage motion runs entirely on shared tokens with no `all` transitions.
