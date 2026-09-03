import { X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface ModalProps {
  open: boolean;
  onClose?: () => void;
  /** Uppercase accent micro-label, e.g. the KPI label being drilled into. */
  kicker?: string;
  title?: string;
  sub?: ReactNode;
  children?: ReactNode;
  /** Viewport keeps the familiar modal chrome but gives dense detail views their own full work area. */
  size?: "default" | "viewport";
  className?: string;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Drill-down modal — opaque dark floating surface over a blurred scrim.
 * Used by KPI tiles and any detail view. Escape / scrim click closes.
 */
export function Modal({
  open,
  onClose,
  kicker,
  title,
  sub,
  children,
  size = "default",
  className = "",
}: ModalProps) {
  const [exiting, setExiting] = useState(false);
  const wasOpen = useRef(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  // Snapshot of the last open render's content. Confirm-modal callers close by
  // nulling the state their content derives from (open={!!target} with
  // {target ? body : null}), which would blank the body/subtitle for the whole
  // exit fade — the snapshot keeps the closing content visible instead.
  const lastContent = useRef<Pick<ModalProps, "kicker" | "title" | "sub" | "children">>({});
  if (open) lastContent.current = { kicker, title, sub, children };
  const shown = open ? { kicker, title, sub, children } : lastContent.current;

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      setExiting(false);
      return;
    }
    if (!wasOpen.current) return;
    setExiting(true);
    // Safety net if transitionend never fires (e.g. opacity never got a chance
    // to change, or transition: none overrides)
    const t = window.setTimeout(() => setExiting(false), 220);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      const overlay = overlayRef.current;
      const openOverlays = document.querySelectorAll<HTMLElement>('[data-modal-root="true"][data-state="open"]');
      if (overlay && openOverlays.item(openOverlays.length - 1) !== overlay) return;

      if (event.key === "Escape" && onClose) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
        (node) => node.getAttribute("aria-hidden") !== "true" && node.offsetParent !== null,
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      (closeRef.current ?? dialogRef.current)?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      const target = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (target?.isConnected) target.focus();
    };
  }, [open]);

  if (!open && !exiting) return null;

  // Portal to <body>: callers render the modal inline next to their tile, where
  // ancestor grid entrance rules historically outranked the overlay's own
  // entrance (the staggered grid's nth-child animation-delay made the modal
  // flash visible → blank → fade-in — the "double blink"). On <body> only the
  // dedicated .kpi-overlay/.kpi-modal entrance applies, and it runs once per
  // open (insertion-only; data polls update props without remounting, so it
  // never replays).
  return createPortal(
    <div
      ref={overlayRef}
      className={`kpi-overlay${size === "viewport" ? " kpi-overlay-viewport" : ""}`}
      data-modal-root="true"
      data-state={open ? "open" : "closed"}
      onClick={
        open && onClose
          ? (event) => {
              if (event.target === event.currentTarget) onClose();
            }
          : undefined
      }
      onTransitionEnd={(event) => {
        if (!open && event.target === event.currentTarget && event.propertyName === "opacity") setExiting(false);
      }}
    >
      <div
        ref={dialogRef}
        className={`kpi-modal${size === "viewport" ? " kpi-modal-viewport" : ""}${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={shown.title ? titleId : undefined}
        aria-label={shown.title ? undefined : shown.kicker ?? "Dialog"}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="kpi-modal-head">
          <div>
            {shown.kicker ? <p className="kicker">{shown.kicker}</p> : null}
            {shown.title ? <h2 className="section-title" id={titleId}>{shown.title}</h2> : null}
            {shown.sub ? <p className="section-sub">{shown.sub}</p> : null}
          </div>
          <button ref={closeRef} type="button" className="btn-icon" title="Close" aria-label="Close dialog" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        {shown.children}
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
