import { useCallback, useRef, useState, type WheelEvent } from "react";

const MIN_WINDOW = 4;

export function useChartZoom(totalPoints: number) {
  const [range, setRange] = useState({ start: 0, end: totalPoints });
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset range when data size changes
  if (range.end > totalPoints) {
    setRange({ start: 0, end: totalPoints });
  }

  const visibleStart = Math.max(0, Math.min(range.start, totalPoints - MIN_WINDOW));
  const visibleEnd = Math.min(totalPoints, Math.max(range.end, visibleStart + MIN_WINDOW));
  const isZoomed = visibleStart > 0 || visibleEnd < totalPoints;

  const onWheel = useCallback(
    (e: WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left) / rect.width; // 0..1 position

      setRange((prev) => {
        const currentWindow = prev.end - prev.start;
        const zoomFactor = e.deltaY > 0 ? 1.25 : 0.8; // scroll down = zoom out, up = zoom in
        const newWindow = Math.max(MIN_WINDOW, Math.min(totalPoints, Math.round(currentWindow * zoomFactor)));

        if (newWindow === currentWindow) return prev;

        // Anchor zoom around mouse position
        const anchor = prev.start + mouseX * currentWindow;
        const newStart = Math.round(anchor - mouseX * newWindow);
        const clampedStart = Math.max(0, Math.min(totalPoints - newWindow, newStart));
        const clampedEnd = clampedStart + newWindow;

        return { start: clampedStart, end: clampedEnd };
      });
    },
    [totalPoints],
  );

  const resetZoom = useCallback(() => {
    setRange({ start: 0, end: totalPoints });
  }, [totalPoints]);

  return { visibleStart, visibleEnd, isZoomed, onWheel, resetZoom, containerRef };
}
