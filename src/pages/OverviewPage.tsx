import { Activity, Clock, Radio, RefreshCw, Users, Zap } from "lucide-react";
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
  isHeartbeatEvent,
  isUpdateCheckEvent,
  readMetric,
} from "../utils/telemetry";

interface OverviewPageProps {
  summary: SummaryPayload;
}

function percentDelta(currentValue: number, previousValue: number): string | null {
  if (previousValue === 0 && currentValue === 0) {
    return null;
  }

  if (previousValue === 0) {
    return "100";
  }

  return (((currentValue - previousValue) / previousValue) * 100).toFixed(1);
}

export function OverviewPage({ summary }: OverviewPageProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>("1M");
  const allEvents = summary.recent;

  const coreAllEvents = useMemo(
    () => allEvents.filter((event) => !isUpdateCheckEvent(event)),
    [allEvents]
  );

  const filtered = useMemo(() => filterEvents(allEvents, timeframe), [allEvents, timeframe]);
  const previous = useMemo(() => filterPrevious(allEvents, timeframe), [allEvents, timeframe]);
  const filteredCore = useMemo(
    () => filtered.filter((event) => !isUpdateCheckEvent(event)),
    [filtered]
  );
  const previousCore = useMemo(
    () => previous.filter((event) => !isUpdateCheckEvent(event)),
    [previous]
  );
  const heartbeatEvents = useMemo(
    () => filteredCore.filter((event) => isHeartbeatEvent(event)),
    [filteredCore]
  );
  const updateChecks = useMemo(
    () => filtered.filter((event) => isUpdateCheckEvent(event)),
    [filtered]
  );
  const updateChecksPrev = useMemo(
    () => previous.filter((event) => isUpdateCheckEvent(event)),
    [previous]
  );

  const chart = useMemo(() => buildChart(heartbeatEvents, timeframe), [heartbeatEvents, timeframe]);
  const bySource = useMemo(
    () => buildTopSlices(filteredCore, (event) => event.source, 6),
    [filteredCore]
  );
  const byService = useMemo(
    () => buildTopSlices(filteredCore, (event) => event.service, 6),
    [filteredCore]
  );
  const byStatus = useMemo(
    () => buildTopSlices(filteredCore, (event) => event.status, 6),
    [filteredCore]
  );

  const updateCheckUsers = useMemo(() => {
    const ids = new Set<string>();
    for (const event of updateChecks) {
      const installId = readMetric(event.metrics, ["install_id", "installId"], "");
      if (installId) {
        ids.add(installId);
      }
    }
    return ids.size;
  }, [updateChecks]);

  const coreRate = computeRate(coreAllEvents, 3_600_000);
  const coreRatePrev = computeRate(coreAllEvents, 3_600_000, 3_600_000);
  const coreDelta = percentDelta(filteredCore.length, previousCore.length);
  const updateDelta = percentDelta(updateChecks.length, updateChecksPrev.length);

  return (
    <div className="page-content">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold">Overview</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {describeScope(timeframe)} · Core events: {filteredCore.length} · Update checks: {updateChecks.length}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={summary.overallStatus} />
          <TimeframeSelector value={timeframe} onChange={setTimeframe} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-4 mb-6">
        <StatCard
          label="Core Events"
          value={formatNumber(filteredCore.length)}
          sub={`${formatNumber(summary.stats.totalEvents)} all time`}
          icon={<Activity className="w-5 h-5" />}
          tone="primary"
          delta={coreDelta}
        />
        <StatCard
          label="Heartbeat Events"
          value={formatNumber(heartbeatEvents.length)}
          sub="Used for heartbeat chart"
          icon={<Radio className="w-5 h-5" />}
          tone="accent"
        />
        <StatCard
          label="Ingest Rate"
          value={`${formatRate(coreRate)}/s`}
          sub={coreRatePrev > 0 ? `Previous: ${formatRate(coreRatePrev)}/s` : "No previous data"}
          icon={<Zap className="w-5 h-5" />}
          tone="amber"
          delta={coreRatePrev > 0 ? percentDelta(coreRate, coreRatePrev) : null}
        />
        <StatCard
          label="Update Checks"
          value={formatNumber(updateChecks.length)}
          sub="Separated from core charts"
          icon={<RefreshCw className="w-5 h-5" />}
          tone="rose"
          delta={updateDelta}
        />
        <StatCard
          label="Update Check Users"
          value={String(updateCheckUsers)}
          sub="Distinct installs triggering checks"
          icon={<Users className="w-5 h-5" />}
          tone="accent"
        />
        <StatCard
          label="Last Ingest"
          value={timeAgo(summary.stats.lastIngestAt)}
          sub={formatDate(summary.stats.lastIngestAt)}
          icon={<Clock className="w-5 h-5" />}
          tone="primary"
        />
      </div>

      <div className="mb-6">
        <EventLineChart
          data={chart}
          title="Heartbeat Activity"
          subtitle={`${describeScope(timeframe)} · update checks excluded`}
        />
      </div>

      <div
        className={`grid grid-cols-1 ${bySource.length > 1 ? "md:grid-cols-3" : "md:grid-cols-2"} gap-4 mb-6`}
      >
        {bySource.length > 1 ? (
          <DonutChart
            data={bySource}
            title="By Source"
            subtitle="Core event distribution by source"
            centerValue={bySource.length}
            centerLabel="Sources"
          />
        ) : null}
        <DonutChart
          data={byService}
          title="By Service"
          subtitle="App start/stop/heartbeat mix"
          centerValue={filteredCore.length}
          centerLabel="Core"
        />
        <DonutChart
          data={byStatus}
          title="By Status"
          subtitle="Core event status"
          centerValue={filteredCore.length}
          centerLabel="Events"
        />
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">Recent Core Events</h3>
          <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
            Last {Math.min(filteredCore.length, 6)} of {filteredCore.length}
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
              {filteredCore.slice(0, 6).map((event) => (
                <tr
                  key={event.id}
                  className="border-b border-[hsl(var(--border)/0.5)] last:border-0 hover:bg-[hsl(var(--muted)/0.3)] transition-colors"
                >
                  <td className="py-2.5 pr-4 font-medium">{event.source}</td>
                  <td className="py-2.5 pr-4 text-[hsl(var(--muted-foreground))]">{event.service}</td>
                  <td className="py-2.5 pr-4">
                    <StatusBadge status={event.status} />
                  </td>
                  <td className="py-2.5 pr-4 text-[hsl(var(--muted-foreground))] max-w-[220px] truncate">
                    {event.message ?? "—"}
                  </td>
                  <td className="py-2.5 text-right text-[hsl(var(--muted-foreground))]">
                    {timeAgo(event.timestamp)}
                  </td>
                </tr>
              ))}
              {filteredCore.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="py-8 text-center text-[hsl(var(--muted-foreground))]"
                  >
                    No core events in this timeframe
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
