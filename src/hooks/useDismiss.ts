import { useEffect, useRef, type RefObject } from "react";

/** Why a floating element was dismissed: a press outside it, or Escape. */
export type DismissReason = "outside" | "escape";

/*
 * Open floating elements in the order they opened. Escape belongs to the last one only, so one
 * press closes one thing — the menu over the info panel before the panel itself.
 */
const openLayers: object[] = [];

/**
 * Light dismissal for a floating element that is NOT a history layer (an in-page menu or card):
 * while `open`, a pointerdown outside `ref` and an Escape press call `onClose`. The caller sets
 * `open` to false.
 *
 * - The pointerdown is heard in the capture phase on the document, so a target that stops
 *   propagation (MapLibre's canvas) still dismisses.
 * - Escape is heard in the capture phase on the window and stopped there, so it closes this element
 *   before any page-level Escape handler (clear a selection, leave fullscreen) sees it.
 * - Keep the trigger inside `ref`: a press on it is then not "outside", and its own click toggles.
 */
export function useDismiss(
  open: boolean,
  onClose: (reason: DismissReason) => void,
  ref: RefObject<HTMLElement | null>,
): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const layer = {};
    openLayers.push(layer);

    const onPointerDown = (event: PointerEvent) => {
      const node = ref.current;
      if (node && event.target instanceof Node && node.contains(event.target)) return;
      onCloseRef.current("outside");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || openLayers[openLayers.length - 1] !== layer) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onCloseRef.current("escape");
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      openLayers.splice(openLayers.indexOf(layer), 1);
    };
  }, [open, ref]);
}
