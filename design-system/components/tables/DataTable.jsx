import React from "react";

/**
 * Console data table — uppercase hairline header, row hover, optional
 * expandable rows. Pure presentation; pass renderers per column.
 */
export function DataTable({ columns, rows, rowKey, expandedKey = null, renderExpanded, flush = false }) {
  return (
    <div className="data-table-wrap" style={flush ? { borderRadius: 0, border: "none" } : undefined}>
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} style={col.width ? { width: col.width } : undefined}>{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const key = rowKey ? rowKey(row, i) : i;
            const expanded = expandedKey !== null && expandedKey === key;
            return (
              <React.Fragment key={key}>
                <tr className={expanded ? "row-expanded" : ""}>
                  {columns.map((col) => (
                    <td key={col.key} className={[col.mono ? "mono" : "", col.muted ? "muted" : ""].join(" ").trim() || undefined}>
                      {col.render ? col.render(row, i) : row[col.key]}
                    </td>
                  ))}
                </tr>
                {expanded && renderExpanded ? (
                  <tr>
                    <td colSpan={columns.length} className="row-expand-panel">
                      <div className="row-expand-inner">{renderExpanded(row, i)}</div>
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Labeled mono-value cells for expanded row detail grids. */
export function DetailGrid({ items }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
      {items.map(({ k, v }) => (
        <div key={k} className="glass-inset" style={{ padding: "8px 12px" }}>
          <p className="label-sm" style={{ marginBottom: 3 }}>{k}</p>
          <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--text-1)", wordBreak: "break-all", margin: 0 }}>{v}</p>
        </div>
      ))}
    </div>
  );
}
