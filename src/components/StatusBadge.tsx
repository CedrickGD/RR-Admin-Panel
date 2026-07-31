import type { TelemetryStatus } from "../types/telemetry";

export type SessionPresence = "online" | "idle" | "unreachable" | "ended";

/**
 * Aligned to design-system/components/indicators/StatusBadge:
 * session presence badge with static colored dot; liveness is carried by
 * LiveBadge / the sidebar ingest dot — Online / Idle / Unreachable / Ended.
 */
const PRESENCE_STYLES: Record<SessionPresence, { className: string; label: string; dotClass: string }> = {
  online:      { className: "badge badge-success",  label: "Online",       dotClass: "status-dot" },
  idle:        { className: "badge badge-warning",  label: "Idle",         dotClass: "status-dot warn" },
  unreachable: { className: "badge badge-danger",   label: "Unreachable",  dotClass: "status-dot err" },
  ended:       { className: "badge badge-muted",    label: "Ended",        dotClass: "status-dot idle" },
};

interface StatusBadgeProps {
  /** Legacy prop — still accepted for backwards compat */
  status?: TelemetryStatus | "unknown";
  /** New presence-based prop — takes priority */
  presence?: SessionPresence;
  showDot?: boolean;
  label?: string;
}

/** Map legacy status values to presence */
function statusToPresence(status: TelemetryStatus | "unknown"): SessionPresence {
  switch (status) {
    case "ok": return "online";
    case "degraded": return "idle";
    case "down": return "unreachable";
    default: return "ended";
  }
}

export function StatusBadge({ status, presence, showDot = true, label }: StatusBadgeProps) {
  const resolved = presence ?? (status ? statusToPresence(status) : "ended");
  const style = PRESENCE_STYLES[resolved];
  return (
    <span className={style.className}>
      {showDot ? <span className={style.dotClass} /> : null}
      {label ?? style.label}
    </span>
  );
}
