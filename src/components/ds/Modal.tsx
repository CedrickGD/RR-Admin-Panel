import { X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useHistoryLayer } from "../../hooks/useHistoryLayer";

export interface ModalProps {
  open: boolean;
  onClose?: () => void;
  /** Uppercase accent micro-label, e.g. the KPI label being drilled into. */
  kicker?: string;
  /** Dialog heading (labels the dialog). ReactNode so a KPI drill-down can reuse the tile's value element. */
  title?: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
  /** Viewport keeps the familiar modal chrome but gives dense detail views their own full work area. */
  size?: "default" | "viewport";
  className?: string;
  /**
   * Whether a click on the scrim may close the dialog (default true). Form
   * dialogs pass false so a stray click outside cannot throw away typed
   * content; the X button and the caller's own Cancel stay the explicit exits.
   */
  dismissOnScrim?: boolean;
  /**
   * Reports unsaved edits. While it returns true, every exit the dialog itself
   * owns (Escape, the X button, and a scrim click where it is allowed) asks
   * "Discard unsaved changes?" instead of closing silently.
   */
  isDirty?: () => boolean;
  /**
   * Where focus lands on open: the first enabled input/select/textarea inside
   * the content ("first-field", default — falls back to the close button when
   * there is none, e.g. confirm dialogs) or always the close button ("close").
   */
  initialFocus?: "first-field" | "close";
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const FIELD_SELECTOR = [
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  // The DS Select is a themed button, not a native <select> (see GlassDropdown).
  "button.gdrop-trigger:not([disabled])",
].join(",");

/**
 * The dialog. Every dialog in the console is this one component — confirms,
 * forms, detail views and the KPI drill-downs it was first written for — an
 * opaque floating surface over a blurred scrim. Escape / scrim click closes
 * unless the caller opts out (dismissOnScrim) or reports unsaved edits
 * (isDirty). Its CSS is one block in theme/css/components.css; at 600px and
 * below the same markup is a full-screen sheet (title left, X right).
 *
 * Every open dialog owns one history entry (useHistoryLayer): the browser or
 * phone Back closes it like the X does, instead of leaving the page under it.
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
  dismissOnScrim = true,
  isDirty,
  initialFocus = "first-field",
}: ModalProps) {
  const [exiting, setExiting] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const wasOpen = useRef(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const kickerId = useId();
  // Snapshot of the last open render's content. Confirm-modal callers close by
  // nulling the state their content derives from (open={!!target} with
  // {target ? body : null}), which would blank the body/subtitle for the whole
  // exit fade — the snapshot keeps the closing content visible instead.
  const lastContent = useRef<Pick<ModalProps, "kicker" | "title" | "sub" | "children">>({});
  if (open) lastContent.current = { kicker, title, sub, children };
  const shown = open ? { kicker, title, sub, children } : lastContent.current;
  // The kicker carries the meaning ("Last failure"), the title only the value
  // ("6m ago") — a drill-down dialog has to announce both, in that order.
  const labelledBy =
    [shown.kicker ? kickerId : null, shown.title ? titleId : null].filter(Boolean).join(" ") ||
    undefined;

  /**
   * Every exit the dialog owns goes through here, so Escape, the X button and a
   * scrim click behave identically: clean work closes, unsaved work raises the
   * discard step instead of vanishing (or, worse, doing nothing at all).
   */
  function requestClose() {
    if (!onClose) return;
    if (isDirty?.()) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }

  // Back goes through the same exit as the X: clean work closes, unsaved work
  // raises the discard step (the entry is spent either way).
  useHistoryLayer(open && Boolean(onClose), requestClose);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      setConfirmDiscard(false);
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
      const openOverlays = document.querySelectorAll<HTMLElement>(
        '[data-modal-root="true"][data-state="open"]',
      );
      if (overlay && openOverlays.item(openOverlays.length - 1) !== overlay) return;

