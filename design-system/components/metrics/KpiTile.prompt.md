KPI stat tile — the console's signature metric card: uppercase micro-label, Space Grotesk value, one-line sub, sparkline or icon well on the right, accent tick on the left edge.

```jsx
const { KpiTile } = window.RazorReaperConsoleDesignSystem_40e0a6;
<KpiTile label="Sessions" value="1,284" sub="In range · 5,931 all-time" spark={[4,7,5,9,8,12]} drilldown={{
  timespans: [{ label: "Today", value: "18" }, { label: "7 d", value: "124" }, { label: "Lifetime", value: "5,931" }],
  breakdown: [{ label: "Windows 11", value: "912", share: 0.71 }],
  breakdownTitle: "Sessions by platform",
}} />
<KpiTile label="Errors" value="0" sub="Last 24 hours" tone="success" icon="triangle-alert" />
```

- Tiles sit in `.stat-grid stat-grid-6` (or -4/-7) rows that run flush with the panels below.
- The value pops (v2pop) on change; hover lifts 1px and sharpens the accent tick.
- Sub copy states the time window honestly: "In range", "Last 24 hours" — never vague.
