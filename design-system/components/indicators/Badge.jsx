import React from "react";

const TONE_CLASS = {
  success: "badge-success",
  warning: "badge-warning",
  danger: "badge-danger",
  info: "badge-info",
  accent: "badge-accent",
  muted: "badge-muted",
};

/** Pill badge for counts and states. Fixed status colors — never accent-derived. */
export function Badge({ tone = "muted", children, title, className = "" }) {
  return (
    <span className={`badge ${TONE_CLASS[tone] ?? TONE_CLASS.muted}${className ? ` ${className}` : ""}`} title={title}>
      {children}
    </span>
  );
}

/** Green pulsing-dot pill — only for genuinely realtime things ("3 live"). */
export function LiveBadge({ children, title }) {
  return <span className="badge-live" title={title}>{children}</span>;
}
