export interface StatusBadgeProps {
  /** online (green, pulsing) · idle (amber) · unreachable (red) · ended (neutral, static dot) */
  presence?: "online" | "idle" | "unreachable" | "ended";
  showDot?: boolean;
  /** Override the default presence label */
  label?: string;
}
