import React, { useEffect } from "react";
import { IconButton } from "../controls/Button.jsx";

/**
 * Drill-down modal — opaque dark floating surface over a blurred scrim.
 * Used by KPI tiles and any detail view. Escape / scrim click closes.
 */
export function Modal({ open, onClose, kicker, title, sub, children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event) => {
      if (event.key === "Escape" && onClose) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="kpi-overlay" onClick={onClose}>
      <div className="kpi-modal" onClick={(event) => event.stopPropagation()}>
        <div className="kpi-modal-head">
          <div>
            {kicker ? <p className="kicker">{kicker}</p> : null}
            {title ? <h2 className="section-title">{title}</h2> : null}
            {sub ? <p className="section-sub">{sub}</p> : null}
          </div>
          <IconButton icon="x" title="Close" onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  );
}

/** Timespan comparison grid for drill-downs (Today / 7 d / 30 d / Lifetime). */
export function TimespanGrid({ spans }) {
  return (
    <div className="kpi-timespan-grid">
      {spans.map((span) => (
        <div className="kpi-timespan-cell" key={span.label}>
          <span className="kpi-timespan-label">{span.label}</span>
          <strong className="kpi-timespan-value">{span.value}</strong>
          {span.hint ? <span className="kpi-timespan-hint">{span.hint}</span> : null}
        </div>
      ))}
    </div>
  );
}

/** Ranked breakdown rows with share bars for drill-downs. */
export function BreakdownList({ title, rows }) {
  return (
    <div className="kpi-breakdown">
      {title ? <p className="kicker">{title}</p> : null}
      {rows.map((row) => (
        <div className="kpi-breakdown-row" key={row.label}>
          <span className="kpi-breakdown-label">{row.label}</span>
          {typeof row.share === "number" ? (
            <span className="kpi-breakdown-track">
              <span className="kpi-breakdown-fill" style={{ width: `${Math.min(100, Math.max(2, Math.round(row.share * 100)))}%` }} />
            </span>
          ) : null}
          <strong className="kpi-breakdown-value">{row.value}</strong>
        </div>
      ))}
    </div>
  );
}
