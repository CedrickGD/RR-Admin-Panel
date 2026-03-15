import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { GeoDonutChart } from "../components/charts/GeoDonutChart";
import { TelemetryChartTooltip } from "../components/charts/TelemetryChartTooltip";
import type { SummaryPayload, ThemeMode } from "../types/telemetry";
import {
  buildCountryBreakdown,
  buildRegionBreakdown,
  buildVersionBreakdown,
} from "../utils/dashboardInsights";
import { getRegionColor } from "../utils/geography";
import { formatNumber, timeAgo } from "../utils/format";
import { buildDashboardChartPalette, COUNTRY_COLORS } from "./dashboardShared";

interface SignalsPageProps {
  summary: SummaryPayload;
  theme: ThemeMode;
}

export function SignalsPage({ summary, theme }: SignalsPageProps) {
  const regions = useMemo(() => buildRegionBreakdown(summary), [summary]);
  const countries = useMemo(() => buildCountryBreakdown(summary, 5, true), [summary]);
  const versions = useMemo(() => buildVersionBreakdown(summary), [summary]);
  const chartPalette = useMemo(() => buildDashboardChartPalette(theme), [theme]);
  const topRegion = regions[0];
  const topCountry = countries[0];
  const recentSignals = summary.recentErrors.slice(0, 5);
  const sessionsWithErrors = summary.recentSessions.filter((session) => session.errorCount > 0).length;
  const regionDonutData = useMemo(
    () =>
      regions.map((region) => ({
        label: region.label,
        value: region.value,
        share: region.share,
        color: getRegionColor(region.label),
        note: `${formatNumber(region.value)} sessions`,
      })),
    [regions],
  );
  const countryDonutData = useMemo(
    () =>
      countries.map((country, index) => ({
        label: country.label,
        value: country.value,
        share: country.share,
        color: COUNTRY_COLORS[index % COUNTRY_COLORS.length],
        note: country.region,
        flag: country.flag,
      })),
    [countries],
  );

  return (
    <div className="page-content page-content-wide page-stack">
      <section className="page-header">
        <div>
          <p className="page-kicker">Signal Analysis</p>
          <h1 className="page-title">Signals</h1>
          <p className="page-subtitle">
            Geographic mix, version concentration, and failure pressure separated onto their own page so the signal
            story is readable without scrolling through traffic and map views first.
          </p>
        </div>

        <div className="page-header-side">
          <div className="page-meta-stack page-meta-stack-live">
            <div className="page-meta">
              <span>Top region</span>
              <strong>{topRegion?.label ?? "Unknown"}</strong>
            </div>
            <div className="page-meta">
              <span>Top country</span>
              <strong>{topCountry?.label ?? "Unknown"}</strong>
            </div>
            <div className="page-meta">
              <span>With errors</span>
              <strong>{formatNumber(sessionsWithErrors)}</strong>
            </div>
            <div className="page-meta">
              <span>Latest</span>
              <strong>{summary.recentErrors[0] ? timeAgo(summary.recentErrors[0].timestamp) : "Clear"}</strong>
            </div>
          </div>
        </div>
      </section>

      <div className="signals-layout">
        <section className="panel panel-dense">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Distribution</p>
              <h2 className="panel-title">Regional and country concentration</h2>
              <p className="panel-subtitle">
                Geography stays isolated here so distribution shifts are obvious without mixing with the live map.
              </p>
            </div>
          </div>

          <div className="donut-grid">
            <GeoDonutChart data={regionDonutData} totalLabel="Regional share" metricLabel="Sessions" />
            <GeoDonutChart data={countryDonutData} totalLabel="Top countries" metricLabel="Sessions" />
          </div>
        </section>

        <section className="panel panel-dense">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Releases</p>
              <h2 className="panel-title">Version spread and current failures</h2>
              <p className="panel-subtitle">
                Release concentration and the latest application failures live together so rollout risk is visible in a
                single pass.
              </p>
            </div>
          </div>

          <div className="panel-stack">
            <div className="chart-shell chart-shell-compact">
              <ResponsiveContainer width="100%" height={246}>
                <BarChart data={versions} layout="vertical" margin={{ top: 8, right: 8, left: 6, bottom: 4 }}>
                  <CartesianGrid stroke={chartPalette.grid} horizontal={false} />
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    width={92}
                    tick={{ fill: chartPalette.axis, fontSize: 11 }}
                  />
                  <Tooltip
                    cursor={false}
                    content={({ active, payload, label }) => (
                      <TelemetryChartTooltip
                        active={active}
                        label={label}
                        payload={
                          payload?.map((entry) => ({
                            name: String(entry.name ?? "Value"),
                            value: typeof entry.value === "number" ? entry.value : Number(entry.value ?? 0),
                            color: entry.color,
                          })) ?? []
                        }
                      />
                    )}
                  />
                  <Bar dataKey="value" name="Sessions" fill={chartPalette.sessionsLine} radius={[0, 8, 8, 0]} barSize={12} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="signal-list">
              {recentSignals.length > 0 ? (
                recentSignals.map((error) => (
                  <div key={error.id} className="signal-row">
                    <div className="signal-copy">
                      <p className="signal-title">{String(error.metrics["exception_type"] ?? error.service)}</p>
                      <p className="signal-meta">
                        {error.source} · {error.message ?? "No message provided"}
                      </p>
                    </div>
                    <div className="signal-side">
                      <strong className="signal-time">{timeAgo(error.timestamp)}</strong>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-panel small">No recent failures to highlight.</div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
