import type { CSSProperties, ReactNode } from "react";

interface CollapsiblePanelProps {
  /** Uppercase accent micro-label above the title, e.g. "Traffic", "Failures". */
  kicker?: string;
  /** Section title (Space Grotesk), e.g. "Last 24 Hours". */
  title?: string;
  /** Optional one-line subtitle under the title. */
  sub?: string;
  /** Header-right slot: badges, meta items, controls (kept clickable). */
  right?: ReactNode;
  /** Legacy compatibility; panels always stay open. */
  collapsible?: boolean;
  /** Legacy compatibility; panels always stay open. */
  defaultCollapsed?: boolean;
  /** Legacy initial state (kept for existing call sites). */
  defaultOpen?: boolean;
  /**
   * "body" (12/16px) · "tight" (8/16px, for kv/feed lists) · "flush" (0, for tables).
   * Defaults to "flush" because existing pages supply their own `.panel-body` wrappers
   * inside children; pass an explicit padding once a call site drops its inner wrapper.
   */
  padding?: "body" | "tight" | "flush";
  children?: ReactNode;
  style?: CSSProperties;
  className?: string;
}

/**
 * Core surface: flat panel with hairline border, kicker + section title head.
 * Content always stays visible, with a header-right slot for controls.
 */
export function CollapsiblePanel({
  kicker,
  title,
  sub,
  right,
  padding = "flush",
  children,
  style,
  className = "",
}: CollapsiblePanelProps) {
  const hasHead = Boolean(kicker || title || sub || right);
  const bodyClass =
    padding === "body"
      ? "panel-body"
      : padding === "tight"
        ? "panel-body-tight"
        : "panel-body-flush";

  const body = <div className={bodyClass}>{children}</div>;

  return (
    <section className={`panel${className ? ` ${className}` : ""}`} style={style}>
      {hasHead ? (
        <div className="panel-head">
          <div className="panel-head-left">
            {kicker ? <p className="kicker">{kicker}</p> : null}
            {title ? <h2 className="section-title">{title}</h2> : null}
            {sub ? <p className="section-sub">{sub}</p> : null}
          </div>
          <div className="panel-head-right" onClick={(event) => event.stopPropagation()}>
            {right}
          </div>
        </div>
      ) : null}
      {body}
    </section>
  );
}
