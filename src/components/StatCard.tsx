import type { ReactNode } from "react";

type Tone = "primary" | "accent" | "amber" | "rose";

const TONE_MAP: Record<Tone, { icon: string; glow: string }> = {
  primary: {
    icon: "bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]",
    glow: "bg-[hsl(var(--primary))]",
  },
  accent: {
    icon: "bg-[hsl(var(--accent)/0.12)] text-[hsl(var(--accent))]",
    glow: "bg-[hsl(var(--accent))]",
  },
  amber: {
    icon: "bg-amber-500/12 text-amber-500",
    glow: "bg-amber-500",
  },
  rose: {
    icon: "bg-rose-500/12 text-rose-500",
    glow: "bg-rose-500",
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
    <article className="card card-hover p-5 relative overflow-hidden">
      <div className={`stat-glow ${t.glow}`} />
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2.5 rounded-xl ${t.icon}`}>{icon}</div>
        {delta !== undefined && delta !== null ? (
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded-md ${
              Number(delta) >= 0
                ? "text-emerald-500 bg-emerald-500/10"
                : "text-rose-400 bg-rose-500/10"
            }`}
          >
            {Number(delta) >= 0 ? "+" : ""}
            {delta}%
          </span>
        ) : null}
      </div>
      <p className="text-xs text-[hsl(var(--muted-foreground))] font-medium">
        {label}
      </p>
      <p className="text-2xl font-bold font-[JetBrains_Mono,monospace] tracking-tight mt-0.5">
        {value}
      </p>
      <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5">
        {sub}
      </p>
    </article>
  );
}
