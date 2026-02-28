import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Clock,
  Globe,
  Server,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { DonutChart } from "../components/DonutChart";
import { EventLineChart } from "../components/EventLineChart";
import { StatCard } from "../components/StatCard";
import { StatusBadge } from "../components/StatusBadge";
import { TimeframeSelector } from "../components/TimeframeSelector";
import type { SummaryPayload, Timeframe } from "../types/telemetry";
import { formatDate, formatNumber, formatRate, timeAgo } from "../utils/format";
import {
  buildChart,
  buildTopSlices,
  computeRate,
  describeScope,
  filterEvents,
  filterPrevious,
} from "../utils/telemetry";

interface OverviewPageProps {
  summary: SummaryPayload;
}

export function OverviewPage({ summary }: OverviewPageProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>("1M");
  const all = summary.recent;

  const filtered = useMemo(() => filterEvents(all, timeframe), [all, timeframe]);
  const previous = useMemo(() => filterPrevious(all, timeframe), [all, timeframe]);

  const chart = useMemo(() => buildChart(filtered, timeframe), [filtered, timeframe]);
  const bySource = useMemo(
    () => buildTopSlices(filtered, (e) => e.source, 6),
    [filtered]
  );
  const byService = useMemo(
    () => buildTopSlices(filtered, (e) => e.service, 6),
    [filtered]
  );
  const byStatus = useMemo(
    () => buildTopSlices(filtered, (e) => e.status, 6),
    [filtered]
  );

  const rate = computeRate(all, 3_600_000);
  const ratePrev = computeRate(all, 3_600_000, 3_600_000);

  const pctChange = (cur: number, prev: number) => {
    if (prev === 0 && cur === 0) return null;
    if (prev === 0) return "100";
    return ((cur - prev) / prev * 100).toFixed(1);
  };

  const delta = pctChange(filtered.length, previous.length);

  return (
    <div className="page-content">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold">Overview</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {describeScope(timeframe)} &middot; {filtered.length} events
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={summary.overallStatus} />
          <TimeframeSelector value={timeframe} onChange={setTimeframe} />
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Total Events"
          value={formatNumber(filtered.length)}
          sub={`${formatNumber(summary.stats.totalEvents)} all time`}
          icon={<Activity className="w-5 h-5" />}
          tone="primary"
          delta={delta}
        />
        <StatCard
          label="Ingest Rate"
          value={`${formatRate(rate)}/s`}
          sub={ratePrev > 0 ? `Previous: ${formatRate(ratePrev)}/s` : "No previous data"}
          icon={<Zap className="w-5 h-5" />}
          tone="accent"
          delta={ratePrev > 0 ? pctChange(rate, ratePrev) : null}
        />
        <StatCard
          label="Sources"
          value={String(summary.stats.sources)}
          sub={`${summary.stats.services} services tracked`}
          icon={<Server className="w-5 h-5" />}
          tone="amber"
        />
        <StatCard
          label="Last Ingest"
          value={timeAgo(summary.stats.lastIngestAt)}
          sub={formatDate(summary.stats.lastIngestAt)}
          icon={<Clock className="w-5 h-5" />}
          tone="rose"
        />
      </div>

      {/* Chart */}
      <div className="mb-6">
        <EventLineChart
          data={chart}
          title="Event Volume"
          subtitle={describeScope(timeframe)}
        />
      </div>

      {/* Donut charts grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <DonutChart
          data={bySource}
          title="By Source"
          subtitle="Event distribution by source"
          centerValue={summary.stats.sources}
          centerLabel="Sources"
        />
        <DonutChart
          data={byService}
          title="By Service"
          subtitle="Event distribution by service"
          centerValue={summary.stats.services}
          centerLabel="Services"
        />
        <DonutChart
          data={byStatus}
          title="By Status"
          subtitle="Event distribution by status"
          centerValue={filtered.length}
          centerLabel="Events"
        />
      </div>

      {/* Recent events table */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">Recent Events</h3>
          <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
            Last {Math.min(filtered.length, 10)} of {filtered.length}
          </span>
        </div>
        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[hsl(var(--border))]">
                <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">
                  Source
                </th>
                <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">
                  Service
                </th>
                <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">
                  Status
                </th>
                <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">
                  Message
                </th>
                <th className="text-right py-2 font-medium text-[hsl(var(--muted-foreground))]">
                  Time
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 10).map((evt) => (
                <tr
                  key={evt.id}
                  className="border-b border-[hsl(var(--border)/0.5)] last:border-0 hover:bg-[hsl(var(--muted)/0.3)] transition-colors"
                >
                  <td className="py-2.5 pr-4 font-medium">{evt.source}</td>
                  <td className="py-2.5 pr-4 text-[hsl(var(--muted-foreground))]">
                    {evt.service}
                  </td>
                  <td className="py-2.5 pr-4">
                    <StatusBadge status={evt.status} />
                  </td>
                  <td className="py-2.5 pr-4 text-[hsl(var(--muted-foreground))] max-w-[200px] truncate">
                    {evt.message ?? "—"}
                  </td>
                  <td className="py-2.5 text-right text-[hsl(var(--muted-foreground))]">
                    {timeAgo(evt.timestamp)}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="py-8 text-center text-[hsl(var(--muted-foreground))]"
                  >
                    No events in this timeframe
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
