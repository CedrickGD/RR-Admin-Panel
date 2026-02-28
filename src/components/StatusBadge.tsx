import type { TelemetryStatus } from "../types/telemetry";

const STATUS_STYLES: Record<TelemetryStatus | "unknown", { className: string; label: string }> = {
  ok: { className: "badge badge-success", label: "Operational" },
  degraded: { className: "badge badge-warning", label: "Degraded" },
  down: { className: "badge badge-danger", label: "Down" },
  unknown: { className: "badge badge-default", label: "Unknown" },
};

interface StatusBadgeProps {
  status: TelemetryStatus | "unknown";
  showDot?: boolean;
  label?: string;
}

export function StatusBadge({ status, showDot = true, label }: StatusBadgeProps) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.unknown;
  return (
    <span className={style.className}>
      {showDot ? <span className="status-dot" /> : null}
      {label ?? style.label}
    </span>
  );
}
