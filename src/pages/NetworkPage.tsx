import { BarChart3, Globe, Radio, RefreshCw, Wifi } from "lucide-react";
import { useMemo, useState } from "react";
import { DonutChart } from "../components/DonutChart";
import { EventLineChart } from "../components/EventLineChart";
import { StatCard } from "../components/StatCard";
import { TimeframeSelector } from "../components/TimeframeSelector";
import type { SummaryPayload, Timeframe } from "../types/telemetry";
import { formatNumber, formatRate } from "../utils/format";
import {
  buildChart,
  buildTopSlices,
  collectMetricKeys,
  computeRate,
  describeScope,
  filterEvents,
  isUpdateCheckEvent,
  mostCommonMetric,
} from "../utils/telemetry";

interface NetworkPageProps {
  summary: SummaryPayload;
}

export function NetworkPage({ summary }: NetworkPageProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>("1M");
  const timeframeEvents = useMemo(
    () => filterEvents(summary.recent, timeframe),
    [summary.recent, timeframe]
  );
  const coreEvents = useMemo(
    () => timeframeEvents.filter((event) => !isUpdateCheckEvent(event)),
    [timeframeEvents]
  );
  const updateChecks = useMemo(
    () => timeframeEvents.filter((event) => isUpdateCheckEvent(event)),
    [timeframeEvents]
  );

  const chart = useMemo(() => buildChart(coreEvents, timeframe), [coreEvents, timeframe]);
  const bySource = useMemo(
    () => buildTopSlices(coreEvents, (event) => event.source, 6),
    [coreEvents]
  );
  const byService = useMemo(
    () => buildTopSlices(coreEvents, (event) => event.service, 6),
    [coreEvents]
  );
  const trackedActions = useMemo(() => collectMetricKeys(coreEvents, 8), [coreEvents]);
  const uniqueTrackedActions = useMemo(() => {
    const keys = new Set<string>();
    for (const event of coreEvents) {
      for (const key of Object.keys(event.metrics)) {
        const normalized = key.trim();
        if (normalized) {
          keys.add(normalized);
        }
      }
    }
    return keys.size;
  }, [coreEvents]);

  const rate = computeRate(coreEvents, 3_600_000);
  const topRegion = mostCommonMetric(
    coreEvents,
    ["region", "geo", "country", "location", "client_country"],
    "N/A"
  );
  const uniqueSources = new Set(coreEvents.map((event) => event.source)).size;
  const uniqueServices = new Set(coreEvents.map((event) => event.service)).size;

  return (
    <div className="page-content">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold">Network</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {describeScope(timeframe)} · core events: {coreEvents.length} · update checks: {updateChecks.length}
          </p>
        </div>
        <TimeframeSelector value={timeframe} onChange={setTimeframe} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 mb-6">
        <StatCard
          label="Throughput"
          value={`${formatRate(rate)}/s`}
          sub="Core ingest rate"
          icon={<Radio className="w-5 h-5" />}
          tone="primary"
        />
        <StatCard
          label="Unique Sources"
          value={String(uniqueSources)}
          sub="Active in timeframe"
          icon={<Wifi className="w-5 h-5" />}
          tone="accent"
        />
        <StatCard
          label="Top Region"
          value={topRegion}
          sub="Most common location"
          icon={<Globe className="w-5 h-5" />}
          tone="amber"
        />
        <StatCard
          label="Tracked Actions"
          value={String(uniqueTrackedActions)}
          sub="Distinct tracked keys"
          icon={<BarChart3 className="w-5 h-5" />}
          tone="rose"
        />
        <StatCard
          label="Update Checks"
          value={formatNumber(updateChecks.length)}
          sub="Not included in charts"
          icon={<RefreshCw className="w-5 h-5" />}
          tone="accent"
        />
      </div>

      <div className="mb-6">
        <EventLineChart
          data={chart}
          title="Core Traffic"
          subtitle={`Ingest volume (update checks excluded) — ${describeScope(timeframe)}`}
        />
      </div>

      <div
        className={`grid grid-cols-1 ${bySource.length > 1 ? "md:grid-cols-2 lg:grid-cols-3" : "md:grid-cols-2"} gap-4 mb-6`}
      >
        {bySource.length > 1 ? (
          <DonutChart
            data={bySource}
            title="Traffic by Source"
            subtitle="Core event distribution by source"
            centerValue={uniqueSources}
            centerLabel="Sources"
          />
        ) : null}
        <DonutChart
          data={byService}
          title="Traffic by Service"
          subtitle="Core event distribution by service"
          centerValue={uniqueServices}
          centerLabel="Services"
        />
      </div>

      <div className="card p-5">
        <h3 className="text-sm font-semibold mb-4">Tracked Actions Snapshot</h3>
        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[hsl(var(--border))]">
                <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">
                  Key
                </th>
                <th className="text-right py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">
                  Occurrences
                </th>
                <th className="text-left py-2 font-medium text-[hsl(var(--muted-foreground))]">
                  Distribution
                </th>
              </tr>
            </thead>
            <tbody>
              {trackedActions.map((item) => {
                const percentage =
                  coreEvents.length > 0
                    ? ((item.count / coreEvents.length) * 100).toFixed(1)
                    : "0";
                return (
                  <tr
                    key={item.key}
                    className="border-b border-[hsl(var(--border)/0.5)] last:border-0 hover:bg-[hsl(var(--muted)/0.3)] transition-colors"
                  >
                    <td className="py-2.5 pr-4 font-[JetBrains_Mono,monospace] font-medium">
                      {item.key}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-[JetBrains_Mono,monospace]">
                      {formatNumber(item.count)}
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 rounded-full bg-[hsl(var(--muted))] flex-1 max-w-[140px]">
                          <div
                            className="h-full rounded-full bg-[hsl(var(--primary))]"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                        <span className="text-[hsl(var(--muted-foreground))] w-10 text-right">
                          {percentage}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {trackedActions.length === 0 ? (
                <tr>
                  <td
                    colSpan={3}
                    className="py-8 text-center text-[hsl(var(--muted-foreground))]"
                  >
                    No tracked actions found
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
