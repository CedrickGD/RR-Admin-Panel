import { Crown, Download, Layers, Rocket, Users } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TelemetryChartTooltip } from "../components/charts/TelemetryChartTooltip";
import { CollapsiblePanel } from "../components/CollapsiblePanel";
import { KpiStatCard, type KpiDrilldown } from "../components/KpiStatCard";
import { useChartColors } from "../hooks/useChartColors";
import { useLatestVersion } from "../hooks/useLatestVersion";
import { useReleaseVersions } from "../hooks/useReleaseVersions";
import type { StatsPayload, SummaryPayload, ThemeMode } from "../types/telemetry";
import { formatNumber } from "../utils/format";
import { applyChartColorOverride, buildDashboardChartPalette } from "./dashboardShared";

interface VersionsPageProps {
  summary: SummaryPayload;
  stats: StatsPayload | null;
  theme: ThemeMode;
  accentHue?: number;
  filterBar?: ReactNode;
}

type AdoptionView = "current" | "alltime";

interface VersionRow {
  /** Normalized merge key, e.g. "1.4.7" or "legacy". */
  key: string;
  /** Display label, e.g. "1.4.7" or "Legacy (pre-1.4)". */
  label: string;
  currentUsers: number;
  currentActiveUsers: number;
  allTimeUsers: number;
  sessions: number;
  firstSeen: string | null;
  lastSeen: string | null;
  isLatest: boolean;
}

interface ChartRow extends VersionRow {
  value: number;
  valueLabel: string;
}

const LEGACY_KEY = "legacy";
const LEGACY_LABEL = "Legacy (pre-1.4)";

/** Canonicalize any version string to a 3-part key ("1.4" -> "1.4.0"); "legacy" passes through. */
function normalizeVersionKey(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.toLowerCase() === LEGACY_KEY) return LEGACY_KEY;
  // Non-numeric buckets from the server ("unknown") must not be padded to "unknown.0.0".
  if (!/^\d/.test(trimmed)) return trimmed.toLowerCase();
  const parts = trimmed.split(".").filter((p) => p.length > 0);
  while (parts.length < 3) parts.push("0");
  return parts.slice(0, 3).join(".");
}

