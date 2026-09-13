import { useId, type ReactNode } from "react";

export interface RecordSectionProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A named, opaque work surface for a curated part of a record. */
export function RecordSection({
  title,
  description,
  action,
  children,
  className = "",
}: RecordSectionProps) {
  const headingId = useId();
  return (
    <section className={`record-section ${className}`.trim()} aria-labelledby={headingId}>
      <header className="record-section-head">
        <div className="record-section-heading">
          <h2 id={headingId}>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {action ? <div className="record-section-action">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}

export interface RecordFact {
  label: string;
  value: ReactNode;
  mono?: boolean;
}

/** Label/value pairs retain their semantic association at every viewport width. */
export function RecordFacts({
  items,
  className = "",
}: {
  items: RecordFact[];
  className?: string;
}) {
  return (
    <dl className={`record-facts ${className}`.trim()}>
      {items.map(({ label, value, mono }, index) => (
        <div className="record-fact" key={`${label}-${index}`}>
          <dt>{label}</dt>
          <dd className={mono ? "record-fact-mono" : undefined}>
            {value ?? <span className="record-fact-missing">Not recorded</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
