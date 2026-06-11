import { ChevronDown } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";

interface CollapsiblePanelProps {
  /** Uppercase accent micro-label above the title, e.g. "Traffic", "Failures". */
  kicker?: string;
  /** Section title (Space Grotesk), e.g. "Last 24 Hours". */
  title?: string;
  /** Optional one-line subtitle under the title. */
  sub?: string;
  /** Header-right slot: badges, meta items, controls (kept clickable). */
  right?: ReactNode;
  /** Click the head to collapse/expand (animated). On by default — this is the app's collapsible Panel. */
  collapsible?: boolean;
  /** DS-aligned initial state. Wins over `defaultOpen` when both are provided. */
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
 * Optional collapse (animated grid-template-rows technique — children stay
 * mounted) and header-right slot. Mirrors the design-system Panel contract.
 */
export function CollapsiblePanel({
  kicker,
  title,
  sub,
  right,
  collapsible = true,
  defaultCollapsed,
  defaultOpen = true,
  padding = "flush",
  children,
  style,
  className = "",
}: CollapsiblePanelProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed ?? !defaultOpen);
  const hasHead = Boolean(kicker || title || sub || right || collapsible);
  const bodyClass = padding === "body" ? "panel-body" : padding === "tight" ? "panel-body-tight" : "panel-body-flush";
  const toggle = () => setCollapsed((current) => !current);

  const body = <div className={bodyClass}>{children}</div>;

  return (
    <section
      className={`panel${collapsible && collapsed ? " panel-collapsed" : ""}${className ? ` ${className}` : ""}`}
      style={style}
    >
      {hasHead ? (
        <div
          className={`panel-head${collapsible ? " panel-head-clickable" : ""}`}
          onClick={collapsible ? toggle : undefined}
          role={collapsible ? "button" : undefined}
          tabIndex={collapsible ? 0 : undefined}
          onKeyDown={
            collapsible
              ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggle();
                  }
                }
              : undefined
          }
        >
          <div className="panel-head-left">
            {kicker ? <p className="kicker">{kicker}</p> : null}
            {title ? <h2 className="section-title">{title}</h2> : null}
            {sub ? <p className="section-sub">{sub}</p> : null}
          </div>
          <div
            className="panel-head-right"
            // Controls in the right slot stay usable without toggling the fold.
            onClick={(event) => event.stopPropagation()}
          >
            {right}
            {collapsible ? (
              <span
                className={`panel-collapse-chevron${collapsed ? " panel-collapse-chevron-closed" : ""}`}
                onClick={toggle}
              >
                <ChevronDown size={15} />
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
      {collapsible ? (
        // Children stay mounted; grid-template-rows animates the fold smoothly.
        <div className="panel-body-clip" aria-hidden={collapsed}>
          <div className="panel-body-inner">{body}</div>
        </div>
      ) : (
        body
      )}
    </section>
  );
}
