The core console surface: flat `--surface-1` panel, hairline border, kicker + Space Grotesk title head, optional animated collapse.

```jsx
const { Panel } = window.RazorReaperConsoleDesignSystem_40e0a6;
<Panel kicker="Failures" title="Recent Errors" right={<Badge tone="danger">4</Badge>} padding="tight">
  …feed rows…
</Panel>
```

- `padding="flush"` for tables (table borders meet the panel edge), `"tight"` for kv/feed lists.
- `collapsible` panels animate via grid-template-rows; the head chevron rotates.
- Panels never stack shadows — depth comes from the surface ladder and hairlines.
