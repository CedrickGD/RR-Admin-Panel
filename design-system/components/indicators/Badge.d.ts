export interface BadgeProps {
  /** success · warning · danger · info · accent · muted (default). Status tones are fixed colors; "accent" follows the user hue. */
  tone?: "success" | "warning" | "danger" | "info" | "accent" | "muted";
  children?: React.ReactNode;
  title?: string;
  className?: string;
}

export interface LiveBadgeProps {
  /** e.g. "3 live" */
  children?: React.ReactNode;
  title?: string;
}
