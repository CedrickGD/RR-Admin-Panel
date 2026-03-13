import type { ReactNode } from "react";

type Tone = "primary" | "accent" | "amber" | "rose";

const TONE_MAP: Record<Tone, { icon: string; card: string }> = {
  primary: {
    icon: "bg-[hsl(var(--primary)/0.14)] text-[hsl(var(--primary))]",
    card: "stat-card-primary",
  },
  accent: {
    icon: "bg-[hsl(var(--accent)/0.14)] text-[hsl(var(--accent))]",
    card: "stat-card-accent",
  },
  amber: {
    icon: "bg-[hsl(var(--warning)/0.16)] text-[hsl(var(--warning))]",
    card: "stat-card-amber",
  },
  rose: {
    icon: "bg-[hsl(var(--danger)/0.16)] text-[hsl(var(--danger))]",
    card: "stat-card-rose",
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
    <article className={`stat-card ${t.card}`}>
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
