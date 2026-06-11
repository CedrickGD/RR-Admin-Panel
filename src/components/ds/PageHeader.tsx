/**
 * DS port of design-system/components/shell/PageHeader (PageHeader + MetaRow).
 *
 * Compact command-bar page header: kicker over title on the left,
 * filters/meta on the right. One per page, above the first panel row.
 *
 * Deviation from the DS contract: an optional `sub` prop is accepted for the
 * legacy page subtitles. It renders as `.page-subtitle`, which the v2 glue CSS
 * hides (subtitles are considered filler in v2) — the prop exists so pages
 * migrate without dropping copy or breaking compiles.
 */
import type { ReactNode } from "react";

export interface PageHeaderProps {
  /** Uppercase accent micro-label above the title, e.g. "Production Operations", "Realtime" */
  kicker?: string;
  /** One or two words: "Overview", "Live Sessions" */
  title: ReactNode;
  /** Legacy subtitle line — rendered as .page-subtitle (hidden by the v2 glue). */
  sub?: ReactNode;
  /** Filter bar, badges, MetaRow */
  right?: ReactNode;
}

export function PageHeader({ kicker, title, sub, right }: PageHeaderProps) {
  return (
    <section className="page-header">
      <div>
        <h1 className="page-title">
          {kicker ? <span className="kicker">{kicker}</span> : null}
          {title}
        </h1>
        {sub ? <p className="page-subtitle">{sub}</p> : null}
      </div>
      {right ? <div className="page-header-right">{right}</div> : null}
    </section>
  );
}

export interface MetaRowProps {
  /** e.g. [{ label: "Peak Users/h", value: "14" }, { label: "Errors", value: "3" }] */
  items: Array<{ label: string; value: string }>;
}

/** Right-aligned label/value stat pairs for page or panel headers. */
export function MetaRow({ items }: MetaRowProps) {
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
