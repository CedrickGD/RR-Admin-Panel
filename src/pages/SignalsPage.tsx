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
  CURRENT_RAZORREAPER_VERSION,
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
  const countries = useMemo(() => buildCountryBreakdown(summary, 6, true), [summary]);
  const versions = useMemo(() => buildVersionBreakdown(summary), [summary]);
  const chartPalette = useMemo(() => buildDashboardChartPalette(theme), [theme]);
  const topRegion = regions[0];
  const topCountry = countries[0];
  const topVersion = versions[0];
  const recentSignals = summary.recentErrors.slice(0, 4);
  const sessionsWithErrors = summary.recentSessions.filter((session) => session.errorCount > 0).length;
  const trackedUsers = useMemo(
    () => versions.reduce((sum, version) => sum + version.value, 0),
    [versions],
  );
  const liveUsers = useMemo(
    () => versions.reduce((sum, version) => sum + version.activeUsers, 0),
    [versions],
  );
  const currentReleaseUsers = useMemo(
    () => versions.filter((version) => version.isCurrent).reduce((sum, version) => sum + version.value, 0),
    [versions],
  );
  const behindCurrentUsers = useMemo(
    () =>
      versions
        .filter(
          (version) =>
            version.source.trim().toLowerCase().includes("razorreaper") &&
            version.version !== "Unknown" &&
            !version.isCurrent,
        )
        .reduce((sum, version) => sum + version.value, 0),
    [versions],
  );
  const noisiestVersion = useMemo(
    () =>
      [...versions].sort(
        (left, right) =>
          right.totalErrors - left.totalErrors ||
          right.value - left.value ||
          left.label.localeCompare(right.label),
      )[0],
    [versions],
  );
  const visibleVersions = versions.slice(0, 6);
  const versionChartHeight = Math.max(248, visibleVersions.length * 52);
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
              <span>Most used</span>
              <strong>{topVersion?.version ?? "Unknown"}</strong>
            </div>
            <div className="page-meta">
              <span>Current RR</span>
              <strong>{CURRENT_RAZORREAPER_VERSION}</strong>
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
              <p className="panel-kicker">Releases</p>
              <h2 className="panel-title">Client version adoption</h2>
            </div>
          </div>

          <div className="panel-stack">
            <div className="panel-inline-metrics">
              <div>
                <span>On {CURRENT_RAZORREAPER_VERSION}</span>
                <strong>{formatNumber(currentReleaseUsers)}</strong>
              </div>
              <div>
                <span>Behind current</span>
                <strong>{formatNumber(behindCurrentUsers)}</strong>
              </div>
              <div>
                <span>Tracked installs</span>
                <strong>{formatNumber(trackedUsers)}</strong>
              </div>
              <div>
                <span>Live installs</span>
                <strong>{formatNumber(liveUsers)}</strong>
              </div>
            </div>

            <div className="signals-version-grid">
              <div className="chart-shell chart-shell-tall">
                {visibleVersions.length > 0 ? (
                  <ResponsiveContainer width="100%" height={versionChartHeight}>
                    <BarChart
                      data={visibleVersions}
                      layout="vertical"
                      margin={{ top: 8, right: 10, left: 8, bottom: 2 }}
                    >
                      <CartesianGrid stroke={chartPalette.grid} horizontal={false} />
                      <XAxis
                        type="number"
                        allowDecimals={false}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: chartPalette.axisSoft, fontSize: 11 }}
                      />
                      <YAxis
                        type="category"
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        width={124}
                        tick={{ fill: chartPalette.axis, fontSize: 11 }}
                      />
                      <Tooltip
                        cursor={false}
                        content={({ active, payload }) => {
                          const entry = payload?.[0]?.payload;

                          if (!entry) {
                            return null;
                          }

                          return (
                            <TelemetryChartTooltip
                              active={active}
                              label={`${entry.source} · ${entry.version}`}
                              payload={[
                                { name: "Users", value: entry.value, color: chartPalette.sessionsLine },
                                { name: "Share", value: `${(entry.share * 100).toFixed(1)}%`, color: chartPalette.sessionsLine },
                                { name: "Live", value: entry.activeUsers, color: chartPalette.activityBar },
                                { name: "Sessions", value: entry.sessionCount, color: chartPalette.axisSoft },
                                { name: "Errors", value: entry.totalErrors, color: chartPalette.errorsLine },
                              ]}
                            />
                          );
                        }}
                      />
                      <Bar
                        dataKey="value"
                        name="Users"
                        fill={chartPalette.sessionsLine}
                        radius={[0, 8, 8, 0]}
                        barSize={14}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="empty-panel small">No version data loaded yet.</div>
                )}
              </div>

              <div className="version-detail-list">
                {visibleVersions.map((version) => (
                  <article key={version.label} className="version-detail-row">
                    <div className="version-detail-head">
                      <div className="version-detail-head-main">
                        <p className="version-detail-title">{version.label}</p>
                        <p className="version-detail-subtitle">
                          {version.source}
                        </p>
                      </div>
                      <div className="version-detail-head-side">
                        {version.isCurrent ? (
                          <span className="version-detail-pill version-detail-pill-current">Current</span>
                        ) : version.source.trim().toLowerCase().includes("razorreaper") && version.version !== "Unknown" ? (
                          <span className="version-detail-pill version-detail-pill-outdated">Older</span>
                        ) : null}
                        <strong className="version-detail-share">{(version.share * 100).toFixed(1)}%</strong>
                      </div>
                    </div>

                    <div className="version-detail-metrics">
                      <div className="version-detail-metric">
                        <span>Users</span>
                        <strong>{formatNumber(version.value)}</strong>
                      </div>
                      <div className="version-detail-metric">
                        <span>Live</span>
                        <strong>{formatNumber(version.activeUsers)}</strong>
                      </div>
                      <div className="version-detail-metric">
                        <span>Sessions</span>
                        <strong>{formatNumber(version.sessionCount)}</strong>
                      </div>
                      <div className="version-detail-metric">
                        <span>Errors</span>
                        <strong>{formatNumber(version.totalErrors)}</strong>
                      </div>
                      <div className="version-detail-metric">
                        <span>Last seen</span>
                        <strong>{version.lastSeenAt ? timeAgo(version.lastSeenAt) : "Never"}</strong>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="panel panel-dense">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Failures</p>
              <h2 className="panel-title">Current failures</h2>
            </div>
          </div>

          <div className="panel-stack">
            <div className="info-list">
              <div className="info-row">
                <span>Error sessions</span>
                <strong className="info-value">{formatNumber(sessionsWithErrors)}</strong>
              </div>
              <div className="info-row">
                <span>Errors 24h</span>
                <strong className="info-value">{formatNumber(summary.stats.errorsLast24Hours)}</strong>
              </div>
              <div className="info-row">
                <span>Noisiest version</span>
                <strong className="info-value">
                  {noisiestVersion ? `${noisiestVersion.source} ${noisiestVersion.version}` : "Clear"}
                </strong>
              </div>
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

      <section className="panel panel-dense">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">Geography</p>
            <h2 className="panel-title">Region and country mix</h2>
          </div>
        </div>

        <div className="signals-geo-grid">
          <GeoDonutChart data={regionDonutData} totalLabel="Regional share" metricLabel="Sessions" />
          <GeoDonutChart data={countryDonutData} totalLabel="Top countries" metricLabel="Sessions" />
        </div>
      </section>
    </div>
  );
}
