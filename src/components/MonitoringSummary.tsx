import type { ReactNode } from "react";

export function MonitoringSummary({
  items,
}: {
  items: Array<{ label: string; value: string; icon: ReactNode; tone: string; note?: string }>;
}) {
  return (
    <div className="monitor-metrics">
      {items.map((item) => (
        <div className="monitor-metric" key={item.label}>
          <span className="monitor-metric-icon" aria-hidden="true">
            {item.icon}
          </span>
          <div>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
          {item.note && <small>{item.note}</small>}
        </div>
      ))}
    </div>
  );
}