/** Semantic version descending; legacy always sorts last. */
function compareVersionRowsDesc(a: VersionRow, b: VersionRow): number {
  if (a.key === LEGACY_KEY) return b.key === LEGACY_KEY ? 0 : 1;
  if (b.key === LEGACY_KEY) return -1;
  const pa = a.key.split(".").map((p) => Number(p) || 0);
  const pb = b.key.split(".").map((p) => Number(p) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function minIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function formatDay(value: string | null): string {
  if (!value) return "—";
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return value;
  return new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function statusBadge(row: VersionRow) {
  if (row.isLatest) return <span className="badge badge-accent">Latest</span>;
  if (row.currentUsers > 0) return <span className="badge badge-success">Active</span>;
  if (row.allTimeUsers > 0) return <span className="badge badge-muted">Retired</span>;
  return <span className="badge badge-muted">No telemetry</span>;
}

export function VersionsPage({ summary, stats, theme, accentHue = 217, filterBar }: VersionsPageProps) {
  const latestVersion = useLatestVersion();
  const releaseVersions = useReleaseVersions();
  const [view, setView] = useState<AdoptionView>("current");

  const latestKey = useMemo(() => normalizeVersionKey(latestVersion), [latestVersion]);

  const basePalette = useMemo(() => buildDashboardChartPalette(theme, accentHue), [theme, accentHue]);
  const { override: colorOverride } = useChartColors();
  const chartPalette = useMemo(() => applyChartColorOverride(basePalette, colorOverride), [basePalette, colorOverride]);

  // Merge server telemetry (all-time + current adoption) with every GitHub release,
  // so versions with zero telemetry (e.g. brand-new or skipped builds) still appear.
  const versionRows = useMemo<VersionRow[]>(() => {
    if (!stats) return [];

    const map = new Map<string, VersionRow>();
    const ensure = (raw: string): VersionRow => {
      const key = normalizeVersionKey(raw);
      let row = map.get(key);
      if (!row) {
        row = {
          key,
          label: key === LEGACY_KEY ? LEGACY_LABEL : key,
          currentUsers: 0,
          currentActiveUsers: 0,
          allTimeUsers: 0,
          sessions: 0,
          firstSeen: null,
          lastSeen: null,
          isLatest: key === latestKey,
        };
        map.set(key, row);
      }
      return row;
    };

    for (const point of stats.breakdowns.versionsAllTime) {
      const row = ensure(point.version);
      row.allTimeUsers += point.users;
      row.sessions += point.sessions;
      row.firstSeen = minIso(row.firstSeen, point.firstSeen);
      row.lastSeen = maxIso(row.lastSeen, point.lastSeen);
    }

    for (const point of stats.breakdowns.versionsCurrent) {
      const row = ensure(point.version);
      row.currentUsers += point.users;
      row.currentActiveUsers += point.activeUsers;
    }

    for (const release of releaseVersions) {
      ensure(release);
    }

    return Array.from(map.values()).sort(compareVersionRowsDesc);
  }, [stats, releaseVersions, latestKey]);

  const chartRows = useMemo<ChartRow[]>(
    () =>
      versionRows.map((row) => {
        const value = view === "current" ? row.currentUsers : row.allTimeUsers;
        return { ...row, value, valueLabel: formatNumber(value) };
      }),
    [versionRows, view],
  );

  const lifetimeUsers = stats?.totals.lifetimeUsers ?? summary.stats.lifetimeUsers;
  const totalCurrentKnown = useMemo(() => versionRows.reduce((sum, row) => sum + row.currentUsers, 0), [versionRows]);
  const latestRow = useMemo(() => versionRows.find((row) => row.isLatest) ?? null, [versionRows]);
  const onLatestUsers = latestRow?.currentUsers ?? 0;
  const onLatestSharePct = totalCurrentKnown > 0 ? Math.round((onLatestUsers / totalCurrentKnown) * 100) : 0;
  const topVersion = useMemo(() => {
    let best: ChartRow | null = null;
    for (const row of chartRows) {
      if (row.value > 0 && (!best || row.value > best.value)) best = row;
    }
    return best;
  }, [chartRows]);

  const currentBreakdown = useMemo<KpiDrilldown["breakdown"]>(
    () =>
      versionRows
        .filter((row) => row.currentUsers > 0)
        .slice()
        .sort((a, b) => b.currentUsers - a.currentUsers)
        .map((row) => ({
          label: row.isLatest ? `${row.label} · latest` : row.label,
          value: formatNumber(row.currentUsers),
          share: totalCurrentKnown > 0 ? row.currentUsers / totalCurrentKnown : 0,
        })),
    [versionRows, totalCurrentKnown],
  );

  const lifetimeDrilldown = useMemo<KpiDrilldown | null>(() => {
    if (!stats) return null;
    return {
      timespans: [
        { label: "Lifetime", value: formatNumber(stats.totals.lifetimeUsers) },
        { label: "In range", value: formatNumber(stats.totals.usersInRange) },
        { label: "New in range", value: formatNumber(stats.totals.newUsersInRange) },
        { label: "Active now", value: formatNumber(stats.totals.activeNow) },
      ],
      breakdown: currentBreakdown,
      breakdownTitle: "By current version",
      note: "Each user is counted once under the version of their latest session.",
    };
  }, [stats, currentBreakdown]);

  const onLatestDrilldown = useMemo<KpiDrilldown | null>(() => {
    if (!stats || !currentBreakdown || currentBreakdown.length === 0) return null;
    return {
      breakdown: currentBreakdown,
      breakdownTitle: "Current version distribution",
      note: `Share is computed over the ${formatNumber(totalCurrentKnown)} users with a known current version.`,
    };
  }, [stats, currentBreakdown, totalCurrentKnown]);

  const trackedDrilldown = useMemo<KpiDrilldown | null>(() => {
    if (versionRows.length === 0) return null;
    const active = versionRows.filter((row) => !row.isLatest && row.currentUsers > 0).length;
    const retired = versionRows.filter((row) => !row.isLatest && row.currentUsers === 0 && row.allTimeUsers > 0).length;
    const silent = versionRows.filter((row) => !row.isLatest && row.currentUsers === 0 && row.allTimeUsers === 0).length;
    const total = versionRows.length;
    return {
      breakdown: [
        { label: "Latest release", value: "1", share: 1 / total },
        { label: "Active (current users)", value: String(active), share: active / total },
        { label: "Retired (all-time only)", value: String(retired), share: retired / total },
        { label: "No telemetry", value: String(silent), share: silent / total },
      ],
      breakdownTitle: "Release status",
      note: "Merged from server telemetry and GitHub releases — zero-user releases stay visible.",
    };
  }, [versionRows]);

  const topVersionDrilldown = useMemo<KpiDrilldown | null>(() => {
    if (!topVersion) return null;
    return {
      timespans: [
        { label: "Current users", value: formatNumber(topVersion.currentUsers) },
        { label: "All-time users", value: formatNumber(topVersion.allTimeUsers) },
        { label: "Sessions", value: formatNumber(topVersion.sessions) },
        { label: "Last seen", value: formatDay(topVersion.lastSeen) },
      ],
      note: view === "current" ? "Ranked by users currently on the version." : "Ranked by distinct users who ever ran the version.",
    };
  }, [topVersion, view]);

  const chartHeight = Math.max(200, chartRows.length * 44 + 24);
  const barTrackFill = theme === "dark" ? "rgba(255,255,255,0.04)" : "rgba(24,43,66,0.05)";

  const downloadCsv = useCallback(() => {
    const header = "version,currentUsers,allTimeUsers,sessions,firstSeen,lastSeen\n";
    const rows = versionRows
      .map((row) => [row.key, row.currentUsers, row.allTimeUsers, row.sessions, row.firstSeen ?? "", row.lastSeen ?? ""].join(","))
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rr-version-adoption-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [versionRows]);

  // ── Loading skeleton while server stats are in flight ──
  if (!stats) {
    return (
      <div className="page-content page-stack-lg">
        <section className="page-header">
          <div>
            <h1 className="page-title">
              Versions
              <span className="kicker">Client Adoption</span>
            </h1>
            <p className="page-subtitle">Loading full-history version adoption…</p>
          </div>
          {filterBar ? <div className="page-header-right">{filterBar}</div> : null}
        </section>

        <div className="stat-grid stat-grid-4">
          {[0, 1, 2, 3].map((i) => (
            <div className="stat-card" key={i}>
              <div className="skeleton" style={{ height: 12, width: "55%" }} />
              <div className="skeleton" style={{ height: 26, width: "40%", marginTop: 12 }} />
              <div className="skeleton" style={{ height: 10, width: "70%", marginTop: 10 }} />
            </div>
          ))}
        </div>

        <section className="panel">
          <div className="panel-head">
            <div className="panel-head-left">
              <p className="kicker">Distribution</p>
              <h2 className="section-title">Users per Version</h2>
              <p className="section-sub">Fetching server-side aggregates…</p>
            </div>
          </div>
          <div className="panel-body">
            <div className="skeleton" style={{ height: 300 }} />
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page-content page-stack-lg">
      {/* Header — title left; view toggle + global filters right */}
      <section className="page-header">
        <div>
          <h1 className="page-title">
            Versions
            <span className="kicker">Client Adoption</span>
          </h1>
          <p className="page-subtitle">Adoption per release — telemetry merged with GitHub releases.</p>
        </div>
        <div className="page-header-right">
          <div className="seg-control">
            <button
              type="button"
              className={`seg-btn${view === "current" ? " active" : ""}`}
              onClick={() => setView("current")}
              title="Users currently on each version (latest session per user)"
            >
              Current
            </button>
            <button
              type="button"
              className={`seg-btn${view === "alltime" ? " active" : ""}`}
              onClick={() => setView("alltime")}
              title="Distinct users who ever ran each version"
            >
              All-time
            </button>
          </div>
          {filterBar}
        </div>
      </section>

      {/* Stat cards */}
      <div className="stat-grid stat-grid-4">
        <KpiStatCard
          label="Lifetime Users"
          value={formatNumber(lifetimeUsers)}
          sub="All-time unique (HWID)"
          icon={<Users className="h-3.5 w-3.5" />}
          tone="primary"
          drilldown={lifetimeDrilldown}
          chartColor={chartPalette.sessionsLine}
        />
        <KpiStatCard
          label="On Latest"
          value={formatNumber(onLatestUsers)}
          sub={`${onLatestSharePct}% of known · v${latestVersion}`}
          icon={<Rocket className="h-3.5 w-3.5" />}
          tone="accent"
          drilldown={onLatestDrilldown}
          chartColor={chartPalette.sessionsLine}
        />
        <KpiStatCard
          label="Versions Tracked"
          value={String(versionRows.length)}
          sub="Incl. zero-user releases"
          icon={<Layers className="h-3.5 w-3.5" />}
          tone="primary"
          drilldown={trackedDrilldown}
          chartColor={chartPalette.sessionsLine}
        />
        <KpiStatCard
          label="Top Version"
          value={topVersion?.label ?? "—"}
          sub={topVersion ? `${formatNumber(topVersion.value)} ${view === "current" ? "current" : "all-time"} users` : "No data"}
          icon={<Crown className="h-3.5 w-3.5" />}
          tone="primary"
          drilldown={topVersionDrilldown}
          chartColor={chartPalette.sessionsLine}
        />
      </div>

      {/* Version chart */}
      <CollapsiblePanel
        kicker="Distribution"
        title="Users per Version"
        sub={view === "current"
          ? "Users whose latest session ran each version — adoption right now."
          : "Distinct users who ever ran each version — all-time."}
      >
        <div className="panel-body">
          {chartRows.length > 0 ? (
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height={chartHeight}>
                <BarChart data={chartRows} layout="vertical" margin={{ top: 4, right: 44, left: 8, bottom: 4 }}>
                  <defs>
                    <linearGradient id="verBarLatest" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor={chartPalette.sessionsLine} stopOpacity={0.5} />
                      <stop offset="100%" stopColor={chartPalette.sessionsLine} stopOpacity={0.95} />
                    </linearGradient>
                    <linearGradient id="verBarMuted" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor={chartPalette.sessionsLine} stopOpacity={0.12} />
                      <stop offset="100%" stopColor={chartPalette.sessionsLine} stopOpacity={0.34} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={chartPalette.grid} horizontal={false} />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: chartPalette.axis, fontSize: 10.5 }}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={108}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: chartPalette.axis, fontSize: 10.5 }}
                  />
                  <Tooltip
                    cursor={false}
                    content={({ active, payload }) => {
                      const row = payload?.[0]?.payload as ChartRow | undefined;
                      return (
                        <TelemetryChartTooltip
                          active={active}
                          label={row?.label}
                          payload={
                            row
                              ? [
                                  { name: "Current users", value: row.currentUsers, color: chartPalette.sessionsLine },
                                  { name: "All-time users", value: row.allTimeUsers, color: chartPalette.axisSoft },
                                  { name: "Sessions", value: row.sessions, color: chartPalette.axisSoft },
                                ]
                              : []
                          }
                        />
                      );
                    }}
                  />
                  <Bar
                    isAnimationActive={false}
                    dataKey="value"
                    name="Users"
                    radius={[0, 6, 6, 0]}
                    barSize={18}
                    background={{ fill: barTrackFill, radius: 6 }}
                  >
                    {chartRows.map((row) => (
                      <Cell key={row.key} fill={row.isLatest ? "url(#verBarLatest)" : "url(#verBarMuted)"} />
                    ))}
                    <LabelList dataKey="valueLabel" position="right" fill={chartPalette.axis} fontSize={10.5} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="empty-state">
              <p>No version data yet.</p>
            </div>
          )}
        </div>
      </CollapsiblePanel>

      {/* Release table */}
      <CollapsiblePanel
        kicker="Releases"
        title="Release History"
        sub="Every known release with current vs. all-time adoption."
        defaultOpen={false}
        right={
          <button type="button" className="btn-icon" title="Download CSV" onClick={downloadCsv}>
            <Download className="h-3.5 w-3.5" />
          </button>
        }
      >
        <div className="panel-body">
          {versionRows.length > 0 ? (
            <div className="data-table-wrap scroll-x">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Current users</th>
                    <th>All-time users</th>
                    <th>Sessions</th>
                    <th>First seen</th>
                    <th>Last seen</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {versionRows.map((row) => (
                    <tr key={row.key}>
                      <td className="mono">{row.label}</td>
                      <td>{formatNumber(row.currentUsers)}</td>
                      <td>{formatNumber(row.allTimeUsers)}</td>
                      <td className="muted">{formatNumber(row.sessions)}</td>
                      <td className="muted">{formatDay(row.firstSeen)}</td>
                      <td className="muted">{formatDay(row.lastSeen)}</td>
                      <td>{statusBadge(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <p>No releases found.</p>
            </div>
          )}
        </div>
      </CollapsiblePanel>
    </div>
  );
}
