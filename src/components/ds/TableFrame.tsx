import { useLayoutEffect, useRef, type ReactNode, type TableHTMLAttributes } from "react";

/** One scroll container and table anatomy for every workspace list. */
export function TableFrame({
  children,
  className = "",
  paginated = false,
  ...props
}: TableHTMLAttributes<HTMLTableElement> & {
  paginated?: boolean;
}) {
  const frame = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const panel = element.closest(".panel, .monitor-surface") ?? element.parentElement;
    const page = element.closest(".page-content, .customer-workspace");
    let pending = 0;
    const measure = () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => {
        const footer = panel?.querySelector<HTMLElement>(".table-pagination");
        const top = element.getBoundingClientRect().top + window.scrollY;
        const available = Math.max(
          180,
          window.innerHeight - top - (footer?.offsetHeight ?? 0) - 28,
        );
        element.style.maxHeight = `${available}px`;
      });
    };
    const observer = new ResizeObserver(measure);
    if (page) observer.observe(page);
    if (panel) observer.observe(panel);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      cancelAnimationFrame(pending);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [paginated]);
  return (
    <div ref={frame} className={`data-table-wrap${paginated ? " data-table-wrap-paginated" : ""}`}>
      <table className={`data-table record-table ${className}`} {...props}>
        {children}
      </table>
    </div>
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
