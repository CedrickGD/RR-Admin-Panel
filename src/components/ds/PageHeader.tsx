/**
 * DS port of design-system/components/shell/PageHeader (PageHeader + MetaRow).
 *
 * Compact command-bar page header: kicker over title on the left,
 * filters/meta on the right. One per page, above the first panel row.
 *
 * Top-level pages pass `page` and get their H1 from PAGE_META (pageHeading) — the same name
 * the sidebar, the breadcrumb and the tab title use — instead of a `title`.
 *
 * Deviation from the DS contract: an optional `sub` prop is accepted for a
 * subtitle line. It RENDERS — `.page-subtitle` was hidden by the v2 glue CSS
 * once and that rule is gone; theme/workspace.css's `.page-header
 * .page-subtitle` owns the line now. Use it only when it carries a fact, e.g.
 * "Checked automatically every 15 seconds"; the marketing sentences that made
 * it worth hiding have been deleted.
 */
import type { ReactNode } from "react";
import { pageHeading } from "../../pageMeta";
import type { PageKey } from "../../types/telemetry";

export type PageHeaderProps = {
  /**
   * Uppercase accent micro-label above the title, e.g. "Failures", "Geography".
   * Eight call sites on seven pages still pass one, but nothing shows it:
   * theme/workspace.css hides `.page-header .kicker` (together with the panel
   * and stat-card ones) and the top-bar breadcrumb plays the role instead.
   * Kept because it is used — deleting it is a visual decision, not a rename
   * (audit F067). ds/Modal's `kicker` is a different prop and does render.
   */
  kicker?: string;
  /** Subtitle line — rendered as .page-subtitle, and visible. */
  sub?: ReactNode;
  /** Filter bar, badges, MetaRow */
  right?: ReactNode;
} & (
  | {
      /** Top-level page: the H1 defaults to pageHeading(page). */
      page: PageKey;
      /** Override for sub-views only — omit so the page keeps its one name. */
      title?: ReactNode;
    }
  | {
      page?: undefined;
      /** Free title for headers that are not a top-level page. */
      title: ReactNode;
    }
);

export function PageHeader({ kicker, page, title, sub, right }: PageHeaderProps) {
  const heading = title ?? (page ? pageHeading(page) : null);
  return (
    <section className="page-header">
      <div>
        <h1 className="page-title">
          {kicker ? <span className="kicker">{kicker}</span> : null}
          {heading}
        </h1>
        {sub ? <p className="page-subtitle">{sub}</p> : null}
      </div>
      {right ? <div className="page-header-right">{right}</div> : null}
    </section>
  );
}

export interface MetaRowProps {
  /**
   * e.g. [{ label: "Peak customers/h", value: "14" }, { label: "Errors", value: "3" }].
   * `value` is a ReactNode so a stat can be a live element, e.g. <RelativeTime iso={…} />.
   */
  items: Array<{ label: string; value: ReactNode }>;
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
