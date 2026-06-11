import type { ReactNode } from "react";

export type FeedTone = "ok" | "bad" | "accent" | "neutral";

export interface FeedItem {
  id?: string;
  /** One line, truncated — e.g. "NullReferenceException" or "Session started" */
  title: ReactNode;
  /** Source · detail line, e.g. "overlay_renderer · Object reference not set" */
  meta?: ReactNode;
  /** Relative mono timestamp, e.g. "2m" */
  time?: string;
  /** ok (green) · bad (red) · accent · neutral (default) — colors the ring of the dot */
  tone?: FeedTone;
}

export interface FeedProps {
  items: FeedItem[];
}

const DOT_CLASS: Record<FeedTone, string> = { ok: " ok", bad: " bad", accent: " accent", neutral: "" };

/** Activity/error feed — threaded timeline rows with status dots and mono timestamps. */
export function Feed({ items }: FeedProps) {
  return (
    <div className="feed">
      {items.map((item, i) => (
        <div className="feed-row" key={item.id ?? i}>
          <span className={`feed-dot${DOT_CLASS[item.tone ?? "neutral"]}`} />
          <div className="feed-body">
            <p className="feed-title">{item.title}</p>
            {item.meta ? <p className="feed-meta">{item.meta}</p> : null}
          </div>
          {item.time ? <span className="feed-time">{item.time}</span> : null}
        </div>
      ))}
    </div>
  );
}
