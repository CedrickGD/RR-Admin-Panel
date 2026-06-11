Console buttons: ghost is the default for almost everything; primary (solid accent) appears at most once per view; danger only for destructive/auth actions.

```jsx
const { Button, IconButton } = window.RazorReaperConsoleDesignSystem_40e0a6;
<Button icon="refresh-cw">Refresh</Button>
<Button variant="primary" size="sm">Sign In</Button>
<Button variant="danger" size="sm" icon="log-out">Sign Out</Button>
<IconButton icon="chevron-down" title="Expand" />
```

- Sizes: `md` (13px text) default, `sm` for panel headers, `xs` for table rows.
- Hover: surface steps up one level + hairline brightens; primary gains a soft accent ring (no transform).
- `IconButton` is the square 1-icon variant used in table action cells.
