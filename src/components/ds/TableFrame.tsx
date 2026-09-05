import type { ReactNode, TableHTMLAttributes } from "react";

/** One scroll container and table anatomy for every workspace list. */
export function TableFrame({
  children,
  className = "",
  paginated = false,
  ...props
}: TableHTMLAttributes<HTMLTableElement> & {
  paginated?: boolean;
}) {
  return (
    <div className={`data-table-wrap${paginated ? " data-table-wrap-paginated" : ""}`}>
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
