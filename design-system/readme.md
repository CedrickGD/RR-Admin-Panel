# RazorReaper Console — Design System

The design system for **RazorReaper Console**: the private operations/telemetry
dashboard for RazorReaper, a Windows desktop gaming tool (ARK: Survival Evolved
utilities) with roughly **220 users**. The console is built for a **single admin
power-user** who monitors live sessions, traffic trends, version adoption, a world
heatmap, per-user troubleshooting (errors, Discord identity) and feature usage.

**Aesthetic in one line:** clean, quiet, premium glass command-center — a slowly
drifting violet/cyan aurora behind icy frosted translucent panels, crisp ice
hairlines, strong Space Grotesk numbers, one user-themeable accent, purposeful
motion. Dark cool-tinted glass — never milky white washes.

## Sources

- **GitHub:** [CedrickGD/RR-Admin-Panel](https://github.com/CedrickGD/RR-Admin-Panel) —
  the production implementation (React 19 + Vite, plain CSS in `src/index.css` +
  `src/theme-v2.css`, Cloudflare Pages/D1 backend). This system consolidates the
  v2 theme (which "owns the final word on every surface") with the base layer.
  Explore the repo for anything not covered here — page compositions live in
  `src/pages/*.tsx`, widgets in `src/components/`, accent/chart-preset hooks in
  `src/hooks/`. Reading it will make your designs better.
- Icons: [lucide-icons/lucide](https://github.com/lucide-icons/lucide) (the app uses
  `lucide-react`); 60 SVGs copied into `assets/icons/`.

## THE one non-negotiable rule

**The accent is user-themeable at runtime.** The user picks any hue (0–360) in
Settings; it's stored as CSS vars `--ah` / `--as` / `--al` (current default: violet,
hue 262). **Never hardcode an accent color.**

```css
color: var(--accent);                                 /* solid */
background: hsl(var(--ah) var(--as) var(--al) / 0.12); /* alpha — compose from vars */
```

