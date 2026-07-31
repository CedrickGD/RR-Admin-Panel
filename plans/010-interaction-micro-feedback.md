# 010 — Micro-feedback: the spinner that never spun + four gated opportunities

- **Status**: DONE
- **Commit**: 798e150
- **Severity**: MEDIUM (spinner is a straight bug) / LOW (the rest)
- **Category**: Missed opportunities / Feedback
- **Estimated scope**: 2 CSS files + 3 TSX files, all small

## Problem

**A. The refresh spinner never spins.** Four sites apply `className="animate-spin"`; the class is defined nowhere (no Tailwind utilities ship in this build). The app even holds `refreshing` true for a minimum 550ms (src/hooks/useDashboard.ts, `minVisibleMs`) specifically so this feedback is visible — and it renders frozen:

- src/App.tsx:63 — `<RefreshCw size={15} className={refreshing ? "animate-spin" : undefined} />`
- src/App.tsx:108 — `<RefreshCw className="h-5 w-5 animate-spin" />`
- src/components/Navbar.tsx:180 — same pattern
- src/pages/ErrorsPage.tsx:439 — `icon={<RefreshCw className={loading ? "animate-spin" : undefined} />}`

**B. Copy-to-clipboard confirmation hard-cuts** (Settings backend panel):

```tsx
// src/pages/SettingsPage.tsx:149-155 — current
{copied === k ? (
  <span className="kv-copied">
    <Check size={12} /> Copied
  </span>
) : (
  v
)}
```

`.kv-copied` (app-glue.css:332) has no entrance.

**C. Login error banner materializes cold.** The card speaks `v2-rise`; the error is the one element that teleports in (`src/components/LoginForm.tsx:85`, `.inline-error` styled at app-glue.css:474-480 / index.css). Rare surface — eligible. No shake (a crisp ops console does not shake).

**D. Skeleton → content swap hard-cuts** on Errors/Workers tables (fires on range switches too, not just first load). Fade-only bridge — deliberately NO translate: the user is about to click these rows.

**E. Empty states render flat**, including `allClear` — the app's single genuine good-news moment ("No failures in range", src/components/ds/EmptyState.tsx:28-41) — which is exactly where the delight budget lives.

## Target

```css
/* src/theme/css/components.css — target: add next to .spinner (~line 464) */
.animate-spin { animation: spin 0.7s linear infinite; }
```

```css
/* src/theme/app-glue.css — target: extend .kv-copied (~line 332) and add keyframes nearby */
.kv-copied { display: inline-flex; align-items: center; gap: 4px; color: var(--success-text); animation: kv-pop 0.13s var(--ease-pop); }
@keyframes kv-pop {
  from { opacity: 0; transform: scale(0.9); }
  to   { opacity: 1; transform: none; }
}
```

(`--ease-pop` is the repo's one bouncy curve, reserved for rare delight — a copy confirmation qualifies.)

```css
/* src/theme/app-glue.css — target: with the other .auth-card rules (~line 474) */
.auth-card .inline-error { animation: v2rise var(--t-med) var(--ease-rise) backwards; }
```

(merge into the existing `.auth-card .inline-error` rule at app-glue.css:474-480 — add the `animation:` line.)

```css
/* src/theme/css/components.css — target: table-settle utility, near .skeleton */
.dt-settle { animation: dt-settle var(--t-med) var(--ease-out); }
@keyframes dt-settle {
  from { opacity: 0.4; }
  to   { opacity: 1; }
}
```

```tsx
// src/pages/ErrorsPage.tsx (~line 550) and src/pages/WorkersPage.tsx (~line 597) — target pattern:
// the <tbody> (or the row-list wrapper actually containing SkeletonRows vs real rows)
// gains className="dt-settle" and key="loaded" ONLY on the loaded branch, so the fade
// plays once each time skeletons are replaced by data:
{rows === null ? (
  <tbody key="loading"><SkeletonRows /></tbody>
) : (
  <tbody key="loaded" className="dt-settle">
    {rows.map((user) => { … })}
  </tbody>
)}
```

(Adapt to the actual local structure — if `SkeletonRows` and rows already share a `<tbody>`, put `key`/`className` on that tbody with the conditional. The mechanism that matters: element remounts with `.dt-settle` when data arrives.)

```css
/* src/theme/css/components.css — target: extend empty-state rules (~lines 396, 419) */
.empty-state { …existing props…; animation: v2rise 0.2s var(--ease-rise) backwards; }
.empty-ring  { …existing props…; animation: ring-pop 0.26s var(--ease-pop) 0.06s backwards; }
@keyframes ring-pop {
  from { opacity: 0; transform: scale(0.9); }
  to   { opacity: 1; transform: none; }
}
```

## Repo conventions to follow

- `spin` keyframes already exist in components.css:473 — `.animate-spin` reuses them.
- `v2rise` / `--ease-rise` / `--t-med` are existing vocabulary; `--ease-out` from plan 001 (STOP if missing).
- `backwards` fill (not `both`) per plan 001's convention.

## Steps

1. components.css: add `.animate-spin` next to `.spinner`.
2. app-glue.css: add `animation: kv-pop …` to `.kv-copied` + the `kv-pop` keyframes.
3. app-glue.css: add the `animation:` line to `.auth-card .inline-error`.
4. components.css: add `.dt-settle` + keyframes; wire the loaded-branch className/key in ErrorsPage.tsx and WorkersPage.tsx as described (both tables; WorkersPage has two table sections — apply to the sessions table at ~597; the second listing at ~800s only if it has the same skeleton swap).
5. components.css: add the two `animation:` lines to `.empty-state` / `.empty-ring` + `ring-pop` keyframes.

## Boundaries

- No shake animations anywhere.
- Do NOT animate `.gdrop-item`, table sorting, or live-feed row insertions (rejected: frequency/function gates).
- Do NOT touch SettingsPage.tsx logic (the 1800ms revert timer stays).

## Verification

- **Mechanical**: `npm run typecheck` && `npm run build`; `grep -rn "animate-spin" src/theme src/index.css` → exactly 1 definition.
- **Feel check**: click refresh — the icon actually rotates for the ≥550ms window. Copy a commit SHA in Settings — "✓ Copied" pops in with a tiny bounce. Fail a login — the error rises in with the card's vocabulary. Switch the Errors range — rows fade from 40% to full instead of blinking. Filter a table to zero — the empty state rises gently; on an all-clear Errors view the green ring pops 60ms after the block lands.
- **Done when**: all five micro-moments fire and nothing else gained motion.
