import { Download } from "lucide-react";
import { useCallback, useMemo } from "react";
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
import { useChartColors } from "../hooks/useChartColors";
import { useDonutColors } from "../hooks/useDonutColors";
import { useLatestVersion } from "../hooks/useLatestVersion";
import type { SummaryPayload, ThemeMode } from "../types/telemetry";
import {
  buildCountryBreakdown,
  buildRegionBreakdown,
  buildVersionBreakdown,
} from "../utils/dashboardInsights";
import { formatNumber } from "../utils/format";
import { applyChartColorOverride, buildDashboardChartPalette } from "./dashboardShared";

interface SignalsPageProps {
  summary: SummaryPayload;
  theme: ThemeMode;
  accentHue?: number;
}

export function SignalsPage({ summary, theme, accentHue = 217 }: SignalsPageProps) {
  const latestVersion = useLatestVersion();
  const regions    = useMemo(() => buildRegionBreakdown(summary), [summary]);
  const countries  = useMemo(() => buildCountryBreakdown(summary, 6, true), [summary]);
  const versions   = useMemo(() => buildVersionBreakdown(summary, latestVersion), [summary, latestVersion]);
  const basePalette = useMemo(() => buildDashboardChartPalette(theme, accentHue), [theme, accentHue]);
  const { override: colorOverride } = useChartColors();
  const chartPalette = useMemo(() => applyChartColorOverride(basePalette, colorOverride), [basePalette, colorOverride]);
  const { colors: donutColors } = useDonutColors();

  const topRegion  = regions[0];
  const topCountry = countries[0];
  const noisiestVersion = useMemo(() => [...versions].sort((a, b) => b.totalErrors - a.totalErrors || b.value - a.value)[0], [versions]);

  const trackedUsers       = useMemo(() => versions.reduce((s, v) => s + v.value, 0), [versions]);
  const liveUsers          = useMemo(() => versions.reduce((s, v) => s + v.activeUsers, 0), [versions]);
  const currentReleaseUsers = useMemo(() => versions.filter((v) => v.isCurrent).reduce((s, v) => s + v.value, 0), [versions]);
  const behindCurrentUsers  = useMemo(() => versions.filter((v) => v.source.trim().toLowerCase().includes("razorreaper") && v.version !== "Unknown" && !v.isCurrent).reduce((s, v) => s + v.value, 0), [versions]);

  const visibleVersions    = versions.slice(0, 7);
  const versionChartHeight = Math.max(220, visibleVersions.length * 48);

  const regionDonutData  = useMemo(() => regions.map((r, i)  => ({ label: r.label, value: r.value, share: r.share, color: donutColors[i % donutColors.length], note: `${formatNumber(r.value)} sessions` })), [regions, donutColors]);
  const countryDonutData = useMemo(() => countries.map((c, i) => ({ label: c.label, value: c.value, share: c.share, color: donutColors[i % donutColors.length], note: c.region, flag: c.flag })), [countries, donutColors]);

  const downloadVersionCsv = useCallback(() => {
    const header = "Source,Version,Users,Active Now,Sessions,Errors,Share,Is Current\n";
    const rows = versions.map((v) =>
      [v.source, v.version, v.value, v.activeUsers, v.sessionCount, v.totalErrors, `${(v.share * 100).toFixed(1)}%`, v.isCurrent].join(","),
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `version-distribution-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [versions]);

  return (
    <div className="page-content page-stack-lg">
      {/* Header */}
      <section className="page-header">
        <div>
          <p className="kicker">Intelligence</p>
          <h1 className="page-title" style={{ marginTop: 6 }}>Signals</h1>
          <p className="page-subtitle">
            Geographic mix, version concentration, and failure pressure.
          </p>
        </div>
        <div className="page-header-right">
          <div className="meta-row">
            {[
              { label: "Top Region",  val: topRegion?.label ?? "Unknown" },
              { label: "Top Country", val: topCountry?.label ?? "Unknown" },
              { label: "Latest RR",   val: latestVersion },
            ].map((m) => (
              <div className="meta-item" key={m.label}><span>{m.label}</span><strong>{m.val}</strong></div>
            ))}
          </div>
        </div>
      </section>

      {/* Version adoption + Noise side by side */}
      <div className="two-col">
        <section className="panel">
          <div className="panel-head">
            <div className="panel-head-left">
              <p className="kicker">Releases</p>
              <h2 className="section-title">Client Version Adoption</h2>
              <p className="section-sub">Session distribution by version.</p>
            </div>
            <div className="panel-head-right">
              <div className="meta-row">
                {[
                  { label: `On ${latestVersion}`, val: formatNumber(currentReleaseUsers) },
                  { label: "Behind",   val: formatNumber(behindCurrentUsers) },
                  { label: "Tracked",  val: formatNumber(trackedUsers) },
                  { label: "Live now", val: formatNumber(liveUsers) },
                ].map((m) => (
                  <div className="meta-item" key={m.label}><span>{m.label}</span><strong>{m.val}</strong></div>
                ))}
              </div>
              <button type="button" className="btn-icon" title="Download version distribution CSV" onClick={downloadVersionCsv} style={{ marginLeft: 8 }}>
                <Download className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="panel-body">
            {visibleVersions.length > 0 ? (
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={versionChartHeight}>
                  <BarChart data={visibleVersions} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                    <CartesianGrid stroke={chartPalette.grid} horizontal={false} />
                    <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: chartPalette.axis, fontSize: 10.5 }} />
                    <YAxis type="category" dataKey="label" width={140} tickLine={false} axisLine={false} tick={{ fill: chartPalette.axis, fontSize: 10.5 }} />
                    <Tooltip cursor={false} content={({ active, payload, label }) => (
                      <TelemetryChartTooltip active={active} label={label} payload={payload?.map((e) => ({ name: String(e.name ?? ""), value: typeof e.value === "number" ? e.value : Number(e.value ?? 0), color: e.color })) ?? []} />
                    )} />
                    <Bar dataKey="value" name="Sessions" fill={chartPalette.activityBar} radius={[0,5,5,0]} barSize={18} />
                    <Bar dataKey="activeUsers" name="Active now" fill={chartPalette.sessionsLine} radius={[0,5,5,0]} barSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="empty-state"><p>No version data available.</p></div>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div className="panel-head-left">
              <p className="kicker">Noise</p>
              <h2 className="section-title">Version Error Pressure</h2>
              <p className="section-sub">Which version contributes the most errors.</p>
            </div>
            {noisiestVersion ? <span className="badge badge-warning">{noisiestVersion.version}</span> : null}
          </div>
          <div className="panel-body-tight">
            <div className="progress-wrap">
              {versions.slice(0, 8).map((v) => {
                const maxErr = versions[0]?.totalErrors ?? 1;
                const pct = maxErr > 0 ? Math.round((v.totalErrors / maxErr) * 100) : 0;
                return (
                  <div className="progress-row" key={v.label}>
                    <div className="progress-head">
                      <span className="progress-label" style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.label}</span>
                      <span className="progress-val">{formatNumber(v.totalErrors)} err</span>
                    </div>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${pct}%`, background: v.totalErrors > 0 ? "var(--danger)" : "var(--accent)" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>

      {/* Geo distribution */}
      <div className="two-col">
        <section className="panel">
          <div className="panel-head">
            <div className="panel-head-left">
              <p className="kicker">Geography</p>
              <h2 className="section-title">Region Breakdown</h2>
            </div>
            {topRegion ? <span className="badge badge-accent">{topRegion.label}</span> : null}
          </div>
          <div className="panel-body">
            {regionDonutData.length > 0 ? (
              <GeoDonutChart data={regionDonutData} totalLabel="sessions" metricLabel="Region" />
            ) : (
              <div className="empty-state"><p>No region data.</p></div>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div className="panel-head-left">
              <p className="kicker">Countries</p>
              <h2 className="section-title">Top Countries</h2>
            </div>
            {topCountry ? <span className="badge badge-accent">{topCountry.label}</span> : null}
          </div>
          <div className="panel-body">
            {countryDonutData.length > 0 ? (
              <GeoDonutChart data={countryDonutData} totalLabel="sessions" metricLabel="Country" />
            ) : (
              <div className="empty-state"><p>No country data.</p></div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
