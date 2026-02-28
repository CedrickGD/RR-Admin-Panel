import { Monitor, Server, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { DonutChart } from "../components/DonutChart";
import { StatCard } from "../components/StatCard";
import { StatusBadge } from "../components/StatusBadge";
import { TimeframeSelector } from "../components/TimeframeSelector";
import type { SummaryPayload, Timeframe } from "../types/telemetry";
import { formatNumber, timeAgo } from "../utils/format";
import {
  buildTopSlices,
  buildWorkers,
  describeScope,
  filterEvents,
  mostCommonMetric,
} from "../utils/telemetry";

interface WorkersPageProps {
  summary: SummaryPayload;
}

export function WorkersPage({ summary }: WorkersPageProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>("1M");

  const filtered = useMemo(
    () => filterEvents(summary.recent, timeframe),
    [summary.recent, timeframe]
  );
  const workers = useMemo(() => buildWorkers(filtered), [filtered]);
  const byPlatform = useMemo(
    () =>
      buildTopSlices(
        filtered,
        (e) =>
          typeof e.metrics === "object" && e.metrics !== null
            ? String(
                (e.metrics as Record<string, unknown>)["platform"] ??
                  (e.metrics as Record<string, unknown>)["os_platform"] ??
                  "unknown"
              )
            : "unknown",
        6
      ),
    [filtered]
  );

  const topPlatform = mostCommonMetric(
    filtered,
    ["platform", "os_platform", "os"],
    "N/A"
  );

  const activeWorkers = workers.filter((w) => w.status === "ok").length;

  return (
    <div className="page-content">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold">Workers</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {describeScope(timeframe)} &middot; {workers.length} worker
            {workers.length !== 1 ? "s" : ""} detected
          </p>
        </div>
        <TimeframeSelector value={timeframe} onChange={setTimeframe} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard
          label="Total Workers"
          value={String(workers.length)}
          sub={`${activeWorkers} currently active`}
          icon={<Users className="w-5 h-5" />}
          tone="primary"
        />
        <StatCard
          label="Worker Events"
          value={formatNumber(filtered.length)}
          sub="In selected timeframe"
          icon={<Server className="w-5 h-5" />}
          tone="accent"
        />
        <StatCard
          label="Top Platform"
          value={topPlatform}
          sub="Most common platform"
          icon={<Monitor className="w-5 h-5" />}
          tone="amber"
        />
      </div>

      {/* Donut + table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <DonutChart
          data={byPlatform}
          title="By Platform"
          subtitle="Worker platform distribution"
          centerValue={workers.length}
          centerLabel="Workers"
        />
        <div className="lg:col-span-2 card p-5">
          <h3 className="text-sm font-semibold mb-4">Worker Details</h3>
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[hsl(var(--border))]">
                  <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">
                    Name
                  </th>
                  <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">
                    Status
                  </th>
                  <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">
                    Platform
                  </th>
                  <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">
                    Version
                  </th>
                  <th className="text-right py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">
                    Events
                  </th>
                  <th className="text-right py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">
                    Services
                  </th>
                  <th className="text-right py-2 font-medium text-[hsl(var(--muted-foreground))]">
                    Last Seen
                  </th>
                </tr>
              </thead>
              <tbody>
                {workers.map((w) => (
                  <tr
                    key={w.name}
                    className="border-b border-[hsl(var(--border)/0.5)] last:border-0 hover:bg-[hsl(var(--muted)/0.3)] transition-colors"
                  >
                    <td className="py-2.5 pr-4 font-medium">{w.name}</td>
                    <td className="py-2.5 pr-4">
                      <StatusBadge status={w.status} />
                    </td>
                    <td className="py-2.5 pr-4 text-[hsl(var(--muted-foreground))]">
                      {w.platform}
                    </td>
                    <td className="py-2.5 pr-4 font-[JetBrains_Mono,monospace] text-[hsl(var(--muted-foreground))]">
                      {w.version}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-[JetBrains_Mono,monospace]">
                      {formatNumber(w.events)}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-[JetBrains_Mono,monospace]">
                      {w.services}
                    </td>
                    <td className="py-2.5 text-right text-[hsl(var(--muted-foreground))]">
                      {timeAgo(w.lastSeen)}
                    </td>
                  </tr>
                ))}
                {workers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="py-8 text-center text-[hsl(var(--muted-foreground))]"
                    >
                      No workers detected in this timeframe
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
