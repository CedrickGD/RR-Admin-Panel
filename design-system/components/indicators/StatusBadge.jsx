import React from "react";

const PRESENCE_STYLES = {
  online:      { tone: "badge badge-success", label: "Online",      dot: "status-dot pulse" },
  idle:        { tone: "badge badge-warning", label: "Idle",        dot: "status-dot warn pulse-warn" },
  unreachable: { tone: "badge badge-danger",  label: "Unreachable", dot: "status-dot err pulse-err" },
  ended:       { tone: "badge badge-muted",   label: "Ended",       dot: "status-dot idle" },
};

/** Session presence badge with pulsing dot — Online / Idle / Unreachable / Ended. */
export function StatusBadge({ presence = "ended", showDot = true, label }) {
  const style = PRESENCE_STYLES[presence] ?? PRESENCE_STYLES.ended;
  return (
    <span className={style.tone}>
      {showDot ? <span className={style.dot} /> : null}
      {label ?? style.label}
    </span>
  );
}
