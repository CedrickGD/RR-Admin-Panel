import React from "react";

const DOT_CLASS = { ok: " ok", bad: " bad", accent: " accent", neutral: "" };

/** Activity/error feed — threaded timeline rows with status dots and mono timestamps. */
export function Feed({ items }) {
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
