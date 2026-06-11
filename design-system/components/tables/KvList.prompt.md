Key-value rows for config/context panels — keys in Inter, values in JetBrains Mono or as Tag chips.

```jsx
const { KvList } = window.RazorReaperConsoleDesignSystem_40e0a6;
<KvList items={[
  { k: "Traffic Clock", v: "UTC fixed", tag: "default" },
  { k: "Geography Source", v: "Active-first", tag: "accent" },
  { k: "Last Ingest", v: "2m ago" },
]} />
```

- Wrap in `<Panel padding="tight">`; keys are Title Case, values are machine-literal.