      if (event.key === "Escape" && onClose) {
        if (dialogRef.current?.querySelector(".gdrop-menu")) return;
        event.preventDefault();
        event.stopPropagation();
        // A reflex Escape never discards unsaved edits — it asks first.
        if (confirmDiscard) setConfirmDiscard(false);
        else requestClose();
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
  }, [open, onClose, isDirty, confirmDiscard]);

  // The discard step is a decision, so it takes focus; "Keep editing" is the safe default.
  useEffect(() => {
    if (confirmDiscard) keepEditingRef.current?.focus();
  }, [confirmDiscard]);

  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Lock the viewport on <html>, not <body>: html carries overflow-x: clip
    // (workspace.css), so an overflow on body stops propagating to the viewport
    // and turns body into its own scroller, which drops the sticky navbar out of
    // view on a scrolled page.
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const firstField = () =>
      [...(contentRef.current?.querySelectorAll<HTMLElement>(FIELD_SELECTOR) ?? [])].find(
        (node) => node.offsetParent !== null,
      );
    let watcher: MutationObserver | null = null;
    const frame = window.requestAnimationFrame(() => {
      // Form dialogs open ready to type; dialogs without a visible field (confirm,
      // drill-down) land on the close button so Enter never fires a stray action.
      const field = initialFocus === "first-field" ? firstField() : undefined;
      if (field) {
        field.focus();
        return;
      }
      const fallback = closeRef.current ?? dialogRef.current;
      fallback?.focus();
      // Dialogs that fetch their content have no field on the opening frame. Take the
      // first one that appears, but only while the fallback still holds focus — once
      // the user has moved on, the dialog must not yank focus out from under them.
      if (initialFocus !== "first-field" || !contentRef.current || !fallback) return;
      watcher = new MutationObserver(() => {
        if (document.activeElement !== fallback) {
          watcher?.disconnect();
          return;
        }
        const late = firstField();
        if (!late) return;
        watcher?.disconnect();
        late.focus();
      });
      watcher.observe(contentRef.current, { childList: true, subtree: true });
    });

    return () => {
      window.cancelAnimationFrame(frame);
      watcher?.disconnect();
      document.documentElement.style.overflow = previousOverflow;
      const target = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (target?.isConnected) target.focus();
    };
  }, [open, initialFocus]);

  if (!open && !exiting) return null;

  // Portal to <body>: callers render the modal inline next to their tile, where
  // ancestor grid entrance rules historically outranked the overlay's own
  // entrance (the staggered grid's nth-child animation-delay made the modal
  // flash visible → blank → fade-in — the "double blink"). On <body> only the
  // dedicated .dialog-overlay/.dialog entrance applies, and it runs once per
  // open (insertion-only; data polls update props without remounting, so it
  // never replays).
  return createPortal(
    <div
      ref={overlayRef}
      className={`dialog-overlay${size === "viewport" ? " dialog-overlay-viewport" : ""}`}
      data-modal-root="true"
      data-state={open ? "open" : "closed"}
      onClick={
        open && onClose && dismissOnScrim
          ? (event) => {
              if (event.target === event.currentTarget) requestClose();
            }
          : undefined
      }
      onTransitionEnd={(event) => {
        if (!open && event.target === event.currentTarget && event.propertyName === "opacity")
          setExiting(false);
      }}
    >
      <div
        ref={dialogRef}
        className={`dialog${size === "viewport" ? " dialog-viewport" : ""}${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : "Dialog"}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-head">
          <div>
            {shown.kicker ? (
              <p className="kicker" id={kickerId}>
                {shown.kicker}
              </p>
            ) : null}
            {shown.title ? (
              <h2 className="section-title" id={titleId}>
                {shown.title}
              </h2>
            ) : null}
            {shown.sub ? <p className="section-sub">{shown.sub}</p> : null}
          </div>
          <button
            ref={closeRef}
            type="button"
            className="btn-icon"
            title="Close"
            aria-label="Close dialog"
            onClick={onClose ? requestClose : undefined}
          >
            <X size={16} />
          </button>
        </div>
        {confirmDiscard ? (
          <div className="dialog-discard" role="alert">
            <p>Discard unsaved changes?</p>
            <div className="row-actions">
              <button
                ref={keepEditingRef}
                type="button"
                className="btn btn-ghost"
                onClick={() => setConfirmDiscard(false)}
              >
                Keep editing
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  setConfirmDiscard(false);
                  onClose?.();
                }}
              >
                Discard
              </button>
            </div>
          </div>
        ) : null}
        <div ref={contentRef} className="dialog-body">
          {shown.children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export interface ModalActionsProps {
  /**
   * Convention (every dialog, no exceptions): Cancel first as
   * `<Button variant="ghost">`, the confirming primary/danger Button last, so
   * the committing action always sits where the eye and the Tab order end.
   * Cancel never carries a `permission` — leaving a dialog is not a privilege.
   */
  children: ReactNode;
  /** "end" (default) right-aligns the row; "between" pushes the first child left. */
  align?: "end" | "between";
}

/**
 * Dialog action row. Sticks to the bottom of the scrolling modal body, so a
 * long form never scrolls its Cancel/Save out of reach — the treatment that
 * used to exist for one dialog class only (`.form-footer`).
 */
export function ModalActions({ children, align = "end" }: ModalActionsProps) {
  return (
    <div className={`dialog-actions${align === "between" ? " dialog-actions-between" : ""}`}>
      {children}
    </div>
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
