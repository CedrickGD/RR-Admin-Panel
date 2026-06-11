Drill-down modal (opaque dark surface, blurred scrim) with its two standard content blocks: `TimespanGrid` and `BreakdownList`.

```jsx
const { Modal, TimespanGrid, BreakdownList } = window.RazorReaperConsoleDesignSystem_40e0a6;
<Modal open={open} onClose={close} kicker="Sessions" title="1,284" sub="In range · 5,931 all-time">
  <TimespanGrid spans={[{ label: "Today", value: "18" }, { label: "7 d", value: "124" }, { label: "Lifetime", value: "5,931" }]} />
  <BreakdownList title="Sessions by platform" rows={[{ label: "Windows 11", value: "912", share: 0.71 }]} />
  <p className="kpi-modal-note">Computed server-side over the full session history.</p>
</Modal>
```

- Closes on Escape and scrim click; the X is an `IconButton`.
- Footnotes use `.kpi-modal-note` — small, muted, honest about data caveats.
