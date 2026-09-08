/**
 * DS loading placeholders.
 *
 * Loading was told four ways: `.skeleton` blocks (Errors, Versions,
 * Customers), a centred grey sentence (`.monitor-loading` on Session history),
 * "Loading panel members…" inside an empty state (Team) and "Rollup loading…"
 * in a KPI sub line (Heatmap). One shape now: a skeleton stands in for the
 * content it is about to become, so the layout does not jump when data lands.
 * Text loaders stay only for inline sub-fetches (an expanded row's timeline).
 *
 * The shimmer is CSS (`.skeleton` in theme/css/components.css) and already
 * stops under `prefers-reduced-motion: reduce`; the block still shows.
 */
import type { CSSProperties } from "react";

export interface SkeletonProps {
  /** CSS width — number is px, string passes through ("55%", "min-content"). */
  width?: number | string;
  /** CSS height — number is px. Default 12 (one text line). */
  height?: number | string;
  /** Corner radius; defaults to the 6px block radius. Pass 999 for avatars/pills. */
  radius?: number | string;
  className?: string;
  style?: CSSProperties;
}

function size(value: number | string | undefined) {
  return typeof value === "number" ? `${value}px` : value;
}

/**
 * One shimmering block standing in for a value that is still loading.
 * A `<span>`, not a `<div>`: a skeleton often stands in for text inside a
 * `<p>` (the KPI sub line), where a block element would break the paragraph.
 */
export function Skeleton({ width, height = 12, radius, className = "", style }: SkeletonProps) {
  return (
    <span
      className={`skeleton${className ? ` ${className}` : ""}`}
      aria-hidden="true"
      style={{
        display: "block",
        width: size(width),
        height: size(height),
        borderRadius: size(radius),
        ...style,
      }}
    />
  );
}

export interface SkeletonRowsProps {
  /** Column count, or explicit per-column bar widths. */
  columns: number | Array<number | string>;
  /** Placeholder rows. Default 6 — one screenful of a record table. */
  rows?: number;
  /** Bar height. Default 12. */
  height?: number;
}

/**
 * Placeholder body rows for a record table. Renders `<tr>`s, so it goes
 * straight inside a `<tbody>`:
 *
 *   <tbody>{loading ? <SkeletonRows columns={5} /> : rows.map(...)}</tbody>
 *
 * A bare column count gives the first column a wide bar (the name/identity
 * column) and the rest narrow ones — the proportions the pages hand-rolled.
 */
export function SkeletonRows({ columns, rows = 6, height = 12 }: SkeletonRowsProps) {
  const widths =
    typeof columns === "number"
      ? Array.from({ length: columns }, (_, col) => (col === 0 ? 120 : 48))
      : columns;
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        // Hidden from assistive tech by construction: the cells hold nothing but
        // decorative bars, so without this a screen reader announces a handful of
        // blank rows while the data loads. The frame's aria-busy says the rest.
        <tr key={`skeleton-${row}`} className="skeleton-row" aria-hidden="true">
          {widths.map((width, col) => (
            <td key={col}>
              <Skeleton width={width} height={height} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
