Segmented range switcher — standard control for time windows and small mode toggles.

```jsx
const { SegmentedControl } = window.RazorReaperConsoleDesignSystem_40e0a6;
<SegmentedControl
  options={[{ key: "today", label: "24 h" }, { key: "7d", label: "7 d" }, { key: "30d", label: "30 d" }, { key: "90d", label: "90 d" }, { key: "all", label: "All" }]}
  value={range}
  onChange={setRange}
/>
```

- Labels stay terse with a thin space before the unit: "24 h", "7 d" — never "Last 7 days".
- Active state: raised surface + inset accent ring (no fill).
