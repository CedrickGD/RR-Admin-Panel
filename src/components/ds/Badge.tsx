/**
 * DS port of design-system/components/indicators/Badge (Badge + LiveBadge).
 *
 * Pill badge for counts and states. Status tones (success/warning/danger/info)
 * are fixed brand colors and never follow the user accent hue; "accent" does.
 * LiveBadge pulses — only for genuinely realtime things, one or two per view max.
 */
import type { ReactNode } from "react";

const TONE_CLASS: Record<string, string> = {
  success: "badge-success",
  warning: "badge-warning",
  danger: "badge-danger",
  info: "badge-info",
  accent: "badge-accent",
  muted: "badge-muted",
};

export interface BadgeProps {
  /** success · warning · danger · info · accent · muted (default). Status tones are fixed colors; "accent" follows the user hue. */
  tone?: "success" | "warning" | "danger" | "info" | "accent" | "muted";
  children?: ReactNode;
  title?: string;
  className?: string;
}

/** Pill badge for counts and states. Fixed status colors — never accent-derived. */
export function Badge({ tone = "muted", children, title, className = "" }: BadgeProps) {
  return (
    <span className={`badge ${TONE_CLASS[tone] ?? TONE_CLASS.muted}${className ? ` ${className}` : ""}`} title={title}>
      {children}
    </span>
  );
}

export interface LiveBadgeProps {
  /** e.g. "3 live" */
  children?: ReactNode;
  title?: string;
}

/** Green pulsing-dot pill — only for genuinely realtime things ("3 live"). */
export function LiveBadge({ children, title }: LiveBadgeProps) {
  return <span className="badge-live" title={title}>{children}</span>;
}
