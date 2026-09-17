import { useSyncExternalStore } from "react";
import { formatDate, timeAgo } from "../../utils/format";

/*
 * One shared 60 s clock for every mounted <RelativeTime>: a directory page
 * renders a hundred cells and must not start a hundred timers.
 */
const listeners = new Set<() => void>();
let tick = 0;
let timer: number | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (timer === undefined) {
    timer = window.setInterval(() => {
      tick += 1;
      listeners.forEach((fn) => fn());
    }, 60_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };
}

const getTick = () => tick;

export interface RelativeTimeProps {
  /** ISO timestamp. null (or an unparsable value) renders timeAgo's plain text without a <time>. */
  iso: string | null;
}

/**
 * Relative timestamp ("6m ago") that always carries the absolute local
 * date-time: as a tooltip for the mouse, and as visually hidden text for
 * keyboard and screen-reader users — <time> is not focusable, so a title
 * alone is mouse-only, and dateTime is never announced. Re-renders on a
 * shared 60 s tick so "just now" does not freeze. The class is the hook a
 * layout places the element by (the Customer 360 history grid).
 */
export function RelativeTime({ iso }: RelativeTimeProps) {
  useSyncExternalStore(subscribe, getTick, getTick);
  if (!iso || !Number.isFinite(Date.parse(iso))) return <>{timeAgo(iso)}</>;
  const absolute = formatDate(iso);
  return (
    <time className="relative-time" dateTime={iso} title={absolute}>
      {timeAgo(iso)}
      <span className="sr-only"> ({absolute})</span>
    </time>
  );
}
