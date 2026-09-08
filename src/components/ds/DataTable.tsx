import { TableFrame } from "./TableFrame";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { Fragment } from "react";
import type { CSSProperties, ReactNode } from "react";

export interface DataTableColumn<T = unknown> {
  key: string;
  header: ReactNode;
  render?: (row: T, index: number) => ReactNode;
  /** mono → JetBrains Mono cell */
  mono?: boolean;
  /** muted → secondary text color */
  muted?: boolean;
  /** numeric → right-aligned tabular figures on th and td (counts, durations) */
  numeric?: boolean;
  /** sortable → the header becomes a SortHeader button; needs `onSortChange` on the table */
  sortable?: boolean;
  /** Label used by the stacked mobile layout; defaults to `header` when that is a string. */
  label?: string;
  width?: number | string;
  /** Per-column floor. The table's own width floor is the sum of these when any is set. */
  minWidth?: number;
}

export interface SortState {
  key: string;
  direction: "asc" | "desc";
}

export interface DataTableProps<T = unknown> {
  columns: Array<DataTableColumn<T>>;
  rows: T[];
  rowKey?: (row: T, index: number) => string | number;
  /** Key of the currently expanded row (controlled), or null */
  expandedKey?: string | number | null;
  renderExpanded?: (row: T, index: number) => ReactNode;
  /** true when the table sits inside a Panel with padding="flush" */
  flush?: boolean;
  /** Pin the last column to the right edge while the frame scrolls sideways. */
  stickyActions?: boolean;
  /** "stack" turns each row into a labelled card below 900px. */
  mobileLayout?: "scroll" | "stack";
  /** Width floor before the frame scrolls; overrides the per-column `minWidth` sum. */
  minWidth?: number | string;
  /** Active sort, mirrored into `aria-sort` on the matching header. */
  sort?: SortState;
  /** Called with the column key when a sortable header is activated. */
  onSortChange?: (key: string) => void;
  /** Visually hidden <caption> naming the table for assistive technology. */
  caption?: string;
  /** Accessible name when no caption is wanted. */
  "aria-label"?: string;
}

export interface SortHeaderProps {
  /** Column key this header sorts by. */
  sortKey: string;
  label: ReactNode;
  /** Active sort of the whole table; the header compares it against `sortKey`. */
  sort?: SortState;
  onSortChange: (key: string) => void;
  className?: string;
  style?: CSSProperties;
}

/**
 * Sortable column header. Owns its own <th> so `aria-sort` and the button can
 * never drift apart, and always shows an icon: ArrowUp/ArrowDown for the active
 * column, a muted ChevronsUpDown for the others so the affordance is visible
 * before hovering.
 */
export function SortHeader({
  sortKey,
  label,
  sort,
  onSortChange,
  className,
  style,
}: SortHeaderProps) {
  const active = sort?.key === sortKey;
  const ascending = active && sort?.direction === "asc";
  return (
    <th
      scope="col"
      className={className}
      style={style}
      aria-sort={active ? (ascending ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        className={`table-sort${active ? " table-sort-active" : ""}`}
        onClick={() => onSortChange(sortKey)}
      >
        <span>{label}</span>
        {active ? (
          ascending ? (
            <ArrowUp className="table-sort-icon" aria-hidden="true" />
          ) : (
            <ArrowDown className="table-sort-icon" aria-hidden="true" />
          )
        ) : (
          <ChevronsUpDown className="table-sort-icon table-sort-icon-idle" aria-hidden="true" />
        )}
      </button>
    </th>
  );
}

/**
 * Console data table — uppercase hairline header, row hover, optional
 * expandable rows. Pure presentation; pass renderers per column.
 */
export function DataTable<T = unknown>({
  columns,
  rows,
  rowKey,
  expandedKey = null,
  renderExpanded,
  flush = false,
  stickyActions = false,
  mobileLayout = "scroll",
  minWidth,
  sort,
  onSortChange,
  caption,
  "aria-label": ariaLabel,
}: DataTableProps<T>) {
  const declaredMin = columns.reduce((total, col) => total + (col.minWidth ?? 0), 0);
  return (
    // flush styling (no border, panel-matched corners) comes from the
    // `.panel .data-table-wrap` rule in app-glue — no inline overrides.
    <TableFrame
      aria-label={ariaLabel}
      stickyActions={stickyActions}
      mobileLayout={mobileLayout}
      minWidth={minWidth ?? (declaredMin > 0 ? declaredMin : undefined)}
    >
      {caption ? <caption className="table-caption">{caption}</caption> : null}
      <thead>
        <tr>
          {columns.map((col) => {
            const thClass = col.numeric ? "numeric" : undefined;
            const style =
              col.width || col.minWidth ? { width: col.width, minWidth: col.minWidth } : undefined;
            return col.sortable && onSortChange ? (
              <SortHeader
                key={col.key}
                sortKey={col.key}
                label={col.header}
                sort={sort}
                onSortChange={onSortChange}
                className={thClass}
                style={style}
              />
            ) : (
              <th key={col.key} scope="col" className={thClass} style={style}>
                {col.header}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const key = rowKey ? rowKey(row, i) : i;
          const expanded = expandedKey !== null && expandedKey === key;
          return (
            <Fragment key={key}>
              <tr className={expanded ? "row-expanded" : ""}>
                {columns.map((col) => (
                  <td
                    key={col.key}
                    // The stacked mobile layout prints this as the cell's label.
                    data-label={
                      col.label ?? (typeof col.header === "string" ? col.header : undefined)
                    }
                    className={
                      [
                        col.mono ? "mono" : "",
                        col.muted ? "muted" : "",
                        col.numeric ? "numeric" : "",
                      ]
                        .join(" ")
                        .trim() || undefined
                    }
                  >
                    {col.render
                      ? col.render(row, i)
                      : ((row as Record<string, unknown>)[col.key] as ReactNode)}
                  </td>
                ))}
              </tr>
              {expanded && renderExpanded ? (
                <tr>
                  <td colSpan={columns.length} className="row-expand-panel">
                    <div className="row-expand-content">{renderExpanded(row, i)}</div>
                  </td>
                </tr>
              ) : null}
            </Fragment>
          );
        })}
      </tbody>
    </TableFrame>
  );
}

export interface DetailGridProps {
  /** Label/value pairs rendered as inset mono cells, e.g. { k: "Session ID", v: "s_9f2e81c4" } */
  items: Array<{ k: string; v: ReactNode }>;
}

/** Labeled mono-value cells for expanded row detail grids. */
export function DetailGrid({ items }: DetailGridProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
        gap: 10,
      }}
    >
      {items.map(({ k, v }) => (
        <div key={k} className="glass-inset" style={{ padding: "8px 12px" }}>
          <p className="label-sm" style={{ marginBottom: 3 }}>
            {k}
          </p>
          <p
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.75rem",
              color: "var(--text-1)",
              wordBreak: "break-all",
              margin: 0,
            }}
          >
            {v}
          </p>
        </div>
      ))}
    </div>
  );
}
