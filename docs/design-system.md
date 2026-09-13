# Razor Reaper: transparent workspace design system

## Direction

Extend the panel's existing transparent identity. The selected background and
account accent remain part of the interface, including behind work cards.
Improve hierarchy with spacing, type, grouping, and restrained accent edges,
not with a replacement grey palette or opaque slabs.

This first adoption covers the customer directory and Customer 360. Other
workspaces keep their existing styles. The implementation is local until a
separate deployment is requested.

## Source of truth

Use the existing theme tokens from `src/theme/tokens/colors.css`. The scoped
extension lives in `src/theme/customer-glass.css`, loaded after
`src/theme/consistency.css`. Add `customer-glass` to an adopting workspace root;
do not replace global surface tokens to restyle a single page.

| Role | Token | Rule |
| --- | --- | --- |
| Transparent work surface | `--workspace-surface` | Existing black 32% in dark mode, white 60% in light mode |
| Stronger reading surface | `--workspace-surface-strong` | Existing black 55% / white 82%; not the default for every card |
| Borders | `--line`, `--line-hi` | Keep the theme's contrast ladder |
| Primary text | `--text-1` | Names and values |
| Supporting text | `--text-2`, `--text-3` | Context and labels |
| Interaction | `--accent`, `--accent-text`, `--accent-subtle` | Follow the user's accent choice |
| Status | Existing success, warning, danger, info tokens | Never recolor status meaning to match the accent |
| Pinned and floating content | Existing coverage tokens | Preserve legibility over scrolling records |

The `--glass-1`, `--glass-2`, and `--glass-3` aliases resolve to opaque surfaces
in this project. Do not use them as a shortcut for transparent cards.

## Scoped surface recipe

| Extension token | Value |
| --- | --- |
| `--record-glass-fill` | `var(--workspace-surface)` |
| `--record-glass-edge` | 12% existing accent mixed with the existing border |
| `--record-glass-tint` | 5% existing accent mixed with transparency |
| `--record-glass-sheen` | 6% primary text color mixed with transparency |
| `--record-glass-radius` | 12px |
| `--record-glass-padding` | 18px, 14px on phones |
| `--record-glass-gap` | 16px, 14px on phones |

Use a faint diagonal accent wash over the transparent fill, a fine border,
and a single inset highlight. The identity card adds a 2px accent edge. Avoid
large glows, repeated colored badges for neutral data, and decorative motion.

Do not add backdrop blur. This project deliberately disables frost; preserve
that performance choice and the existing reduced-motion behavior.

## Composition and existing components

- Reuse `PageHeader`, `PageToolbar`, `CollapsiblePanel`, and `TableFrame` for the directory.
- Keep one filter location directly above the records and retain all sorting, pagination, and row actions.
- Keep the shared KPI geometry and its helpful copy; reduce surrounding gaps instead of inventing a second tile system.
- Use the existing `RecordCell` hierarchy for customer names and supporting details.
- In Customer 360, show Identity before Key figures in the existing summary rail.
- Group overview facts into App & device and Location & activity using the existing `SectionHeading` and `InfoGrid` primitives.
- Keep the transparent tab underline pattern and the existing workspace scroll container.
- Do not introduce new charts, requests, permissions, or business logic for a visual refinement.

## Background and layering

Only ordinary work cards receive the transparent surface recipe. Do not make
the fixed customer workspace root transparent: it must separate the workspace
from the route underneath while its own `PanelBackground` renders the scene.

Keep sticky table headers, pinned action cells, dropdowns, dialogs, and the
sticky workspace chrome on their established coverage rules. Do not apply
blanket transparent backgrounds to their descendants; overlapping text is not
an acceptable tradeoff for transparency.

## Responsive behavior

Preserve the existing sidebar breakpoints, workspace offsets, and the 320px
desktop identity rail. Overview groups fit available space and stack when two
260px groups no longer fit. Facts use two flexible columns, falling back to
one below 360px. Long values may wrap instead of clipping.

Retain the directory's stacked mobile table, shared two-column KPI behavior,
and existing mobile input font-size floor. Customer name links have a 44px
minimum touch height on phones. No hover-only action is introduced.
