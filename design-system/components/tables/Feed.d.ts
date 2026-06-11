export interface FeedProps {
  items: Array<{
    id?: string;
    /** One line, truncated — e.g. "NullReferenceException" or "Session started" */
    title: string;
    /** Source · detail line, e.g. "overlay_renderer · Object reference not set" */
    meta?: string;
    /** Relative mono timestamp, e.g. "2m" */
    time?: string;
    /** ok (green) · bad (red) · accent · neutral (default) — colors the ring of the dot */
    tone?: "ok" | "bad" | "accent" | "neutral";
  }>;
}
