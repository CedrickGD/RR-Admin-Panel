Compact page header — kicker over a short Space Grotesk title, controls right. The header row stays lean; subtitles are considered filler in v2.

```jsx
const { PageHeader, MetaRow } = window.RazorReaperConsoleDesignSystem_40e0a6;
<PageHeader
  kicker="Realtime"
  title="Live Sessions"
  right={<>
    <LiveBadge>3 live</LiveBadge>
    <MetaRow items={[{ label: "Live Errors", value: "1" }, { label: "Updated", value: "8s ago" }]} />
  </>}
/>
```

- Titles are 1–2 words; the kicker states the page's mandate ("Production Operations", "Configuration").
- `MetaRow` pairs an uppercase micro-label with a Space Grotesk value — also used in panel heads.