Two corollaries:
- **Status colors are fixed** and never follow the accent: success `hsl(142 71% 45%)`,
  warning `hsl(37 91% 55%)` (#f5a524), danger `hsl(4 86% 58%)` (#f04438).
- **Chart series colors are a separate user preset** (`--chart-users`,
  `--chart-sessions`, `--chart-errors`) — charts never use the accent for data.

## CONTENT FUNDAMENTALS

- **Voice:** terse, factual, operator-to-operator. No marketing, no exclamation
  marks, **no emoji**. The reader is one expert admin.
- **Casing:** Title Case for nav/titles/labels/kv keys ("Live Sessions", "Last
  Ingest"); sentence case for subtitles and notes. Kickers and micro-labels render
  uppercase via CSS ("PRODUCTION OPERATIONS", "SESSION TIMELINE").
- **Numbers first:** values are formatted ("1,284", "42m 18s", "2m ago") and set in
  Space Grotesk with tabular digits. Units get a thin space: "24 h", "7 d".
- **Honest data framing:** copy always states the window and caveats —
  "In range · 5,931 all-time", "limited to 7d range", "Legacy install-scoped
  pseudo-sessions (install:*) are excluded from the average." Never vague.
- **Explain the rule, not the feature:** "Active sessions from the last 6 minutes.
  Rows hold stable order while you read." / "'today' is a rolling last-24-hours
  window server-side, so label it honestly: 24 h."
- **Empty states are confident:** "All clear — No failures in the selected range.
  New errors surface here within seconds of ingest." Good news gets a glowing
  green ring, not grey sadness.
- **Machine values verbatim** in mono: `s_9f2e81c4`, `install:7d3a-91bb`, `d4f81c2`,
  `D1`, `UTC fixed`. Unknowns are "—" or "Unknown", never blank.
- **Separator:** middots ("d1 · v1.6.2 · ingest 2m ago").
- Discord identity matters: handles render as muted `@name` suffixes; Rich
  Presence as a tiny accent "RPC" badge.

## VISUAL FOUNDATIONS

- **Ground & aurora:** deep blue-black ground `#05060c` with a **slowly drifting
  violet/cyan aurora** (`--aur-1: 263`, `--aur-2: 191`) — two soft gradient fields
  on `html::before/::after`, transform-only loops (64s/84s), automatic on every
  page, gated by `prefers-reduced-motion`. The aurora hues are ambience tokens,
  separate from the accent.
- **Surfaces are frosted glass:** translucent cool-tinted fills + `backdrop-filter:
  blur(var(--glass-blur))` — `--surface-1` (panels, /0.40) → `--surface-2`
  (hover/buttons, /0.48) → `--surface-3` (inset/active, /0.55). **Never milky:**
  glass is always dark and cool-tinted, never white-washed. No background images,
  no patterns. Ad-hoc boxes can use the `.glass` utility.
- **Borders & depth:** crisp ice hairlines do the rest of the depth work —
  `--line` (cool /0.11), brightening to icy-cyan `--line-hi` (/0.22) on hover.
  **Panels have no drop shadows** — frost is the depth. Only floating surfaces
  (dropdown menus, modals) get one big soft black shadow on near-opaque frosted
  glass (`--surface-float`).
- **Type:** Space Grotesk (700, tight tracking) for titles and every number worth
  reading; Inter for all UI text (13px workhorse, floor 10px); JetBrains Mono for
  machine values. Two uppercase micro-voices: accent `.kicker` (+0.18em) and
  muted `.label-sm` (+0.12em).
- **Radii:** one family — 12px panels/tiles/modals, 9px controls, 8px inner
  elements, pill for badges/tracks, circles for dots/swatches.
- **Signature accents:** the active top-nav item gets a **glowing accent tick on
  the navbar's bottom edge**; every KPI tile carries a 2px accent tick on its
  left edge that sharpens on hover. The brand lockup's undertitle renders in
  `--accent-text`. Accent glows multiply by `--glow` (set 0 to
  disable all glow).
- **Hover:** surface steps up one level + hairline brightens + at most a 1px lift.
  Press states don't shrink. Focus: accent border + 3px `--accent-subtle` ring.
- **Motion:** fast and purposeful. Entrances rise 10px with 40ms stagger
  (`v2rise` 0.4s, ease `--ease-rise`); values pop with slight overshoot
  (`v2pop`); share bars grow from the left (`v2grow` 0.7s); panels collapse via
  animated `grid-template-rows` (0.32s). Pulses (2–2.8s) are reserved for live
  dots and map nodes. Everything respects `prefers-reduced-motion`. No bounces,
  no infinite decorative loops.
- **Charts:** smooth glowing area lines + rounded translucent bars over a dashed
  grid; dark tooltip card with cursor line and per-series glow dots. Colors from
  `--chart-*` tokens only.
- **Density:** 14px between panels, 10px inside KPI grids, 16px panel padding,
  54px sticky top navbar (`--nav-h`). KPI grids declare explicit column counts
  (`.stat-grid-6`) so rows run flush with panels below.
- **Imagery:** none. No photos or illustrations — the data is the imagery. The
  only bitmap is the logo. The production heatmap is a MapLibre dark map with
  pulsing accent nodes.

## ICONOGRAPHY

- **System:** [Lucide](https://lucide.dev) stroke icons exclusively (the app uses
  `lucide-react`). 60 SVGs are copied verbatim into `assets/icons/`, and the same
  geometry is inlined in the `Icon` component (`components/icons/iconPaths.js`).
- **Style:** 24×24 viewBox, stroke 2, round caps/joins, `currentColor`. Sizes in
  use: 16px navbar items & buttons/empty states, 14px table actions, 12px
  kickers.
- **No emoji, no custom SVG art, no icon fonts.** Unicode is limited to
  typographic marks: middots, °, ×, —, @.
- Canonical nav mapping: Overview `chart-no-axes-column`, Traffic `clock-3`,
  Versions `layers`, Heatmap `map`, Live `radio`, Sessions `history`, Errors
  `triangle-alert`, Settings `settings-2`.
- Note: the repo's older lucide-react names map to current Lucide names
  (BarChart3 → `chart-no-axes-column`, AlertTriangle → `triangle-alert`,
  Globe2 → `earth`, Maximize2 → `maximize-2`).

## Index

```
styles.css                 ← global entry point (link this one file)
tokens/                    ← fonts (Google Fonts), accent, colors, typography, spacing
css/                       ← base (aurora + glass), shell (top navbar), controls, components
assets/logo.ico            ← RR brand mark (also the favicon)
assets/icons/*.svg         ← 60 Lucide icons
guidelines/*.card.html     ← foundation specimen cards (Colors / Type / Spacing / Brand)
components/
  shell/       TopNav · PageHeader · MetaRow
  panels/      Panel · Modal · TimespanGrid · BreakdownList · EmptyState
  controls/    Button · IconButton · SegmentedControl · Dropdown · SearchInput
  indicators/  Badge · LiveBadge · StatusBadge · Tag · Spinner
  metrics/     KpiTile · Sparkline · RadialGauge · RankList
  charts/      TrendChart
  tables/      DataTable · DetailGrid · KvList · Feed
  icons/       Icon (+ iconPaths.js)
ui_kits/console/           ← interactive console recreation (see its README)
SKILL.md                   ← agent-skill entry point
```

Every component ships `<Name>.jsx` + `<Name>.d.ts` (props contract) +
`<Name>.prompt.md` (usage). Read the prompt files before composing screens.

## Building a new console page (recipe)

1. `v2-shell` → `TopNav` (sticky frosted navbar) + `main.v2-main` →
   `.page-content.page-stack-lg`.
2. `PageHeader` with a kicker naming the page's mandate; filters right
   (`SegmentedControl` ranges + `Dropdown`s — never native selects).
3. A `.stat-grid.stat-grid-N.v2-stagger` row of `KpiTile`s sized to the page.
4. Panels below: `main-side` split (chart left; `KvList`/`Feed` side stack right)
   or `flush` `DataTable` for directories.
5. State the data window in every sub line. Wire any new color to tokens.
