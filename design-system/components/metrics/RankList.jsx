import React from "react";

/** Ranked share bars — versions, countries, platforms. Accent-gradient fills grow in. */
export function RankList({ items }) {
  if (!items || items.length === 0) {
    return <p style={{ padding: "10px 0", fontSize: "0.8125rem", color: "var(--text-2)", margin: 0 }}>No data.</p>;
  }
  return (
    <div className="rank">
      {items.map((item) => (
        <div className="rank-row" key={item.label}>
          <span className="rank-label" title={item.label}>{item.label}</span>
          <span className="rank-track">
            <span className="rank-fill" style={{ width: `${Math.min(100, Math.max(2, Math.round(item.share * 100)))}%` }} />
          </span>
          <span className="rank-value">{item.value}</span>
        </div>
      ))}
    </div>
  );
}
