/**
 * DS port of design-system/components/metrics/RadialGauge.
 *
 * Donut gauge with the percentage centered — adoption rates, RPC share,
 * coverage. Accent stroke with a soft drop-shadow glow; the fill animates
 * (var(--t-fill) ease-out) on mount/update. Track is --surface-3; the number is
 * Space Grotesk.
 */
export interface RadialGaugeProps {
  /** 0–1 fill ratio */
  ratio: number;
  /** e.g. "Version adoption" */
  title: string;
  /** e.g. "162 of 220 on 1.6.x" */
  sub?: string;
  /** Diameter in px. Default 64. */
  size?: number;
}

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
