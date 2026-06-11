Pill badges for counts and states; `LiveBadge` adds the pulsing green dot for genuinely realtime data.

```jsx
const { Badge, LiveBadge } = window.RazorReaperConsoleDesignSystem_40e0a6;
<Badge tone="danger">4 errors</Badge>
<Badge tone="muted">1.6.2</Badge>
<LiveBadge>3 live</LiveBadge>
```

- Status tones (success/warning/danger/info) are fixed brand colors and never follow the accent hue; `accent` does.
- Version numbers in tables render as `muted` badges.
- Use `LiveBadge` sparingly — it pulses, so one or two per view max.
