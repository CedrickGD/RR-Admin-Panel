Ranked horizontal share bars — version adoption, top countries, platform split.

```jsx
const { RankList } = window.RazorReaperConsoleDesignSystem_40e0a6;
<RankList items={[
  { label: "1.6.2", value: "144", share: 1 },
  { label: "1.6.1", value: "38", share: 0.26 },
  { label: "Legacy (pre-1.4)", value: "12", share: 0.08 },
]} />
```

- Fills are an accent gradient and grow in with `v2grow` (0.7s, scaleX from left).
- Caller sorts descending and normalizes `share`; bars never render under 2% width.
