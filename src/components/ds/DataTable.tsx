import { TableFrame } from "./TableFrame";
import { Fragment } from "react";
import type { ReactNode } from "react";

export interface DataTableColumn<T = unknown> {
  key: string;
  header: ReactNode;
  render?: (row: T, index: number) => ReactNode;
  /** mono → JetBrains Mono cell */
  mono?: boolean;
  /** muted → secondary text color */
  muted?: boolean;
  width?: number | string;
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
}: DataTableProps<T>) {
  return (
    // flush styling (no border, panel-matched corners) comes from the
    // `.panel .data-table-wrap` rule in app-glue — no inline overrides.
    <TableFrame>
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.key} style={col.width ? { width: col.width } : undefined}>
              {col.header}
            </th>
          ))}
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
                    className={
                      [col.mono ? "mono" : "", col.muted ? "muted" : ""].join(" ").trim() ||
                      undefined
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
