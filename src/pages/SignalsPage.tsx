import { ChevronDown, ChevronRight, Download } from "lucide-react";
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

interface SignalsPageProps {
  summary: SummaryPayload;
  theme: ThemeMode;
  accentHue?: number;
}

type TimeSpan = "24h" | "7d" | "30d" | "all";

const HOUR_MS = 60 * 60 * 1000;
const TIME_SPANS: { key: TimeSpan; label: string; ms: number }[] = [
  { key: "24h", label: "24h", ms: 24 * HOUR_MS },
  { key: "7d", label: "7d", ms: 7 * 24 * HOUR_MS },
  { key: "30d", label: "30d", ms: 30 * 24 * HOUR_MS },
  { key: "all", label: "All", ms: 0 },
];

export function SignalsPage({ summary, theme, accentHue = 217 }: SignalsPageProps) {
  const latestVersion = useLatestVersion();
  const knownVersions = useReleaseVersions();
  const [timeSpan, setTimeSpan] = useState<TimeSpan>("all");
  const [versionListExpanded, setVersionListExpanded] = useState(true);
  const [errorListExpanded, setErrorListExpanded] = useState(true);

  // Time-filtered summary
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
      recentEvents: summary.recentEvents.filter((e) => {
        const ts = Date.parse(e.timestamp);
        return Number.isFinite(ts) && ts >= cutoff;
      }),
      recentErrors: summary.recentErrors.filter((e) => {
        const ts = Date.parse(e.timestamp);
        return Number.isFinite(ts) && ts >= cutoff;
      }),
    };
  }, [summary, timeSpan]);

  const allVersions = useMemo(() => buildVersionBreakdown(filteredSummary, latestVersion, knownVersions), [filteredSummary, latestVersion, knownVersions]);

  // RazorReaper-only versions
  const rrVersions = useMemo(
    () => allVersions.filter((v) => v.source.trim().toLowerCase().includes("razorreaper")),
    [allVersions],
  );

  const basePalette = useMemo(() => buildDashboardChartPalette(theme, accentHue), [theme, accentHue]);
  const { override: colorOverride } = useChartColors();
  const chartPalette = useMemo(() => applyChartColorOverride(basePalette, colorOverride), [basePalette, colorOverride]);

  const trackedUsers = useMemo(() => rrVersions.reduce((s, v) => s + v.value, 0), [rrVersions]);
  const liveUsers = useMemo(() => rrVersions.reduce((s, v) => s + v.activeUsers, 0), [rrVersions]);
  const currentReleaseUsers = useMemo(() => rrVersions.filter((v) => v.isCurrent).reduce((s, v) => s + v.value, 0), [rrVersions]);
  const behindCurrentUsers = useMemo(() => rrVersions.filter((v) => v.version !== "Unknown" && !v.isCurrent).reduce((s, v) => s + v.value, 0), [rrVersions]);

  const visibleVersions = versionListExpanded ? rrVersions : rrVersions.slice(0, 3);
  const versionChartHeight = Math.max(180, visibleVersions.length * 48);

  // Error pressure — RR only, sorted by errors desc
  const rrErrorVersions = useMemo(
    () => [...rrVersions].sort((a, b) => b.totalErrors - a.totalErrors),
    [rrVersions],
  );
  const visibleErrorVersions = errorListExpanded ? rrErrorVersions : rrErrorVersions.slice(0, 3);
  const noisiestVersion = rrErrorVersions[0];

  const downloadVersionCsv = useCallback(() => {
    const header = "Version,Users,Active Now,Sessions,Errors,Share,Is Current\n";
    const rows = rrVersions
      .map((v) =>
        [v.version, v.value, v.activeUsers, v.sessionCount, v.totalErrors, `${(v.share * 100).toFixed(1)}%`, v.isCurrent].join(","),
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rr-version-distribution-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rrVersions]);

  return (
    <div className="page-content page-stack-lg">
      {/* Header */}
      <section className="page-header">
        <div>
          <p className="kicker">Intelligence</p>
          <h1 className="page-title" style={{ marginTop: 6 }}>Signals</h1>
          <p className="page-subtitle">
            RazorReaper version adoption and error pressure.
          </p>
        </div>
        <div className="page-header-right" style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
          {/* Timespan filter */}
          <div style={{ display: "flex", gap: 4, background: "var(--surface-2)", borderRadius: 6, padding: 2 }}>
            {TIME_SPANS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setTimeSpan(s.key)}
                style={{
                  padding: "4px 10px",
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: 4,
                  border: "none",
                  cursor: "pointer",
                  background: timeSpan === s.key ? "var(--accent)" : "transparent",
                  color: timeSpan === s.key ? "#fff" : "var(--text-2)",
                  transition: "all .15s ease",
                }}
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

      {/* Version adoption + Error pressure */}
      <div className="two-col">
        <section className="panel">
          <div className="panel-head">
            <div className="panel-head-left">
              <button
                type="button"
                onClick={() => setVersionListExpanded((p) => !p)}
                style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", padding: 0, color: "inherit" }}
              >
                {versionListExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <p className="kicker" style={{ margin: 0 }}>RazorReaper Versions</p>
              </button>
              <h2 className="section-title">Client Adoption</h2>
              <p className="section-sub">Users per RazorReaper version.</p>
            </div>
            <div className="panel-head-right">
              <div className="meta-row">
                {[
                  { label: `On ${latestVersion}`, val: formatNumber(currentReleaseUsers) },
                  { label: "Behind", val: formatNumber(behindCurrentUsers) },
                  { label: "Tracked", val: formatNumber(trackedUsers) },
                  { label: "Live now", val: formatNumber(liveUsers) },
                ].map((m) => (
                  <div className="meta-item" key={m.label}>
                    <span>{m.label}</span>
                    <strong>{m.val}</strong>
                  </div>
                ))}
              </div>
              <button type="button" className="btn-icon" title="Download CSV" onClick={downloadVersionCsv} style={{ marginLeft: 8 }}>
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
                    <Bar dataKey="activeUsers" name="Active now" fill={chartPalette.sessionsLine} radius={[0, 5, 5, 0]} barSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="empty-state"><p>No RazorReaper version data.</p></div>
            )}
            {rrVersions.length > 3 && (
              <button
                type="button"
                onClick={() => setVersionListExpanded((p) => !p)}
                style={{
                  display: "block", width: "100%", padding: "6px 0", marginTop: 4,
                  background: "none", border: "none", cursor: "pointer",
                  color: "var(--text-3)", fontSize: 11, fontWeight: 500, textAlign: "center",
                }}
              >
                {versionListExpanded ? `Collapse (${rrVersions.length} versions)` : `Show all ${rrVersions.length} versions`}
              </button>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div className="panel-head-left">
              <button
                type="button"
                onClick={() => setErrorListExpanded((p) => !p)}
                style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", padding: 0, color: "inherit" }}
              >
                {errorListExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <p className="kicker" style={{ margin: 0 }}>Error Pressure</p>
              </button>
              <h2 className="section-title">Errors by Version</h2>
              <p className="section-sub">Which RazorReaper version is noisiest.</p>
            </div>
            {noisiestVersion && noisiestVersion.totalErrors > 0 ? (
              <span className="badge badge-warning">{noisiestVersion.version}</span>
            ) : null}
          </div>
          <div className="panel-body-tight">
            <div className="progress-wrap">
              {visibleErrorVersions.map((v) => {
                const maxErr = Math.max(1, rrErrorVersions[0]?.totalErrors ?? 1);
                const pct = maxErr > 0 ? Math.round((v.totalErrors / maxErr) * 100) : 0;
                return (
                  <div className="progress-row" key={v.version}>
                    <div className="progress-head">
                      <span className="progress-label">{v.version}</span>
                      <span className="progress-val">{formatNumber(v.totalErrors)} err</span>
                    </div>
                    <div className="progress-track">
                      <div
                        className="progress-fill"
                        style={{
                          width: `${pct}%`,
                          background: v.totalErrors > 0 ? "var(--danger)" : "var(--accent)",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
              {rrErrorVersions.length === 0 && (
                <div className="empty-state"><p>No error data.</p></div>
              )}
            </div>
            {rrErrorVersions.length > 3 && (
              <button
                type="button"
                onClick={() => setErrorListExpanded((p) => !p)}
                style={{
                  display: "block", width: "100%", padding: "6px 0", marginTop: 4,
                  background: "none", border: "none", cursor: "pointer",
                  color: "var(--text-3)", fontSize: 11, fontWeight: 500, textAlign: "center",
                }}
              >
                {errorListExpanded ? "Collapse" : `Show all ${rrErrorVersions.length} versions`}
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
