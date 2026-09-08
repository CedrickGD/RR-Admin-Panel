/* The accent preset list. Nothing else: useAccent(), useBackgroundOffset() and
   the applyHue()/localStorage plumbing that used to live here were exported but
   called by nothing, and applyHue had grown into a second writer of --ah/--al/
   --on-accent/--accent-text — off a per-browser key and a theme sniffed from the
   DOM, next to useAppearance.apply(), which is per-account and server-synced.
   Two hooks fighting over the accent was one call away; the file is data now.
   (Kept at this path: SettingsPage imports ACCENT_PRESETS from here.) */

export interface AccentPreset {
  label: string;
  hue: number;
}

/* Readability is no longer a reason to drop a hue: utils/accentContrast derives
   --al, --on-accent and --accent-text per hue, so gold, green, teal and cyan now
   clear WCAG AA (they get a hue-tinted dark ink on the accent instead of white).
   One band stays out of the presets — the custom slider still allows any hue:
   - semantics: ~355–15° is --danger's hue (hsl(4 86% 58%) dark / #cb3535 light) and
     ~15–45° is --warning's. An accent there makes primary buttons, links and focus
     rings indistinguishable from error and warning states, which no amount of
     contrast tuning fixes. Red and Orange are therefore deliberately absent. */
export const ACCENT_PRESETS: AccentPreset[] = [
  { label: "Green",   hue: 142 },
  { label: "Teal",    hue: 160 },
  { label: "Cyan",    hue: 186 },
  { label: "Blue",    hue: 221 },
  { label: "Indigo",  hue: 240 },
  { label: "Purple",  hue: 262 },
  { label: "Pink",    hue: 330 },
];
