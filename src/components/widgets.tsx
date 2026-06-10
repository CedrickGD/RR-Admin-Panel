/** v2 widget set: Sparkline, RadialGauge, RankList — small, dependency-free SVG/DOM pieces. */

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}

/** Tiny inline area sparkline for stat tiles. */
export function Sparkline({ values, width = 64, height = 26, color = "var(--accent)" }: SparklineProps) {
  if (values.length < 2) {
    return null;
  }

  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(1, max - min);
  const step = width / (values.length - 1);
  const points = values.map((v, i) => [i * step, height - 2 - ((v - min) / span) * (height - 5)] as const);
  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const area = `${line}L${width},${height}L0,${height}Z`;
  const gid = `spk${Math.round(max * 1000 + values.length)}`;

  return (
    <svg className="tile-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
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
  /** 0..1 */
  ratio: number;
  title: string;
  sub?: string;
  size?: number;
}

/** Donut gauge with the percentage in the center. */
export function RadialGauge({ ratio, title, sub, size = 64 }: RadialGaugeProps) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  return (
    <div className="gauge">
      <svg className="gauge-svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="gauge-track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
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
  items: Array<{ label: string; value: string; share: number }>;
}

/** Ranked share bars (versions, countries, platforms). */
export function RankList({ items }: RankListProps) {
  if (items.length === 0) {
    return <p className="empty-state" style={{ padding: "10px 0" }}>No data.</p>;
  }

  return (
    <div className="rank">
      {items.map((item) => (
        <div className="rank-row" key={item.label}>
          <span className="rank-label" title={item.label}>{item.label}</span>
          <span className="rank-track">
            <span className="rank-fill" style={{ width: `${Math.min(100, Math.max(2, Math.round(item.share * 100)))}%` }} />
          </span>
          <span className="rank-value">{item.value}</span>
        </div>
      ))}
    </div>
  );
}
