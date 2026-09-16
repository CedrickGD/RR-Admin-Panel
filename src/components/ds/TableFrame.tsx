import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
  type TableHTMLAttributes,
} from "react";

export interface TableFrameProps extends TableHTMLAttributes<HTMLTableElement> {
  /** Reserve room for a <TablePagination> footer under the frame. */
  paginated?: boolean;
  /**
   * Pin the last column to the right edge so a row action stays reachable while
   * the frame scrolls sideways. Opt-in: only tables whose last cell is an action
   * cell should use it.
   */
  stickyActions?: boolean;
  /**
   * Width floor before the frame starts scrolling horizontally. Number → px,
   * `"auto"` → no floor (the table shrinks to its columns' min-content).
   * Omitted keeps the shared 760px default from the stylesheet.
   */
  minWidth?: number | string;
  /** `"stack"` renders each row as a labelled card below 900px instead of scrolling. */
  mobileLayout?: "scroll" | "stack";
}

/** One scroll container and table anatomy for every workspace list. */
export function TableFrame({
  children,
  className = "",
  paginated = false,
  stickyActions = false,
  minWidth,
  mobileLayout = "scroll",
  style,
  ...props
}: TableFrameProps) {
  const frame = useRef<HTMLDivElement>(null);
  // True while columns are still hidden to the right of the viewport — i.e. while
  // the pinned action column actually covers something. Drives the opaque fill and
  // the drop shadow, so an unscrolled table shows no artificial column band.
  const [clipped, setClipped] = useState(false);
  // A scroll container that holds no focusable cell is unreachable by keyboard
  // (WCAG 2.1.1) unless it is focusable itself — the release table on Versions is
  // exactly that. Measured, not assumed: a table that fits gets no tab stop.
  const [scrollable, setScrollable] = useState(false);
  // Names that focusable region. The table's own <caption> already says what the
  // list is, so no page has to repeat it.
  const [regionLabel, setRegionLabel] = useState<string | undefined>(undefined);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    // Scrolling only changes what the pinned column covers — the cheap check.
    const updateClip = () => {
      if (stickyActions) {
        setClipped(element.scrollWidth - element.clientWidth - element.scrollLeft > 1);
      }
    };
    // Size changes additionally decide whether the frame needs a tab stop and how
    // tall it may be.
    const measure = () => {
      updateClip();
      setRegionLabel(element.querySelector("caption")?.textContent?.trim() || undefined);
      setScrollable(
        element.scrollWidth - element.clientWidth > 1 ||
          element.scrollHeight - element.clientHeight > 1,
      );
      // app-glue.css turns this into the frame's max-height (100dvh − top −
      // pager) so the pinned header, the pager and the horizontal scrollbar stay
      // on screen. The chrome above a table differs per page — bare panel head to
      // header + tabs + KPI row + filter bar — so it is measured here instead of
      // living on the stylesheet's 310px fallback.
      element.style.setProperty(
        "--table-top",
        `${Math.max(0, Math.round(element.getBoundingClientRect().top))}px`,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    if (element.parentElement) observer.observe(element.parentElement);
    element.addEventListener("scroll", updateClip, { passive: true });
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", updateClip);
      window.removeEventListener("resize", measure);
    };
  }, [stickyActions]);
  const frameClass = [
    "data-table-wrap",
    paginated ? "data-table-wrap-paginated" : "",
    clipped ? "is-x-clipped" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const tableClass = [
    "data-table",
    "record-table",
    stickyActions ? "table-frame--sticky-actions" : "",
    mobileLayout === "stack" ? "table-frame--stack" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const floor =
    minWidth === "auto" ? "0px" : typeof minWidth === "number" ? `${minWidth}px` : minWidth;
  const tableStyle =
    floor === undefined ? style : ({ ...style, "--table-min-w": floor } as CSSProperties);
  return (
    <div
      ref={frame}
      className={frameClass}
      tabIndex={scrollable ? 0 : undefined}
      role={scrollable && regionLabel ? "region" : undefined}
      aria-label={scrollable && regionLabel ? regionLabel : undefined}
    >
      <table className={tableClass} style={tableStyle} {...props}>
        {children}
      </table>
    </div>
  );
}

export interface RecordLinkProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

/**
 * The identity inside a record cell, as a link-styled button. It reads as text
 * and underlines on hover (`.record-link`, theme/consistency.css) — no page
 * needs to hand-roll a bare <button> for a row that opens a workspace.
 */
export function RecordLink({
  children,
  className = "",
  type = "button",
  ...rest
}: RecordLinkProps) {
  return (
    <button type={type} className={`record-link${className ? ` ${className}` : ""}`} {...rest}>
      {children}
    </button>
  );
}

/**
 * A whole record header as one control: avatar, identity and supporting facts
 * open the record together, so a stacked card (TableFrame mobileLayout="stack")
 * gets its full card head as the tap target instead of the name alone. The
 * identity inside stays a plain <span className="record-link"> — it reads and
 * hovers as the link did, and no control nests in another. Pages pass an
 * explicit aria-label: without one the accessible name is every fact in the
 * header run together.
 */
export function RecordOpen({
  children,
  className = "",
  type = "button",
  ...rest
}: RecordLinkProps) {
  return (
    <button type={type} className={`record-open${className ? ` ${className}` : ""}`} {...rest}>
      {children}
    </button>
  );
}

/** A readable identity with supporting information and natural line wrapping. */
export function RecordCell({ primary, secondary }: { primary: ReactNode; secondary?: ReactNode }) {
  return (
    <span className="record-cell">
      <span className="record-primary">{primary}</span>
      {secondary && <span className="record-secondary">{secondary}</span>}
    </span>
  );
}
