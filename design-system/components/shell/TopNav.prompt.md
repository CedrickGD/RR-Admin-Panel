Frosted glass top navbar — the app shell's only chrome; use it instead of any sidebar.

```jsx
<div className="v2-shell">
  <TopNav
    logoSrc="assets/logo.ico"
    active={page}
    onNavigate={setPage}
    items={[
      { key: "overview", label: "Overview", icon: "chart-no-axes-column" },
      { key: "live", label: "Live", icon: "radio" },
      { key: "errors", label: "Errors", icon: "triangle-alert" },
      { key: "settings", label: "Settings", icon: "settings-2" },
    ]}
    live
    meta={<span>d1 · v1.6.2 · ingest 2m ago</span>}
    actions={<Button size="sm" icon="refresh-cw">Refresh</Button>}
  />
  <main className="v2-main">…page content…</main>
</div>
```

- Sticky, frosted (backdrop blur), hairline bottom border; active item gets a glowing accent tick sitting ON the navbar's bottom edge.
- `items` is flat — no groups. Keep to ≤8 items; the nav row scrolls horizontally if it overflows.
- `live={false}` flips the pulsing dot to red "Ingest offline".
- Below 900px the nav drops to a second scrollable row and `meta` hides.
