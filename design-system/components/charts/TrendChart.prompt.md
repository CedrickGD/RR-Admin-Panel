Large time-series chart for traffic panels — smooth glowing area lines over rounded bars, dashed grid, dark hover tooltip with cursor line. Dependency-free SVG (production uses recharts; this matches its look).

```jsx
const { TrendChart } = window.RazorReaperConsoleDesignSystem_40e0a6;
<TrendChart
  data={hours} // [{ label: "14:00", users: 6, started: 2, errors: 0 }, …]
  areas={[
    { key: "users", name: "Active users", color: "var(--chart-users)" },
    { key: "errors", name: "Errors", color: "var(--chart-errors)", strokeWidth: 1.8 },
  ]}
  bars={[{ key: "started", name: "New sessions", color: "var(--chart-sessions)" }]}
/>
```

- IMPORTANT: chart series colors come from the `--chart-*` tokens (a separate user preset), never from the accent.
- Wrap in a `Panel` with a `chart-wrap chart-wrap-tall` body div; pair with a `SegmentedControl` of time windows in the panel head.
- Lines carry a faint white drop-shadow glow; hover shows per-series dots + tooltip card.
