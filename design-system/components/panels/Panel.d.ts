/**
 * @startingPoint section="Surfaces" subtitle="Flat hairline panel with kicker/title head — the core console surface" viewport="700x260"
 */
export interface PanelProps {
  /** Uppercase accent micro-label above the title, e.g. "Traffic", "Failures" */
  kicker?: string;
  /** Section title (Space Grotesk), e.g. "Last 24 Hours" */
  title?: string;
  /** Optional one-line subtitle under the title */
  sub?: string;
  /** Header-right slot: badges, meta items, controls */
  right?: React.ReactNode;
  /** Click the head to collapse/expand (animated) */
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  /** "body" (default 12/16px) · "tight" (8/16px, for kv/feed lists) · "flush" (0, for tables) */
  padding?: "body" | "tight" | "flush";
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}
