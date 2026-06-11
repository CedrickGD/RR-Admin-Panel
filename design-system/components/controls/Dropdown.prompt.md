Themed select replacement (the "GlassDropdown" pattern) — trigger pill plus anchored dark popover with type-to-filter. Native `<select>` is banned in this design system.

```jsx
const { Dropdown } = window.RazorReaperConsoleDesignSystem_40e0a6;
<Dropdown
  placeholder="All versions"
  options={["1.6.2", "1.6.1", "1.5.0", "legacy"]}
  value={version}
  onChange={setVersion}
  renderOption={(o) => (o === "legacy" ? "Legacy (pre-1.4)" : o)}
/>
```

- A set filter tints the trigger with the accent (`gdrop-active`); the placeholder row doubles as "clear".
- Search input appears automatically past `searchThreshold` (8) options.
- Closes on outside pointer-down and Escape.
