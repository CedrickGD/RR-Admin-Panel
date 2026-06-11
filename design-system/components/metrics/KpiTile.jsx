import React, { useState } from "react";
import { Icon } from "../icons/Icon.jsx";
import { Sparkline } from "./Sparkline.jsx";
import { Modal, TimespanGrid, BreakdownList } from "../panels/Modal.jsx";

const TONE_CLASS = {
  primary: "",
  success: " tone-success",
  warning: " tone-warning",
  danger: " tone-danger",
};

/**
 * KPI stat tile: label / display value / one-line sub on the left,
 * sparkline or icon well on the right, accent tick on the left edge.
 * Pass `drilldown` to make it clickable with a detail modal.
 */
export function KpiTile({ label, value, sub, icon = "activity", tone = "primary", delta, spark, sparkColor, drilldown }) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(
    drilldown && ((drilldown.timespans?.length ?? 0) > 0 || (drilldown.breakdown?.length ?? 0) > 0 || drilldown.note)
  );

  return (
    <>
      <article
        className={`stat-card${TONE_CLASS[tone] ?? ""}${expandable ? " kpi-card-clickable" : ""}`}
        onClick={expandable ? () => setOpen(true) : undefined}
        role={expandable ? "button" : undefined}
        tabIndex={expandable ? 0 : undefined}
        onKeyDown={
          expandable
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setOpen(true);
                }
              }
            : undefined
        }
      >
        <div className="tile-main">
          <span className="stat-label">{label}</span>
          <strong className="stat-value tile-value-pop" key={String(value)}>
            {value}
            {delta !== undefined && delta !== null ? (
              <span className={`stat-card-delta ${Number(delta) >= 0 ? "stat-card-delta-positive" : "stat-card-delta-negative"}`}>
                {Number(delta) >= 0 ? "+" : ""}
                {delta}%
              </span>
            ) : null}
          </strong>
          <p className="stat-sub">
            {sub}
            {expandable ? <span className="kpi-card-chevron"><Icon name="chevron-right" size={12} /></span> : null}
          </p>
        </div>
        <div className="tile-side">
          {spark && spark.length > 1 ? (
            <Sparkline values={spark} color={sparkColor ?? "var(--accent)"} />
          ) : (
            <span className="tile-icon"><Icon name={icon} size={14} /></span>
          )}
        </div>
      </article>

      {expandable ? (
        <Modal open={open} onClose={() => setOpen(false)} kicker={label} title={String(value)} sub={sub}>
          {drilldown.timespans && drilldown.timespans.length > 0 ? <TimespanGrid spans={drilldown.timespans} /> : null}
          {drilldown.breakdown && drilldown.breakdown.length > 0 ? (
            <BreakdownList title={drilldown.breakdownTitle} rows={drilldown.breakdown} />
          ) : null}
          {drilldown.note ? <p className="kpi-modal-note">{drilldown.note}</p> : null}
        </Modal>
      ) : null}
    </>
  );
}
