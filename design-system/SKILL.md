---
name: razorreaper-design
description: Use this skill to generate well-branded interfaces and assets for RazorReaper Console (dark, dense ops/telemetry command-center with a runtime user-themeable accent), either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.
If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.
If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

Hard rules to honor in every output:
- Never hardcode the accent color — compose every accent use from the CSS vars `--ah`/`--as`/`--al` (see tokens/accent.css).
- Status colors are fixed (success/warning/danger/info) and chart series colors come from `--chart-*` tokens — neither follows the accent.
- Dark flat layered surfaces with hairline borders; no glassmorphism, no panel drop shadows, no emoji, Lucide icons only.
- Type: Space Grotesk for titles/numbers, Inter for UI, JetBrains Mono for machine values.
- Custom Dropdown component instead of native selects, always.
