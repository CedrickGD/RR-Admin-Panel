# Ambience reference — frosted glassmorphism KPI dashboard (owner-supplied image, 2026-06-11)

The owner supplied a reference screenshot (INNORAFT-style frosted glass dashboard) and wants the
console's ambience tuned toward it. This OVERRIDES the quieter ambience defaults of the design
system where they conflict; everything else in the DS (structure, components, icons, voice) stands.

## What the reference shows

- **Ground:** pure black (#000–#05060c) with VIVID flowing aurora fields, not a quiet drift:
  - bottom-left: saturated violet/purple (hue ~270)
  - center sweep: hot pink → red (hue ~340–355) flowing diagonally behind the main card
  - top-right: orange → yellow (hue ~25–55) large field
  - The colors are bold and saturated, clearly visible, but soft-edged (no hard shapes).
- **Glass:** heavy frost — large blur (24–28px), panel fills translucent enough that the aurora
  colors clearly BLEED THROUGH the cards (alpha ~0.35–0.45 dark fill), subtle 1px white border
  rgba(255,255,255,0.10–0.14), inner top highlight. Cards read as "smoked glass over neon".
- **Radii:** very rounded — ~20–24px card corners.
- **Type:** huge hero numbers (the KPI values dominate the card), clean white; labels small and
  bold below/above the number. Keep Space Grotesk for numbers.
- **Icons:** simple line icons (stroke style — lucide fits perfectly), large in stat contexts.
- **Donut gauge:** vivid multi-color conic-gradient ring (pink → orange → yellow) on a dark track,
  value + label centered. Apply this treatment to RadialGauge.
- **Buttons/nav pills:** clean white pill for the primary action / active nav item (white bg,
  dark text); inactive items plain text on glass.

## How to apply (ambience pass, post-DS-adoption)

Tune in `src/theme/app-glue.css` (do NOT edit the verbatim DS files):

1. Aurora override: restyle the aurora layers (html::before/::after or an extra fixed layer) to
   3 fields — violet (--aur hue ~270) bottom-left, pink/red (~345) center diagonal, amber (~40)
   top-right; raise saturation/intensity well above the DS defaults (DS is "deliberately quiet";
   the owner wants bold). Keep transform-only animation loops + prefers-reduced-motion gating.
   Respect --glow as the intensity multiplier.
2. Frost: bump --glass-blur to ~26px; lower panel fill opacity slightly so color bleeds through
   (but keep text contrast ≥ WCAG-ish on the darkest areas — dark tint stays).
3. Radii: panels/tiles ~20px (override --r-panel/--r-tile equivalents in app-glue).
4. KPI values: bump .stat-value scale (≥1.6rem on standard tiles; hero tiles can go larger).
5. RadialGauge: conic-gradient ring (use chart tokens / a fixed pink→orange→yellow ramp is
   acceptable here since it is ambience, not data encoding — but prefer composing from
   --chart-* tokens where it doesn't look muddy).
6. Active nav / primary buttons: white pill treatment (white bg, near-black text) like the image.
7. NEVER milky white panel washes — the glass stays dark-tinted; the COLOR comes from the aurora
   behind it, not from the panel fill.

The accent stays user-themeable (--ah/--as/--al); the aurora hues are ambience tokens and may be
multi-hue fixed values per above.
