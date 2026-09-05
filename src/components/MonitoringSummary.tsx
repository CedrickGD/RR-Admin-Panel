import type { ReactNode } from "react";
import { KpiStatCard } from "./KpiStatCard";

export function MonitoringSummary({
  items,
}: {
  items: Array<{ label: string; value: string; icon: ReactNode; tone: string; note?: string }>;
}) {
  return (
    <div className="stat-grid monitor-metrics">
      {items.map((item) => (
        <KpiStatCard key={item.label} label={item.label} value={item.value} sub={item.note ?? ""} />
      ))}
    </div>
  );
}
