import { useCallback, useEffect, useRef, useState } from "react";

const MIN_WINDOW = 1;

export function useChartZoom(totalPoints: number) {
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

  // Use native event listener so we can call preventDefault on a non-passive wheel event
  // This prevents the page from scrolling when the user scrolls inside the chart
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handler = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const rect = container.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left) / rect.width;

      setRange((prev) => {
        const currentWindow = prev.end - prev.start;
        const zoomFactor = e.deltaY > 0 ? 1.25 : 0.8;
        const newWindow = Math.max(
          MIN_WINDOW,
          Math.min(
            totalPoints,
            e.deltaY > 0
              ? Math.ceil(currentWindow * zoomFactor)
              : Math.floor(currentWindow * zoomFactor),
          ),
        );

        if (newWindow === currentWindow) return prev;

        const anchor = prev.start + mouseX * currentWindow;
        const newStart = Math.round(anchor - mouseX * newWindow);
        const clampedStart = Math.max(0, Math.min(totalPoints - newWindow, newStart));
        const clampedEnd = clampedStart + newWindow;

        return { start: clampedStart, end: clampedEnd };
      });
    };

    container.addEventListener("wheel", handler, { passive: false });
    return () => container.removeEventListener("wheel", handler);
  }, [totalPoints]);

  const setWindow = useCallback(
    (hours: number) => {
      const end = totalPoints;
      const start = Math.max(0, end - hours);
      setRange({ start, end });
    },
    [totalPoints],
  );

  const resetZoom = useCallback(() => {
    setRange({ start: 0, end: totalPoints });
  }, [totalPoints]);

  return { visibleStart, visibleEnd, isZoomed, resetZoom, setWindow, containerRef };
}
