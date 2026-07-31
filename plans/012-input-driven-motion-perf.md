# 012 — Coalesce input-driven motion: sidebar drag + Settings sliders

- **Status**: DONE
- **Commit**: 798e150
- **Severity**: MEDIUM
- **Category**: Performance
- **Estimated scope**: 2 TS/TSX files

## Problem

**A. Sidebar resize drag** applies a root CSS-var write, toggles a root class, AND dispatches a synthetic `resize` event on EVERY raw pointer event (120–1000Hz on high-polling mice). Each `resize` makes every mounted Recharts `ResponsiveContainer` re-measure and the maplibre canvas re-layout, synchronously, per event:

```tsx
// src/components/Navbar.tsx:145-151 — current
    function onMove(move: PointerEvent) {
      const raw = startWidth + (move.clientX - startX);
      // Snap: anything dragged below the readable minimum collapses to the icon rail.
      const width = raw < 150 ? 64 : Math.min(330, Math.max(188, raw));
      applySidebarWidth(width);
      window.dispatchEvent(new Event("resize"));
    }
```

**B. Settings background/hue sliders** write `:root` custom properties consumed by ~50 selectors — including *inside the running keyframes* of the two viewport-sized liquid layers — and write `localStorage` synchronously on every input tick:

```ts
// src/hooks/useAccent.ts:73-79 — current
  const setOffset = useCallback((next: Partial<BgOffset>) => {
    setOffsetState((prev) => {
      const merged = { ...prev, ...next };
      try { localStorage.setItem(BG_OFFSET_KEY, JSON.stringify(merged)); } catch { /* ignore */ }
      return merged;
    });
  }, []);
```

```ts
// src/hooks/useAccent.ts:100-104 — current
  const setHue = useCallback((newHue: number) => {
    const clamped = Math.max(0, Math.min(360, Math.round(newHue)));
    setHueState(clamped);
    try { localStorage.setItem(STORAGE_KEY, String(clamped)); } catch { /* ignore */ }
  }, []);
```

## Target

**A.** rAF-coalesced drag — at most one var-write + one resize dispatch per frame; final flush on pointerup:

```tsx
// src/components/Navbar.tsx — target shape for startResize
  function startResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const root = document.documentElement;
    const startX = event.clientX;
    const startWidth = parseInt(getComputedStyle(root).getPropertyValue("--sb-w"), 10) || 236;
    let frame = 0;
    let nextWidth = startWidth;

    function flush() {
      frame = 0;
      applySidebarWidth(nextWidth);
      window.dispatchEvent(new Event("resize"));
    }
    function onMove(move: PointerEvent) {
      const raw = startWidth + (move.clientX - startX);
      // Snap: anything dragged below the readable minimum collapses to the icon rail.
      nextWidth = raw < 150 ? 64 : Math.min(330, Math.max(188, raw));
      if (!frame) frame = requestAnimationFrame(flush);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (frame) cancelAnimationFrame(frame);
      applySidebarWidth(nextWidth);
      try { localStorage.setItem("rr-sb-w", String(nextWidth)); } catch { /* ignore */ }
      window.dispatchEvent(new Event("resize"));
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }
```

(Keep the existing comment about charts re-measuring mid-drag — it still holds, now at ≤60Hz. Note `onUp` no longer re-reads the computed style; it persists `nextWidth` directly.)

**B.** State updates stay per-event (React needs controlled-input value), but persistence debounces:

```ts
// src/hooks/useAccent.ts — target: module-scope helper
function debouncePersist(fn: () => void, ref: { t: number }) {
  window.clearTimeout(ref.t);
  ref.t = window.setTimeout(fn, 250);
}
```

- In `useBackgroundOffset`: replace the synchronous `localStorage.setItem` inside `setOffset` with a debounced write of the merged value (a `useRef({ t: 0 })` timer per hook instance; flush is fine to skip on unmount — next boot re-reads last persisted value).
- In `useAccent.setHue`: same pattern for `STORAGE_KEY`.
- The `applyHue`/`applyBgOffset` var writes stay in their `useEffect`s (one per committed render — already frame-bounded by React).

## Repo conventions to follow

- Existing try/catch-ignore style around localStorage stays.
- Keep function/comment style of the file (see `startResize`'s existing doc comment at Navbar.tsx:135-138 — keep it).

## Steps

1. Navbar.tsx: replace `startResize` with the rAF-coalesced version (keep `resetResize` and `applySidebarWidth` untouched).
2. useAccent.ts: add the debounce helper + timer refs; rewire `setOffset` and `setHue` persistence as described.
3. `npm run typecheck`.

## Boundaries

- Do NOT throttle the visual var writes below one-per-frame (the drag must stay visually live).
- Do NOT change snap thresholds (150/64/188/330) or persistence keys.
- Do NOT touch the liquid keyframes or WorldHeatmap.

## Verification

- **Mechanical**: `npm run typecheck` && `npm run build`.
- **Feel check**: drag the sidebar edge fast over the Overview page — charts follow smoothly without hitching; drag the Settings background sliders through their full range — the aurora tracks at frame rate; DevTools Performance during a slider scrub shows no long tasks from `localStorage`.
- **Done when**: per-event work during drags is one rAF callback max, and persistence fires only after 250ms of idle.
