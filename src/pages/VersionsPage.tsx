import { Download } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TelemetryChartTooltip } from "../components/charts/TelemetryChartTooltip";
import { useChartColors } from "../hooks/useChartColors";
import { useLatestVersion } from "../hooks/useLatestVersion";
import { useReleaseVersions } from "../hooks/useReleaseVersions";
import type { SummaryPayload, ThemeMode } from "../types/telemetry";
import { buildVersionBreakdown } from "../utils/dashboardInsights";
import { formatNumber } from "../utils/format";
import { applyChartColorOverride, buildDashboardChartPalette } from "./dashboardShared";

interface VersionsPageProps {
  summary: SummaryPayload;
  theme: ThemeMode;
  accentHue?: number;
}

type TimeSpan = "24h" | "7d" | "30d" | "all";

const HOUR_MS = 60 * 60 * 1000;
const TIME_SPANS: { key: TimeSpan; label: string; ms: number }[] = [
  { key: "24h", label: "24 h", ms: 24 * HOUR_MS },
  { key: "7d", label: "7 d", ms: 7 * 24 * HOUR_MS },
  { key: "30d", label: "30 d", ms: 30 * 24 * HOUR_MS },
  { key: "all", label: "All", ms: 0 },
];

export function VersionsPage({ summary, theme, accentHue = 217 }: VersionsPageProps) {
  const latestVersion = useLatestVersion();
  const knownVersions = useReleaseVersions();
  const [timeSpan, setTimeSpan] = useState<TimeSpan>("all");

  const filteredSummary = useMemo(() => {
    const spanDef = TIME_SPANS.find((s) => s.key === timeSpan);
    if (!spanDef || spanDef.ms === 0) return summary;

    const cutoff = Date.now() - spanDef.ms;
    const filterSession = (s: typeof summary.activeSessions[0]) => {
      const ts = Date.parse(s.lastSeenAt ?? s.startedAt);
      return Number.isFinite(ts) && ts >= cutoff;
    };

    return {
      ...summary,
      activeSessions: summary.activeSessions.filter(filterSession),
      recentSessions: summary.recentSessions.filter(filterSession),
      recentEvents: summary.recentEvents,
      recentErrors: summary.recentErrors,
    };
  }, [summary, timeSpan]);

  const allVersions = useMemo(() => buildVersionBreakdown(filteredSummary, latestVersion, knownVersions), [filteredSummary, latestVersion, knownVersions]);

  const rrVersions = useMemo(
    () => allVersions.filter((v) => v.source.trim().toLowerCase().includes("razorreaper")),
    [allVersions],
  );

  const basePalette = useMemo(() => buildDashboardChartPalette(theme, accentHue), [theme, accentHue]);
  const { override: colorOverride } = useChartColors();
  const chartPalette = useMemo(() => applyChartColorOverride(basePalette, colorOverride), [basePalette, colorOverride]);

  const trackedUsers = useMemo(() => rrVersions.reduce((s, v) => s + v.value, 0), [rrVersions]);
  const currentReleaseUsers = useMemo(() => rrVersions.filter((v) => v.isCurrent).reduce((s, v) => s + v.value, 0), [rrVersions]);
  const adoptionPct = trackedUsers > 0 ? Math.round((currentReleaseUsers / trackedUsers) * 100) : 0;
  const topVersion = rrVersions.length > 0 ? rrVersions[0] : null;

  const chartHeight = Math.max(180, rrVersions.length * 48);

  const downloadCsv = useCallback(() => {
    const header = "Version,Users,Share\n";
    const rows = rrVersions
      .map((v) => [v.version, v.value, `${(v.share * 100).toFixed(1)}%`].join(","))
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rr-client-adoption-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rrVersions]);

  return (
    <div className="page-content page-stack-lg">
      {/* Header */}
      <section className="page-header">
        <div>
          <h1 className="page-title">
            Versions
            <span className="kicker">Client Adoption</span>
          </h1>
          <p className="page-subtitle">
            Lifetime users per RazorReaper version. Auto-expands with new releases.
          </p>
        </div>
        <div className="page-header-right" style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
          <div className="seg-control">
            {TIME_SPANS.map((s) => (
              <button
                key={s.key}
                type="button"
                className={`seg-btn${timeSpan === s.key ? " active" : ""}`}
                onClick={() => setTimeSpan(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="meta-row">
            <div className="meta-item">
              <span>Latest RR</span>
              <strong>{latestVersion}</strong>
            </div>
          </div>
        </div>
      </section>

      {/* Stat cards */}
      <div className="stat-grid">
        {[
          { label: "Lifetime Users", value: formatNumber(trackedUsers), sub: "Unique by HWID" },
          { label: "Versions Tracked", value: String(rrVersions.length), sub: "From GitHub releases" },
          { label: "Adoption Rate", value: `${adoptionPct}%`, sub: `On ${latestVersion}` },
          { label: "Top Version", value: topVersion?.version ?? "\u2014", sub: topVersion ? `${formatNumber(topVersion.value)} users` : "No data" },
        ].map((s) => (
          <div className="stat-card" key={s.label}>
            <span className="stat-label">{s.label}</span>
            <strong className="stat-value" style={{ fontSize: "1.5rem" }}>{s.value}</strong>
            <p className="stat-sub">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Version chart */}
      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-left">
            <p className="kicker">Distribution</p>
            <h2 className="section-title">Users per Version</h2>
            <p className="section-sub">Lifetime unique users on each RazorReaper version.</p>
          </div>
          <div className="panel-head-right">
            <button type="button" className="btn-icon" title="Download CSV" onClick={downloadCsv} style={{ marginLeft: 8 }}>
              <Download className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="panel-body">
          {rrVersions.length > 0 ? (
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height={chartHeight}>
                <BarChart data={rrVersions} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid stroke={chartPalette.grid} horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: chartPalette.axis, fontSize: 10.5 }} />
                  <YAxis type="category" dataKey="version" width={80} tickLine={false} axisLine={false} tick={{ fill: chartPalette.axis, fontSize: 10.5 }} />
                  <Tooltip
                    cursor={false}
                    content={({ active, payload, label }) => (
                      <TelemetryChartTooltip
                        active={active}
                        label={label}
                        payload={payload?.map((e) => ({ name: String(e.name ?? ""), value: typeof e.value === "number" ? e.value : Number(e.value ?? 0), color: e.color })) ?? []}
                      />
                    )}
                  />
                  <Bar dataKey="value" name="Users" fill={chartPalette.activityBar} radius={[0, 5, 5, 0]} barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="empty-state"><p>No RazorReaper version data.</p></div>
          )}
        </div>
      </section>
    </div>
  );
}
