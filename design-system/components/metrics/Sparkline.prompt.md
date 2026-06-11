Tiny inline area sparkline — lives on the right side of KPI tiles.

```jsx
const { Sparkline } = window.RazorReaperConsoleDesignSystem_40e0a6;
<Sparkline values={[3, 5, 4, 8, 7, 11, 9]} />
```

- 1.5px line + soft vertical fade fill; no axes, no dots.
- Color defaults to the accent; error sparks use `var(--chart-errors)`.
