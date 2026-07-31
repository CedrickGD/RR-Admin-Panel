# 011 — Table row expand: unfold instead of teleport

- **Status**: DONE
- **Commit**: 798e150
- **Severity**: MEDIUM
- **Category**: Missed opportunity (preventing a jarring change)
- **Estimated scope**: 2 TSX files (3 sites) + 1 CSS file

## Problem

Expanding a table row pops a ~300px detail block into the middle of a table the user is reading, shoving every row below it with zero bridge. Collapse is equally instant.

```tsx
// src/pages/ErrorsPage.tsx:643 (same shape at src/pages/WorkersPage.tsx:681 and :832) — current
{isExpanded ? (
  <tr>
    <td colSpan={USER_COLUMN_COUNT} className="row-expand-panel">
      <div className="row-expand-inner">
```

`.row-expand-panel` (src/theme/css/components.css:274) has no transition. The repo already ships the correct mechanism — CollapsiblePanel's grid-rows clip (components.css:48-54), fully interruptible.

## Target

The detail `<tr>` renders whenever the row has been expanded at least once; a grid-rows clip animates open/collapse and retargets mid-motion. Zero new vocabulary — same tokens and technique as CollapsiblePanel.

```css
/* src/theme/css/components.css — target: add next to .row-expand-panel (~line 274) */
.row-expand-clip {
  display: grid;
  grid-template-rows: 1fr;
  transition: grid-template-rows var(--t-collapse) var(--ease-smooth);
}
.row-expand-clip[data-collapsed="true"] { grid-template-rows: 0fr; }
.row-expand-clip > .row-expand-inner { overflow: hidden; min-height: 0; }
.row-expand-td { padding: 0 !important; }
.row-expand-collapsed .row-expand-panel { border-top-color: transparent; }
```

```tsx
// target pattern per site (adapt names to local scope):
// keep a "has ever expanded" memory so unexpanded rows keep costing nothing:
const [expandedEver, setExpandedEver] = useState<Set<string>>(new Set());
// when toggling open: setExpandedEver(prev => prev.has(id) ? prev : new Set(prev).add(id));

{expandedEver.has(rowId) ? (
  <tr className={isExpanded ? undefined : "row-expand-collapsed"}>
    <td colSpan={USER_COLUMN_COUNT} className="row-expand-panel row-expand-td">
      <div className="row-expand-clip" data-collapsed={isExpanded ? "false" : "true"}>
        <div className="row-expand-inner">
          {/* existing detail content unchanged */}
        </div>
      </div>
    </td>
  </tr>
) : null}
```

Notes for the executor:
- `.row-expand-inner` already carries `padding: 14px 16px` (components.css:275) — that padding must live INSIDE the clip (it does, `.row-expand-inner` is the clip's child), so the collapsed state clips it away; the `<td>` itself gets `padding: 0` via `.row-expand-td` so nothing leaks height while collapsed.
- First expansion mounts the `<tr>` already-collapsed is NOT required: mounting with `data-collapsed="false"` straight away is acceptable (grid transition from 0fr requires a prior frame; to get the animation on FIRST open, mount the tr with `data-collapsed="true"` and flip to `"false"` in a `requestAnimationFrame` — implement this via a tiny local component or effect; CollapsiblePanel.tsx:99-106 shows the repo's mounted-children contract to imitate).
- On collapse, content stays mounted (that's what makes reopen + interruption smooth).

## Repo conventions to follow

- Tokens: `--t-collapse` 0.32s + `--ease-smooth` — identical to `.panel-body-clip` (components.css:48-53), the in-repo exemplar.
- The mounted-children tradeoff is documented at CollapsiblePanel.tsx:100 — mirror that comment style at each site.

## Steps

1. components.css: add the five rules above next to `.row-expand-panel`.
2. ErrorsPage.tsx (~643): apply the pattern (per-row expand key is the user/session id used by `isExpanded` today).
3. WorkersPage.tsx (~681 and ~832): apply the same pattern to both expand sites.
4. `npm run typecheck` after each file.

## Boundaries

- Do NOT animate row sorting, filtering, or insertion.
- Do NOT modify DetailGrid or the detail content itself.
- Do NOT keep detail content mounted for rows never expanded (memory/DOM cost on 50-row tables).
- If the local expand logic differs materially from the excerpt (e.g. accordion-style single-expand), keep its semantics and only add the clip layer; report the difference.

## Verification

- **Mechanical**: `npm run typecheck` && `npm run build`.
- **Feel check**: expand a session row — the detail unfolds over ~320ms pushing rows down smoothly; click again mid-open — it reverses from wherever it was (no restart); with DevTools animations at 10%, confirm the fold clips content rather than squashing it.
- **Done when**: all three sites unfold/refold interruptibly and collapsed rows add no visible height.
