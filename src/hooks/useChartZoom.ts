import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

const MIN_WINDOW = 1;
/** Same factors the wheel used before, now shared with the buttons and the keyboard. */
const ZOOM_IN_FACTOR = 0.8;
const ZOOM_OUT_FACTOR = 1.25;

/** ⌘ on Apple hardware, Ctrl everywhere else — the modifier maps/charts zoom with. */
const IS_APPLE =
  typeof navigator !== "undefined" && /Mac|iPad|iPhone|iPod/.test(navigator.userAgent);

export const ZOOM_MODIFIER_LABEL = IS_APPLE ? "⌘" : "Ctrl";
/** One short phrase for a panel sub line — the buttons carry the rest. */
export const ZOOM_HINT = `${ZOOM_MODIFIER_LABEL} + scroll to zoom`;

/** Spread onto the plot wrapper; the caller keeps ownership of ref and className. */
export interface ChartZoomContainerProps {
  tabIndex: number;
  role: "group";
  "aria-label": string;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

/**
 * Range zoom for the page-level telemetry charts.
 *
 * A plain wheel must keep scrolling the page: zooming needs the platform
 * modifier (Ctrl/⌘) or keyboard focus on the plot. The same zoom step is
 * exposed as `zoomIn`/`zoomOut` for header buttons and bound to +/-/0 while
 * the plot has focus, so the feature also exists without a wheel.
 */
export function useChartZoom(totalPoints: number, label = "Chart") {
  const [range, setRange] = useState({ start: 0, end: totalPoints });
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset range when data size changes
  useEffect(() => {
    if (range.end > totalPoints) {
      setRange({ start: 0, end: totalPoints });
    }
  }, [totalPoints, range.end]);

  const visibleStart = Math.max(0, Math.min(range.start, totalPoints - MIN_WINDOW));
  const visibleEnd = Math.min(totalPoints, Math.max(range.end, visibleStart + MIN_WINDOW));
  const isZoomed = visibleStart > 0 || visibleEnd < totalPoints;
  const visibleWindow = visibleEnd - visibleStart;
  const canZoomIn = visibleWindow > MIN_WINDOW;
  const canZoomOut = visibleWindow < totalPoints;

  /** `direction` 1 widens the window (zoom out), -1 narrows it; `anchor` is 0–1 across the plot. */
  const zoomBy = useCallback(
    (direction: 1 | -1, anchor = 0.5) => {
      setRange((prev) => {
        const currentWindow = prev.end - prev.start;
        const factor = direction > 0 ? ZOOM_OUT_FACTOR : ZOOM_IN_FACTOR;
        const newWindow = Math.max(
          MIN_WINDOW,
          Math.min(
            totalPoints,
            direction > 0
              ? Math.ceil(currentWindow * factor)
              : Math.floor(currentWindow * factor),
          ),
        );

        if (newWindow === currentWindow) return prev;

        const pivot = prev.start + anchor * currentWindow;
        const newStart = Math.round(pivot - anchor * newWindow);
        const clampedStart = Math.max(0, Math.min(totalPoints - newWindow, newStart));

        return { start: clampedStart, end: clampedStart + newWindow };
      });
    },
    [totalPoints],
  );

  const zoomIn = useCallback(() => zoomBy(-1), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(1), [zoomBy]);

  const resetZoom = useCallback(() => {
    setRange({ start: 0, end: totalPoints });
  }, [totalPoints]);

  // Native listener so preventDefault works on a non-passive wheel event — but
  // only on the events we actually consume, so an unmodified wheel still scrolls.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handler = (e: WheelEvent) => {
      const focused =
        document.activeElement === container || container.contains(document.activeElement);
      if (!e.ctrlKey && !e.metaKey && !focused) return;
      if (e.deltaY === 0) return;

      e.preventDefault();
      e.stopPropagation();

      const rect = container.getBoundingClientRect();
      const anchor = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
      zoomBy(e.deltaY > 0 ? 1 : -1, Math.min(1, Math.max(0, anchor)));
    };

    container.addEventListener("wheel", handler, { passive: false });
    return () => container.removeEventListener("wheel", handler);
  }, [zoomBy]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomBy(-1);
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomBy(1);
      } else if (event.key === "0") {
        event.preventDefault();
        resetZoom();
      }
    },
    [zoomBy, resetZoom],
  );

  const containerProps = useMemo<ChartZoomContainerProps>(
    () => ({
      tabIndex: 0,
      role: "group",
      "aria-label": `${label}. ${ZOOM_MODIFIER_LABEL} + scroll, or the plus, minus and 0 keys, zoom the time window.`,
      onKeyDown,
    }),
    [label, onKeyDown],
  );

  const setWindow = useCallback(
    (hours: number) => {
      const end = totalPoints;
      const start = Math.max(0, end - hours);
      setRange({ start, end });
    },
    [totalPoints],
  );

  return {
    visibleStart,
    visibleEnd,
    isZoomed,
    canZoomIn,
    canZoomOut,
    zoomIn,
    zoomOut,
    resetZoom,
    setWindow,
    containerRef,
    containerProps,
    hint: ZOOM_HINT,
  };
}
