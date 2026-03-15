import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TelemetryChartTooltip } from "../components/charts/TelemetryChartTooltip";
import { TimezoneUsageChart } from "../components/charts/TimezoneUsageChart";
import type { SummaryPayload, ThemeMode } from "../types/telemetry";
import {
  buildDailyUserTimeline,
  buildTrafficTimeline,
  buildTimezoneActivity,
} from "../utils/dashboardInsights";
import { formatDuration, formatNumber, timeAgo } from "../utils/format";
import { buildDashboardChartPalette, TIMEZONE_PANELS } from "./dashboardShared";

interface TrafficPageProps {
  summary: SummaryPayload;
  theme: ThemeMode;
}

const TIME_RANGE_OPTIONS = [
  { value: 7, label: "7D" },
  { value: 14, label: "14D" },
  { value: 30, label: "30D" },
  { value: 90, label: "90D" },
] as const;

export function TrafficPage({ summary, theme }: TrafficPageProps) {
  const [insightView, setInsightView] = useState<"daily" | "timezones">("daily");
  const [rangeDays, setRangeDays] = useState<number>(30);
  const traffic = useMemo(() => buildTrafficTimeline(summary, 24, "UTC"), [summary]);
  const dailyUsers = useMemo(() => buildDailyUserTimeline(summary, rangeDays), [summary, rangeDays]);
  const timezoneCharts = useMemo(
    () =>
      TIMEZONE_PANELS.map((panel) => ({
        ...panel,
        data: buildTimezoneActivity(summary, panel.timeZone),
      })),
    [summary],
  );
  const chartPalette = useMemo(() => buildDashboardChartPalette(theme), [theme]);
  const totals = useMemo(
    () =>
      traffic.reduce(
        (accumulator, point) => {
          accumulator.activity += point.activity;
          accumulator.started += point.started;
          accumulator.errors += point.errors;
          return accumulator;
        },
        { activity: 0, started: 0, errors: 0 },
      ),
    [traffic],
  );
  const peakUsers = useMemo(
    () => Math.max(0, ...dailyUsers.map((point) => point.users)),
    [dailyUsers],
  );
  const latestUsers = dailyUsers[dailyUsers.length - 1]?.users ?? 0;

  return (
    <div className="page-content page-content-wide page-stack">
      <section className="page-header">
        <div>
          <p className="page-kicker">Traffic Analysis</p>
          <h1 className="page-title">Traffic</h1>
          <p className="page-subtitle">
            Hourly demand, session starts, error pressure, and timezone views isolated onto their own page so the
            traffic read no longer competes with geography or release analysis.
          </p>
        </div>

        <div className="page-header-side">
          <div className="page-meta-stack page-meta-stack-live">
            <div className="page-meta">
              <span>Total events</span>
              <strong>{formatNumber(summary.stats.totalEvents)}</strong>
            </div>
            <div className="page-meta">
              <span>Started today</span>
              <strong>{formatNumber(summary.stats.sessionsStartedToday)}</strong>
            </div>
            <div className="page-meta">
              <span>Average session</span>
              <strong>{formatDuration(summary.stats.averageSessionDurationSeconds)}</strong>
            </div>
            <div className="page-meta">
              <span>Last ingest</span>
              <strong>{summary.stats.lastIngestAt ? timeAgo(summary.stats.lastIngestAt) : "Waiting"}</strong>
            </div>
          </div>
        </div>
      </section>

      <div className="traffic-layout">
        <section className="panel panel-dense">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Timeline</p>
              <h2 className="panel-title">Last 24 hours in UTC</h2>
              <p className="panel-subtitle">
                Every operator sees the same hour boundaries. This page is the detailed traffic read, separate from the
                summary surface.
              </p>
            </div>
            <div className="panel-inline-metrics">
              <div>
                <span>Events</span>
                <strong>{formatNumber(totals.activity)}</strong>
              </div>
              <div>
                <span>New sessions</span>
                <strong>{formatNumber(totals.started)}</strong>
              </div>
              <div>
                <span>Errors</span>
                <strong>{formatNumber(totals.errors)}</strong>
              </div>
            </div>
          </div>

          <div className="chart-shell chart-shell-tall">
            <ResponsiveContainer width="100%" height={380}>
              <ComposedChart data={traffic} margin={{ top: 16, right: 8, left: -10, bottom: 4 }}>
                <CartesianGrid stroke={chartPalette.grid} vertical={false} />
                <XAxis
                  dataKey="shortLabel"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={18}
                  tick={{ fill: chartPalette.axis, fontSize: 11 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={34}
                  tick={{ fill: chartPalette.axisSoft, fontSize: 11 }}
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
                <Bar dataKey="activity" name="Events" fill={chartPalette.activityBar} radius={[8, 8, 0, 0]} barSize={14} />
                <Area
                  type="monotone"
                  dataKey="started"
                  name="New sessions"
                  stroke={chartPalette.sessionsLine}
                  strokeWidth={2.4}
                  fill="rgba(255,255,255,0)"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0, fill: chartPalette.sessionsLine }}
                />
                <Area
                  type="monotone"
                  dataKey="errors"
                  name="Errors"
                  stroke={chartPalette.errorsLine}
                  strokeWidth={2}
                  fill="rgba(255,255,255,0)"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0, fill: chartPalette.errorsLine }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>

        <div className="panel-stack">
          <section className="panel panel-dense">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">User history</p>
                <h2 className="panel-title">
                  {insightView === "daily" ? "Unique users per day" : "Fixed operating zones"}
                </h2>
                <p className="panel-subtitle">
                  {insightView === "daily"
                    ? "UTC day buckets built from loaded session history. Hover the curve to inspect the exact user count for that day."
                    : "The same data rendered against the clocks most relevant during support and handoff coverage."}
                </p>
              </div>

              <div className="control-strip">
                <button
                  type="button"
                  className={`control-strip-button ${insightView === "daily" ? "control-strip-button-active" : ""}`}
                  onClick={() => setInsightView("daily")}
                >
                  Daily users
                </button>
                <button
                  type="button"
                  className={`control-strip-button ${insightView === "timezones" ? "control-strip-button-active" : ""}`}
                  onClick={() => setInsightView("timezones")}
                >
                  Timezones
                </button>
              </div>
            </div>

            {insightView === "daily" ? (
              <div className="panel-stack">
                <div className="panel-inline-metrics">
                  <div>
                    <span>Latest day</span>
                    <strong>{formatNumber(latestUsers)}</strong>
                  </div>
                  <div>
                    <span>Peak day</span>
                    <strong>{formatNumber(peakUsers)}</strong>
                  </div>
                  <div>
                    <span>Range</span>
                    <strong>{rangeDays} days</strong>
                  </div>
                </div>

                <div className="control-strip control-strip-compact">
                  {TIME_RANGE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`control-strip-button ${rangeDays === option.value ? "control-strip-button-active" : ""}`}
                      onClick={() => setRangeDays(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <div className="chart-shell chart-shell-compact">
                  <ResponsiveContainer width="100%" height={248}>
                    <AreaChart data={dailyUsers} margin={{ top: 12, right: 8, left: -14, bottom: 0 }}>
                      <CartesianGrid stroke={chartPalette.grid} vertical={false} />
                      <XAxis
                        dataKey="shortLabel"
                        tickLine={false}
                        axisLine={false}
                        minTickGap={rangeDays >= 30 ? 24 : 14}
                        tick={{ fill: chartPalette.axis, fontSize: 11 }}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        width={30}
                        tick={{ fill: chartPalette.axisSoft, fontSize: 11 }}
                      />
                      <Tooltip
                        cursor={false}
                        content={({ active, payload }) => (
                          <TelemetryChartTooltip
                            active={active}
                            label={typeof payload?.[0]?.payload?.label === "string" ? payload[0].payload.label : undefined}
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
                      <Area
                        type="monotone"
                        dataKey="users"
                        name="Unique users"
                        stroke={chartPalette.sessionsLine}
                        strokeWidth={2.4}
                        fill={chartPalette.activityBar}
                        activeDot={{ r: 4, fill: chartPalette.sessionsLine, strokeWidth: 0 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : (
              <div className="traffic-timezone-grid">
                {timezoneCharts.map((panel) => (
                  <TimezoneUsageChart
                    key={panel.timeZone}
                    title={panel.title}
                    subtitle={panel.subtitle}
                    data={panel.data}
                    accentColor={panel.accent}
                    theme={theme}
                    chartHeight={138}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
