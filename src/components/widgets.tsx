/** DS metrics widgets: Sparkline, RadialGauge, RankList — small, dependency-free
 *  SVG/DOM pieces ported from design-system/components/metrics. Styling lives in
 *  the design system stylesheet (.tile-spark, .gauge*, .rank*). */
import { useMemo } from "react";

let sparkUid = 0;

interface SparklineProps {
  /** Raw series — scaled to fit. Needs 2+ points or renders nothing. */
  values: number[];
  /** Default 64×26 — sized for the KPI tile's right side. */
  width?: number;
  height?: number;
  /** Line color. Default var(--accent); use var(--chart-errors) for error series. */
  color?: string;
}

/** Tiny inline area sparkline for KPI tiles. */
export function Sparkline({
  values,
  width = 64,
  height = 26,
  color = "var(--accent)",
}: SparklineProps) {
  const gid = useMemo(() => `spk-${++sparkUid}`, []);
  if (values.length < 2) {
    return null;
  }

  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(1, max - min);
  const step = width / (values.length - 1);
  const points = values.map(
    (v, i) => [i * step, height - 2 - ((v - min) / span) * (height - 5)] as const,
  );
  const line = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join("");
  const area = `${line}L${width},${height}L0,${height}Z`;

  return (
    <svg
      className="tile-spark"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

interface RadialGaugeProps {
  /** 0–1 fill ratio */
  ratio: number;
  /** e.g. "Version adoption" */
  title: string;
  /** e.g. "162 of 220 on 1.6.x" */
  sub?: string;
  /** Diameter in px. Default 64. */
  size?: number;
}

/** Donut gauge with the percentage in the center — accent stroke with soft glow. */
export function RadialGauge({ ratio, title, sub, size = 64 }: RadialGaugeProps) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  return (
    <div className="gauge">
      <svg className="gauge-svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          className="gauge-track"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
        />
        <circle
          className="gauge-fill"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text className="gauge-num" x="50%" y="50%" dominantBaseline="central" textAnchor="middle">
          {Math.round(clamped * 100)}%
        </text>
      </svg>
      <div className="gauge-meta">
        <span className="gauge-title">{title}</span>
        {sub ? <span className="gauge-sub">{sub}</span> : null}
      </div>
    </div>
  );
}

interface RankListProps {
  /** Sorted descending by the caller. share is 0–1 of the max/total. */
  items: Array<{ label: string; value: string; share: number }>;
}

/** Ranked share bars — versions, countries, platforms. Accent-gradient fills grow in. */
export function RankList({ items }: RankListProps) {
  if (items.length === 0) {
    return (
      <p style={{ padding: "10px 0", fontSize: "0.8125rem", color: "var(--text-2)", margin: 0 }}>
        No data.
      </p>
    );
  }

  return (
    <div className="rank">
      {items.map((item) => (
        <div className="rank-row" key={item.label}>
          <span className="rank-label" title={item.label}>
            {item.label}
          </span>
          <span className="rank-track">
            <span
              className="rank-fill"
              style={{ width: `${Math.min(100, Math.max(2, Math.round(item.share * 100)))}%` }}
            />
          </span>
          <span className="rank-value">{item.value}</span>
        </div>
      ))}
    </div>
  );
}
