Session presence badge — the Status column of every sessions table.

```jsx
const { StatusBadge } = window.RazorReaperConsoleDesignSystem_40e0a6;
<StatusBadge presence="online" />
<StatusBadge presence="ended" />
```

- Live presences pulse their dot; `ended` is static and neutral.
- Vocabulary is fixed: Online / Idle / Unreachable / Ended.
