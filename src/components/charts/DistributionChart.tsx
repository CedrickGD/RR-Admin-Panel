import { useId, type CSSProperties } from "react";
import "../../theme/distribution-charts.css";

export interface DistributionDatum {
  label: string;
  value: number;
  color?: string;
}

interface DistributionChartProps {
  title: string;
  description?: string;
  data: readonly DistributionDatum[];
  variant?: "bars" | "donut";
  unavailable?: boolean;
  maxItems?: number;
  emptyMessage?: string;
}

const PALETTE = [
  "var(--chart-users)",
  "var(--chart-sessions)",
  "color-mix(in srgb, var(--accent) 60%, #38bdf8)",
  "color-mix(in srgb, var(--accent) 45%, #fbbf24)",
  "color-mix(in srgb, var(--chart-users) 50%, #2dd4bf)",
  "color-mix(in srgb, var(--chart-sessions) 55%, #fb923c)",
];

function categoryColor(label: string): string {
  if (/^(unknown|not reported|other)(\b|$)/i.test(label)) return "var(--text-3)";
  let hash = 0;
  for (const character of label) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

/** Keep the full denominator, including categories folded into the tail. */
export function buildDistribution(data: readonly DistributionDatum[], maxItems = 6) {
  const merged = new Map<string, DistributionDatum>();
  let total = 0;
  for (const item of data) {
    if (!Number.isFinite(item.value) || item.value < 0) {
      return { valid: false, total: 0, items: [] as DistributionDatum[] };
    }
    const label = item.label.trim() || "Unknown";
    const previous = merged.get(label);
    merged.set(label, {
      label,
      value: (previous?.value ?? 0) + item.value,
      color: previous?.color ?? item.color ?? categoryColor(label),
    });
    total += item.value;
  }
  if (!Number.isFinite(total)) return { valid: false, total: 0, items: [] as DistributionDatum[] };
  const sorted = [...merged.values()].sort((a, b) => b.value - a.value);
  const limit = Number.isFinite(maxItems) ? Math.max(2, Math.floor(maxItems)) : 6;
  const positive = sorted.filter((item) => item.value > 0);
  const zero = sorted.filter((item) => item.value === 0);
  if (positive.length <= limit) return { valid: true, total, items: sorted };
  const tail = positive.slice(limit - 1);
  let otherLabel = `Other (${tail.length} categories)`;
  while (merged.has(otherLabel)) otherLabel += " (grouped)";
  return {
    valid: true,
    total,
    items: [
      ...positive.slice(0, limit - 1),
      {
        label: otherLabel,
        value: tail.reduce((sum, item) => sum + item.value, 0),
        color: "var(--text-3)",
      },
      ...zero,
    ],
  };
}

function shareLabel(value: number, total: number): string {
  const share = (value / total) * 100;
  return share > 0 && share < 0.1
    ? "<0.1%"
    : `${share.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

export function DistributionChart({
  title,
  description,
  data,
  variant = "bars",
  unavailable = false,
  maxItems = 6,
  emptyMessage = "No records in this selection",
}: DistributionChartProps) {
  const id = useId();
  const { valid, total, items } = buildDistribution(data, maxItems);
  const missing = unavailable || !valid;
  const maximum = Math.max(0, ...items.map((item) => item.value));
  let offset = 0;

  return (
    <section
      className={`panel distribution-card distribution-card--${variant}`}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-description` : undefined}
    >
      <header className="distribution-head">
        <div>
          <h2 className="section-title" id={`${id}-title`}>
            {title}
          </h2>
          {description && (
            <p className="section-sub" id={`${id}-description`}>
              {description}
            </p>
          )}
        </div>
        {!missing && (
          <div className="distribution-total" aria-label={`Total: ${total.toLocaleString()}`}>
            <strong>{total.toLocaleString()}</strong>
            <span>Total</span>
          </div>
        )}
      </header>
      {missing ? (
        <p className="distribution-empty" role="status">
          Chart data unavailable
        </p>
      ) : (
        <div className="distribution-body">
          {variant === "donut" && (
            <svg
              className="distribution-donut"
              viewBox="0 0 160 160"
              role="img"
              aria-label={`${title}: ${total > 0 ? `${total.toLocaleString()} total; breakdown listed alongside` : "no records"}`}
            >
              <circle
                className="distribution-ring-track"
                cx="80"
                cy="80"
                r="62"
                fill="none"
                strokeWidth="15"
              />
              {total > 0 &&
                items
                  .filter((item) => item.value > 0)
                  .map((item) => {
                    const share = (item.value / total) * 100;
                    const start = offset;
                    offset += share;
                    return (
                      <circle
                        key={item.label}
                        className="distribution-ring-segment"
                        cx="80"
                        cy="80"
                        r="62"
                        fill="none"
                        stroke={item.color}
                        strokeWidth="15"
                        pathLength="100"
                        strokeDasharray={`${share} ${100 - share}`}
                        strokeDashoffset={-start}
                        transform="rotate(-90 80 80)"
                      >
                        <title>{`${item.label}: ${item.value.toLocaleString()} (${shareLabel(item.value, total)})`}</title>
                      </circle>
                    );
                  })}
              <text className="distribution-ring-caption" x="80" y="77" textAnchor="middle">
                {total > 0 ? "Share" : "No data"}
              </text>
              <text className="distribution-ring-detail" x="80" y="96" textAnchor="middle">
                {total > 0 ? "of total" : "in selection"}
              </text>
            </svg>
          )}
          <div className="distribution-breakdown">
            {total === 0 && <p className="distribution-empty">{emptyMessage}</p>}
            {items.length > 0 && (
              <ul className="distribution-list" aria-label={`${title} breakdown`}>
                {items.map((item) => (
                  <li
                    key={item.label}
                    className="distribution-row"
                    data-value={item.value}
                    style={{ "--distribution-color": item.color } as CSSProperties}
                  >
                    <div className="distribution-row-label">
                      <span className="distribution-label">
                        <i className="distribution-dot" aria-hidden="true" />
                        {item.label}
                      </span>
                      <span className="distribution-count">
                        {item.value.toLocaleString()}
                        {total > 0 && <small>{shareLabel(item.value, total)}</small>}
                      </span>
                    </div>
                    {variant === "bars" && (
                      <div className="distribution-bar-track" aria-hidden="true">
                        <span
                          className="distribution-bar"
                          style={{ width: `${maximum > 0 ? (item.value / maximum) * 100 : 0}%` }}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
