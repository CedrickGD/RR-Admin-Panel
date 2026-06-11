The sessions/users directory table — uppercase micro header, hairline row dividers, hover wash, expandable detail rows with the `DetailGrid` of inset mono cells.

```jsx
const { DataTable, DetailGrid, StatusBadge, Badge, IconButton } = window.RazorReaperConsoleDesignSystem_40e0a6;
<DataTable
  flush
  columns={[
    { key: "user", header: "User", render: (r) => <strong style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}>{r.user}</strong> },
    { key: "version", header: "Version", render: (r) => <Badge tone="muted">{r.version}</Badge> },
    { key: "duration", header: "Duration", muted: true },
    { key: "status", header: "Status", render: (r) => <StatusBadge presence={r.presence} /> },
    { key: "actions", header: "", render: (r) => <IconButton icon="chevron-down" onClick={() => toggle(r.id)} /> },
  ]}
  rows={sessions}
  rowKey={(r) => r.id}
  expandedKey={openId}
  renderExpanded={(r) => <DetailGrid items={[{ k: "Session ID", v: r.id }, { k: "Discord User", v: r.discord }]} />}
/>
```

- Set `flush` + wrap in `<Panel padding="flush">` so table edges meet the panel hairline.
- User names render in Space Grotesk semi-bold; Discord handles as muted `@name` suffixes; ids/timestamps in mono.
