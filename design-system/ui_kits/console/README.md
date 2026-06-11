# UI Kit — RazorReaper Operations Console

Interactive recreation of the production admin console (React 19 + plain CSS in the
real app; React 18 UMD + the design-system bundle here). Open `index.html`.

## What's recreated

| Page | Status |
|---|---|
| Overview | ✅ KPI row (drill-down modals work), traffic TrendChart with window seg-control, System Context kv list, Recent Errors feed |
| Versions | ✅ Adoption KPIs, rank bars, radial gauges, top countries |
| Live | ✅ Sessions table with Discord identity, RPC badges, presence, expandable row → timeline + DetailGrid |
| Errors | ✅ Error KPIs, grouped failures table, all-clear empty state (toggle "Clear list") |
| Settings | ✅ Identity/backend kv panels, working accent hue picker (persists), chart color presets (live) |
| Traffic / Heatmap / Sessions | ⛔ intentional placeholders — Heatmap is a MapLibre map in production; Traffic/Sessions reuse patterns already shown |

## Interactions to try

- Navigate via the top navbar; the active item gets the glowing accent tick on the bar's bottom edge.
- Click the **Sessions** or **Avg Session** KPI tile on Overview → drill-down modal.
- Hover the traffic chart → cursor line + tooltip; collapse the panel via its head.
- Expand a row on **Live** → session timeline with error marker + mono detail grid.
- **Settings → Accent Color**: pick any hue — the entire console re-themes (persists to localStorage).
- **Settings → Chart Colors**: presets recolor the Overview chart via `--chart-*` tokens.

## Source of truth

`CedrickGD/RR-Admin-Panel` — `src/pages/*.tsx`, `src/index.css`, `src/theme-v2.css`.
This kit composes the design-system components in `../../components/` and contains no
bespoke styling beyond layout glue.
