Threaded activity/error feed — ringed dots on a hairline spine, truncated titles, mono relative timestamps.

```jsx
const { Feed } = window.RazorReaperConsoleDesignSystem_40e0a6;
<Feed items={[
  { title: "NullReferenceException", meta: "overlay_renderer · Object reference not set", time: "2m", tone: "bad" },
  { title: "Session started", meta: "wraith#2041 · 1.6.2 · Germany", time: "9m", tone: "ok" },
  { title: "Version 1.6.2 released", meta: "44% adoption in 48h", time: "2d", tone: "accent" },
]} />
```

- Tones ring the dot only (ok/bad/accent); the dot core stays dark.
- Use inside `<Panel padding="tight">`; titles truncate, never wrap.
