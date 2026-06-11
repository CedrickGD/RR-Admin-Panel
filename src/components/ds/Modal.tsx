import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface ModalProps {
  open: boolean;
  onClose?: () => void;
  /** Uppercase accent micro-label, e.g. the KPI label being drilled into. */
  kicker?: string;
  title?: string;
  sub?: string;
  children?: ReactNode;
}

/**
 * Drill-down modal — opaque dark floating surface over a blurred scrim.
 * Used by KPI tiles and any detail view. Escape / scrim click closes.
 */
export function Modal({ open, onClose, kicker, title, sub, children }: ModalProps) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && onClose) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  // Portal to <body>: callers render the modal inline next to their tile, which would
  // make .kpi-overlay a direct child of .v2-stagger grids — the stagger's nth-child
  // animation-delay then outranks the overlay's own entrance and the modal flashes
  // visible → blank → fade-in (the "double blink"). On <body> only the dedicated
  // .kpi-overlay/.kpi-modal entrance applies, and it runs once per open (mount-only;
  // data polls update props without remounting, so it never replays).
  return createPortal(
    <div className="kpi-overlay" onClick={onClose}>
      <div className="kpi-modal" onClick={(event) => event.stopPropagation()}>
        <div className="kpi-modal-head">
          <div>
            {kicker ? <p className="kicker">{kicker}</p> : null}
            {title ? <h2 className="section-title">{title}</h2> : null}
            {sub ? <p className="section-sub">{sub}</p> : null}
          </div>
          <button type="button" className="btn-icon" title="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

export interface TimespanGridProps {
  /** e.g. [{ label: "Today", value: "18" }, { label: "7 d", value: "124", hint: "limited to 7d range" }] */
  spans: Array<{ label: string; value: string; hint?: string }>;
}

/** Timespan comparison grid for drill-downs (Today / 7 d / 30 d / Lifetime). */
export function TimespanGrid({ spans }: TimespanGridProps) {
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

export interface BreakdownListProps {
  /** Kicker above the rows, e.g. "Users by current version". */
  title?: string;
  /** share is 0–1; bars are accent-gradient. */
  rows: Array<{ label: string; value: string; share?: number }>;
}

/** Ranked breakdown rows with share bars for drill-downs. */
export function BreakdownList({ title, rows }: BreakdownListProps) {
  return (
    <div className="kpi-breakdown">
      {title ? <p className="kicker">{title}</p> : null}
      {rows.map((row) => (
        <div className="kpi-breakdown-row" key={row.label}>
          <span className="kpi-breakdown-label">{row.label}</span>
          {typeof row.share === "number" ? (
            <span className="kpi-breakdown-track">
              <span
                className="kpi-breakdown-fill"
                style={{ width: `${Math.min(100, Math.max(2, Math.round(row.share * 100)))}%` }}
              />
            </span>
          ) : null}
          <strong className="kpi-breakdown-value">{row.value}</strong>
        </div>
      ))}
    </div>
  );
}
