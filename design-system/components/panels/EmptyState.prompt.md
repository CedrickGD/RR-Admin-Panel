Empty states: a neutral icon-well variant for "no data yet", and a glowing green `allClear` ring for "no errors" (good news is celebrated, not greyed out).

```jsx
const { EmptyState } = window.RazorReaperConsoleDesignSystem_40e0a6;
<EmptyState icon="radio" title="No active sessions">No sessions seen in the last 6 minutes. Check back soon.</EmptyState>
<EmptyState allClear>No failures in the selected range. New errors surface here within seconds of ingest.</EmptyState>
```

- Body copy is one factual sentence + what happens next; never apologetic.
