# 007 — Modal gets an exit; drawer scrim fades with the drawer

- **Status**: DONE
- **Commit**: 798e150
- **Severity**: MEDIUM
- **Category**: Interruptibility / Missed opportunity (spatial symmetry)
- **Estimated scope**: 2 TSX files + 1 CSS file

## Problem

**A. Modal.** Enters with a 150/180ms fade+scale, then vanishes in 0ms — React unmounts the same frame `open` flips false:

```tsx
// src/components/ds/Modal.tsx:33-35 — current
  if (!open) {
    return null;
  }
```

Used by every drill-down tile (KpiStatCard.tsx:113) and the confirm dialogs on Access/Licenses/Announcements/Feedback. A large opaque surface + scrim blinking out is the app's most jarring cut.

**B. Mobile drawer scrim.** The drawer itself is correct (mounted, class-toggled, 280ms transition — reversible). Its scrim is a mount-only keyframe that pops out instantly on close while the drawer is still sliding for 280ms:

```tsx
// src/components/Navbar.tsx:203 — current
      {drawerOpen ? <div className="sb-scrim" onClick={() => setDrawerOpen(false)} aria-hidden /> : null}
```

```css
/* src/theme/app-glue.css:766-773 — current */
.sb-scrim {
  position: fixed;
  inset: 0;
  z-index: 110;
  background: rgba(2, 3, 9, 0.55);
  animation: scrimIn 0.2s ease both;
}
@keyframes scrimIn { from { opacity: 0; } to { opacity: 1; } }
```

## Target

**A. Modal** stays mounted while a 150ms exit plays, driven by a `data-state` attribute; unmount on `animationend` of the overlay (with a safety timeout).

```tsx
// src/components/ds/Modal.tsx — target shape (inside Modal component)
export function Modal({ open, onClose, kicker, title, sub, children }: ModalProps) {
  const [exiting, setExiting] = useState(false);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      setExiting(false);
      return;
    }
    if (!wasOpen.current) return;
    setExiting(true);
    // Safety net if animationend never fires (e.g. reduced-motion animation: none)
    const t = window.setTimeout(() => setExiting(false), 220);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && onClose) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open && !exiting) return null;

  return createPortal(
    <div
      className="kpi-overlay"
      data-state={open ? "open" : "closed"}
      onClick={open ? onClose : undefined}
      onAnimationEnd={(event) => {
        if (!open && event.target === event.currentTarget) setExiting(false);
      }}
    >
      {/* inner markup unchanged */}
```

Keep the existing portal comment block (Modal.tsx:37-42). The inner `.kpi-modal` div and children stay exactly as they are.

```css
/* src/theme/app-glue.css — target: add after the existing .kpi-modal entrance rules (~line 1100) */
@keyframes kpi-overlay-out {
  from { opacity: 1; }
  to   { opacity: 0; }
}
@keyframes kpi-modal-out {
  from { opacity: 1; transform: none; }
  to   { opacity: 0; transform: scale(0.97); }
}
.kpi-overlay[data-state="closed"] { animation: kpi-overlay-out 0.15s var(--ease-out) both; pointer-events: none; }
.kpi-overlay[data-state="closed"] .kpi-modal { animation: kpi-modal-out 0.15s var(--ease-out) both; }
```

Also extend the existing reduced-motion block (app-glue.css:1107-1110) to cover the exits — replace it with:

```css
@media (prefers-reduced-motion: reduce) {
  .kpi-overlay,
  .kpi-modal { animation: kpi-overlay-fade 0.15s ease-out; }
  .kpi-overlay[data-state="closed"],
  .kpi-overlay[data-state="closed"] .kpi-modal { animation: kpi-overlay-out 0.15s ease-out both; }
}
```

(Fade-only both ways: movement dropped, the opacity bridge kept — the exit timeout in TSX covers unmount either way.)

**B. Scrim** becomes an always-mounted (on mobile) transition that retargets with the drawer:

```tsx
// src/components/Navbar.tsx:203 — target
      <div className={`sb-scrim${drawerOpen ? " sb-scrim-open" : ""}`} onClick={() => setDrawerOpen(false)} aria-hidden />
```

```css
/* src/theme/app-glue.css:766-773 — target (replaces rule + scrimIn keyframe) */
.sb-scrim {
  position: fixed;
  inset: 0;
  z-index: 110;
  background: rgba(2, 3, 9, 0.55);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.28s var(--ease-smooth);
}
.sb-scrim-open { opacity: 1; pointer-events: auto; }
@media (min-width: 901px) { .sb-scrim { display: none; } }
```

## Repo conventions to follow

- The drawer itself (app-glue.css:785-790) is the exemplar: mounted, class-toggled transition at `0.28s var(--ease-smooth)` — the scrim now matches its mechanism and duration exactly.
- `--ease-out` from plan 001 (STOP if missing).

## Steps

1. Modal.tsx: implement the exit-state pattern above (`useState`, `useRef` imports from react are partially present — extend the import line).
2. app-glue.css: add the two exit keyframes + two `[data-state="closed"]` rules after line ~1100; replace the RM block at 1107-1110 with the target version.
3. Navbar.tsx:203: unconditional scrim with `sb-scrim-open` class toggle.
4. app-glue.css:766-773: replace the scrim rule + delete `@keyframes scrimIn`; add the desktop `display: none` guard.

## Boundaries

- Do NOT change modal inner markup, portal target, or the Escape/scrim-click close paths' behavior (they now trigger the exit, then unmount).
- Do NOT add exits to `.gdrop-menu` / `.filter-pop` — dismissal snap is intentional.
- If Modal.tsx no longer matches the excerpt at lines 33-44, STOP and report.

## Verification

- **Mechanical**: `npm run typecheck` && `npm run build`. `grep -n "scrimIn" src/` → 0 matches.
- **Feel check**: open a KPI drill-down, press Escape — the modal fades/scales away over ~150ms instead of blinking out; spam open/close rapidly — no stuck overlay, no double modal (the safety timeout unmounts). At mobile width, close the drawer — scrim and panel fade/slide out *together*; tap the scrim mid-open — the drawer reverses smoothly and the scrim retargets (no restart).
- **Done when**: enter/exit are symmetric on both surfaces and rapid toggling never wedges the overlay.
