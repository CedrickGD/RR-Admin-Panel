Search field with a leading search icon — used to filter the sessions/users directory.

```jsx
const { SearchInput } = window.RazorReaperConsoleDesignSystem_40e0a6;
<SearchInput value={q} onChange={setQ} placeholder="Search user, Discord, session id…" />
```

- Focus ring: accent border + 3px `--accent-subtle` halo (inherited from `.glass-input`).
- Width is fluid; constrain with a wrapper or `style={{ maxWidth: 280 }}`.
