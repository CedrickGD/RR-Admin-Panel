import { BarChart3, Globe, Radio, Wifi } from "lucide-react";
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
  mostCommonMetric,
} from "../utils/telemetry";

interface NetworkPageProps {
  summary: SummaryPayload;
}

export function NetworkPage({ summary }: NetworkPageProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>("1M");
  const filtered = useMemo(
    () => filterEvents(summary.recent, timeframe),
    [summary.recent, timeframe]
  );

  const chart = useMemo(() => buildChart(filtered, timeframe), [filtered, timeframe]);
  const bySource = useMemo(
    () => buildTopSlices(filtered, (e) => e.source, 6),
    [filtered]
  );
  const byService = useMemo(
    () => buildTopSlices(filtered, (e) => e.service, 6),
    [filtered]
  );
  const metricKeys = useMemo(() => collectMetricKeys(filtered, 10), [filtered]);

  const rate = computeRate(filtered, 3_600_000);
  const topRegion = mostCommonMetric(
    filtered,
    ["region", "geo", "country", "location"],
    "N/A"
  );
  const uniqueSources = new Set(filtered.map((e) => e.source)).size;

  return (
    <div className="page-content">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold">Network</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {describeScope(timeframe)} &middot; Traffic & metric analysis
          </p>
        </div>
        <TimeframeSelector value={timeframe} onChange={setTimeframe} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Throughput"
          value={`${formatRate(rate)}/s`}
          sub="Current ingest rate"
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
          label="Metric Keys"
          value={String(metricKeys.length)}
          sub="Unique keys tracked"
          icon={<BarChart3 className="w-5 h-5" />}
          tone="rose"
        />
      </div>

      {/* Line chart */}
      <div className="mb-6">
        <EventLineChart
          data={chart}
          title="Network Traffic"
          subtitle={`Ingest volume — ${describeScope(timeframe)}`}
        />
      </div>

      {/* Donuts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <DonutChart
          data={bySource}
          title="Traffic by Source"
          subtitle="Volume distribution by source"
          centerValue={uniqueSources}
          centerLabel="Sources"
        />
        <DonutChart
          data={byService}
          title="Traffic by Service"
          subtitle="Volume distribution by service"
          centerValue={byService.length}
          centerLabel="Services"
        />
      </div>

      {/* Metric keys table */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold mb-4">Top Metric Keys</h3>
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
              {metricKeys.map((mk) => {
                const pct =
                  filtered.length > 0
                    ? ((mk.count / filtered.length) * 100).toFixed(1)
                    : "0";
                return (
                  <tr
                    key={mk.key}
                    className="border-b border-[hsl(var(--border)/0.5)] last:border-0 hover:bg-[hsl(var(--muted)/0.3)] transition-colors"
                  >
                    <td className="py-2.5 pr-4 font-[JetBrains_Mono,monospace] font-medium">
                      {mk.key}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-[JetBrains_Mono,monospace]">
                      {formatNumber(mk.count)}
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 rounded-full bg-[hsl(var(--muted))] flex-1 max-w-[120px]">
                          <div
                            className="h-full rounded-full bg-[hsl(var(--primary))]"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-[hsl(var(--muted-foreground))] w-10 text-right">
                          {pct}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {metricKeys.length === 0 ? (
                <tr>
                  <td
                    colSpan={3}
                    className="py-8 text-center text-[hsl(var(--muted-foreground))]"
                  >
                    No metric keys found
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
