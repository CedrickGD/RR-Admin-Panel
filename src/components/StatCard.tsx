import type { ReactNode } from "react";

type Tone = "primary" | "accent" | "amber" | "rose";

const TONE_MAP: Record<Tone, { icon: string }> = {
  primary: {
    icon: "bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]",
  },
  accent: {
    icon: "bg-[hsl(var(--accent)/0.12)] text-[hsl(var(--accent))]",
  },
  amber: {
    icon: "bg-amber-500/12 text-amber-500",
  },
  rose: {
    icon: "bg-rose-500/12 text-rose-500",
  },
};

interface StatCardProps {
  label: string;
  value: string;
  sub: string;
  icon: ReactNode;
  tone?: Tone;
  delta?: string | null;
}

export function StatCard({
  label,
  value,
  sub,
  icon,
  tone = "primary",
  delta,
}: StatCardProps) {
  const t = TONE_MAP[tone];

  return (
    <article className="stat-card">
      <div className="stat-card-top">
        <p className="stat-card-label">{label}</p>
        <div className={`stat-card-icon ${t.icon}`}>{icon}</div>
      </div>
      <div className="stat-card-body">
        <div className="stat-card-value-row">
          <p className="stat-card-value">{value}</p>
          {delta !== undefined && delta !== null ? (
            <span
              className={`stat-card-delta ${
                Number(delta) >= 0 ? "stat-card-delta-positive" : "stat-card-delta-negative"
              }`}
            >
              {Number(delta) >= 0 ? "+" : ""}
              {delta}%
            </span>
          ) : null}
        </div>
        <p className="stat-card-sub">{sub}</p>
      </div>
    </article>
  );
}
