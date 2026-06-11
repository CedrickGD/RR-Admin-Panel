import React from "react";

/**
 * Compact command-bar page header: kicker over title on the left,
 * filters/meta on the right. One per page, above the first panel row.
 */
export function PageHeader({ kicker, title, right }) {
  return (
    <section className="page-header">
      <div>
        <h1 className="page-title">
          {kicker ? <span className="kicker">{kicker}</span> : null}
          {title}
        </h1>
      </div>
      {right ? <div className="page-header-right">{right}</div> : null}
    </section>
  );
}

/** Right-aligned label/value stat pairs for page or panel headers. */
export function MetaRow({ items }) {
  return (
    <div className="meta-row">
      {items.map((m) => (
        <div className="meta-item" key={m.label}>
          <span>{m.label}</span>
          <strong>{m.value}</strong>
        </div>
      ))}
    </div>
  );
}
