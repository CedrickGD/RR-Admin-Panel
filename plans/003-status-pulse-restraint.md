# 003 — Status-dot pulses: one live indicator per view, not one per row

- **Status**: DONE
- **Commit**: 798e150
- **Severity**: HIGH
- **Category**: Purpose & frequency / Performance
- **Estimated scope**: 1 TSX file + 2 CSS files

## Problem

`StatusBadge` attaches an infinite 2.5s pulse (opacity + expanding box-shadow ring — a paint-property animation) to EVERY status dot:

```tsx
// src/components/StatusBadge.tsx:10-15 — current
const PRESENCE_STYLES: Record<SessionPresence, { className: string; label: string; dotClass: string }> = {
  online:      { className: "badge badge-success",  label: "Online",       dotClass: "status-dot pulse" },
  idle:        { className: "badge badge-warning",  label: "Idle",         dotClass: "status-dot warn pulse-warn" },
  unreachable: { className: "badge badge-danger",   label: "Unreachable",  dotClass: "status-dot err pulse-err" },
  ended:       { className: "badge badge-muted",    label: "Ended",        dotClass: "status-dot idle" },
};
```

Rendered once per table row on Live (src/pages/LivePage.tsx:269 — a table that re-renders every second), Sessions (src/pages/WorkersPage.tsx:818), Licenses (src/pages/LicensesPage.tsx:241). A 50-row table = 50 simultaneous infinite repaint loops. The design system's own contract says the opposite — src/components/ds/Badge.tsx:6: "LiveBadge pulses — only for genuinely realtime things, one or two per view max." State is already carried by badge color + label; the per-row pulse adds no information.

The pulse rules:

```css
/* src/theme/css/components.css:190-204 — current */
.status-dot.pulse      { animation: status-pulse 2.5s ease-in-out infinite; }
.status-dot.pulse-warn { animation: status-pulse-warn 2.5s ease-in-out infinite; }
.status-dot.pulse-err  { animation: status-pulse-err 2.5s ease-in-out infinite; }
@keyframes status-pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 hsl(142 71% 45% / 0.6); }
  50%      { opacity: 0.7; box-shadow: 0 0 0 4px hsl(142 71% 45% / 0); }
}
@keyframes status-pulse-warn {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 hsl(38 92% 50% / 0.6); }
  50%      { opacity: 0.7; box-shadow: 0 0 0 4px hsl(38 92% 50% / 0); }
}
@keyframes status-pulse-err {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 hsl(4 86% 58% / 0.6); }
  50%      { opacity: 0.7; box-shadow: 0 0 0 4px hsl(4 86% 58% / 0); }
}
```

## Target

Static colored dots in `StatusBadge`; the pulse vocabulary survives only where something is genuinely realtime and singular: `LiveBadge` (`.badge-live::before`, components.css:173-184) and the sidebar ingest dot (`.tn-live-dot`, shell.css:109). The unused `.status-dot.pulse*` rules and keyframes are deleted.

```tsx
// src/components/StatusBadge.tsx — target
  online:      { className: "badge badge-success",  label: "Online",       dotClass: "status-dot" },
  idle:        { className: "badge badge-warning",  label: "Idle",         dotClass: "status-dot warn" },
  unreachable: { className: "badge badge-danger",   label: "Unreachable",  dotClass: "status-dot err" },
  ended:       { className: "badge badge-muted",    label: "Ended",        dotClass: "status-dot idle" },
```

## Repo conventions to follow

- The exemplar of correct restraint already exists: `.tn-live-dot` (one pulsing dot in the sidebar foot, src/components/Navbar.tsx:244) and `LiveBadge` used at most twice per view.

## Steps

1. `src/components/StatusBadge.tsx`: edit the four `dotClass` strings as in the target (drop ` pulse`, ` pulse-warn`, ` pulse-err`). Update the doc comment at lines 5-9 ("with pulsing dot" → "with static colored dot; liveness is carried by LiveBadge / the sidebar ingest dot").
2. Grep `pulse-warn|pulse-err|"status-dot pulse|status-dot pulse` across `src/**/*.tsx` for remaining users. Expected: ErrorsPage.tsx:629, WorkersPage.tsx:654, FeedbackPage.tsx:304 may attach pulse classes directly. For each: if the dot is a per-row/per-item indicator, drop the pulse class token the same way; if it is the single page-level "live" indicator of that view, it may keep pulsing — record the decision in the execution report.
3. When zero `.status-dot.pulse*` users remain in TSX, delete from `src/theme/css/components.css` lines 190–204 (the three `.status-dot.pulse*` rules and the three `status-pulse*` keyframes). Also delete the duplicate legacy copies in `src/index.css` (rules at ~382, ~392, ~399 and keyframes at ~387, ~394, ~401) — verify by grep first; plan 008 also lists them, so skip silently if already gone.
4. Leave `.status-dot`, `.status-dot.warn`, `.status-dot.err`, `.status-dot.idle` (components.css:186-189) untouched.

## Boundaries

- Do NOT touch `.badge-live::before` / `live-pulse` (components.css:173-184) or `.tn-live-dot` / `v2pulse` (shell.css:103-110).
- Do NOT change badge colors, labels, or markup structure.
- If a grep-expected site is absent, note it and continue; if extra pulse users exist beyond the listed files, apply the same per-row vs page-level rule.

## Verification

- **Mechanical**: `npm run typecheck` && `npm run build` pass. `grep -rn "status-pulse" src/` → zero matches (or only a justified page-level keeper documented in the report).
- **Feel check**: open Sessions with many rows — table is calm, badges are colored but still; the sidebar "Ingest online" dot still pulses; the Live page's LiveBadge still pulses.
- **Done when**: at most one or two pulsing elements exist per view, matching the Badge.tsx contract.
