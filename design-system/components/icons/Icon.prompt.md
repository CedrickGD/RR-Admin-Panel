Inline Lucide stroke icon in currentColor — the console's only icon system (no emoji, no custom SVG art).

```jsx
const { Icon } = window.RazorReaperConsoleDesignSystem_40e0a6;
<span style={{ color: "var(--accent)" }}>
  <Icon name="radio" size={17} />
</span>
```

- 60 icons shipped (see `components/icons/iconPaths.js` or the Icons card): nav set (`chart-no-axes-column`, `clock-3`, `layers`, `map`, `radio`, `history`, `triangle-alert`, `settings-2`), status (`circle-check`, `zap`, `wifi`), data (`users`, `trending-up`, `globe`, `earth`, `database`, `server`), chrome (`chevron-*`, `check`, `search`, `x`, `funnel-x`, `refresh-cw`).
- Sizes: 16px navbar nav & buttons/empty-states, 14px table row actions, 12px kickers.
- Icons inherit `currentColor` — never hardcode accent hues; wrap in an element colored with `var(--accent)` etc.
