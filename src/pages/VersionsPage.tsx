import { Select } from "../components/ds/Select";
import { CircleCheck, Crown, Download, History, Layers, Package } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { CollapsiblePanel } from "../components/CollapsiblePanel";
import { KpiStatCard, type KpiDrilldown } from "../components/KpiStatCard";
import { Badge } from "../components/ds/Badge";
import { IconButton } from "../components/ds/Button";
import { DataTable, type DataTableColumn } from "../components/ds/DataTable";
import { EmptyState } from "../components/ds/EmptyState";
import { KvList } from "../components/ds/KvList";
import { PageHeader } from "../components/ds/PageHeader";
import { RadialGauge } from "../components/ds/RadialGauge";
import { RankList } from "../components/ds/RankList";
import { Tag } from "../components/ds/Tag";
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
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function statusBadge(row: VersionRow) {
  if (row.isLatest) return <Badge tone="accent">Latest</Badge>;
  if (row.currentUsers > 0) return <Badge tone="success">Active</Badge>;
  if (row.allTimeUsers > 0) return <Badge tone="muted">Retired</Badge>;
  return <Badge tone="muted">No telemetry</Badge>;
}

const RELEASE_COLUMNS: Array<DataTableColumn<VersionRow>> = [
  {
    key: "version",
    header: "Version",
    render: (row) => <Tag accent={row.isLatest}>{row.label}</Tag>,
  },
  { key: "currentUsers", header: "Current Users", render: (row) => formatNumber(row.currentUsers) },
  {
    key: "allTimeUsers",
    header: "All-Time Users",
    render: (row) => formatNumber(row.allTimeUsers),
  },
  { key: "sessions", header: "Sessions", muted: true, render: (row) => formatNumber(row.sessions) },
  {
    key: "firstSeen",
    header: "First Seen",
    muted: true,
    render: (row) => formatDay(row.firstSeen),
  },
  { key: "lastSeen", header: "Last Seen", muted: true, render: (row) => formatDay(row.lastSeen) },
  { key: "status", header: "Status", render: (row) => statusBadge(row) },
];

export function VersionsPage({ stats, theme, accentHue = 217, filterBar }: VersionsPageProps) {
  const latestVersion = useLatestVersion();
  const releaseVersions = useReleaseVersions();
  const [view, setView] = useState<AdoptionView>("current");

  const latestKey = useMemo(() => normalizeVersionKey(latestVersion), [latestVersion]);

  const basePalette = useMemo(
    () => buildDashboardChartPalette(theme, accentHue),
    [theme, accentHue],
  );
  const { override: colorOverride } = useChartColors();
  const chartPalette = useMemo(
    () => applyChartColorOverride(basePalette, colorOverride),
    [basePalette, colorOverride],
  );

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

  const totalCurrentKnown = useMemo(
    () => versionRows.reduce((sum, row) => sum + row.currentUsers, 0),
    [versionRows],
  );
  const latestRow = useMemo(() => versionRows.find((row) => row.isLatest) ?? null, [versionRows]);
  const onLatestUsers = latestRow?.currentUsers ?? 0;
  const onLatestSharePct =
    totalCurrentKnown > 0 ? Math.round((onLatestUsers / totalCurrentKnown) * 100) : 0;
  // Version-specific: known current users whose latest session is NOT on the latest release.
  const outdatedUsers = Math.max(0, totalCurrentKnown - onLatestUsers);
  const outdatedSharePct =
    totalCurrentKnown > 0 ? Math.round((outdatedUsers / totalCurrentKnown) * 100) : 0;
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

  const outdatedDrilldown = useMemo<KpiDrilldown | null>(() => {
    const rows = versionRows
      .filter((row) => !row.isLatest && row.currentUsers > 0)
      .sort((a, b) => b.currentUsers - a.currentUsers);
    if (rows.length === 0) return null;
    return {
      breakdown: rows.map((row) => ({
        label: row.label,
        value: formatNumber(row.currentUsers),
        share: outdatedUsers > 0 ? row.currentUsers / outdatedUsers : 0,
      })),
      breakdownTitle: "Outdated users by version",
      note: `Known current users whose latest session is not on v${latestVersion}.`,
    };
  }, [versionRows, outdatedUsers, latestVersion]);

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
    const retired = versionRows.filter(
      (row) => !row.isLatest && row.currentUsers === 0 && row.allTimeUsers > 0,
    ).length;
    const silent = versionRows.filter(
      (row) => !row.isLatest && row.currentUsers === 0 && row.allTimeUsers === 0,
    ).length;
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
      note:
        view === "current"
          ? "Ranked by users currently on the version."
          : "Ranked by distinct users who ever ran the version.",
    };
  }, [topVersion, view]);

  // Rank bars: share is normalized against the largest bucket in the active view.
  const maxChartValue = useMemo(
    () => chartRows.reduce((max, row) => Math.max(max, row.value), 0),
    [chartRows],
  );
  const rankItems = useMemo(
    () =>
      chartRows.map((row) => ({
        label: row.label,
        value: row.valueLabel,
        share: maxChartValue > 0 ? row.value / maxChartValue : 0,
      })),
    [chartRows, maxChartValue],
  );

  const downloadCsv = useCallback(() => {
    const header = "version,currentUsers,allTimeUsers,sessions,firstSeen,lastSeen\n";
    const rows = versionRows
      .map((row) =>
        [
          row.key,
          row.currentUsers,
          row.allTimeUsers,
          row.sessions,
          row.firstSeen ?? "",
          row.lastSeen ?? "",
        ].join(","),
      )
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
        <PageHeader kicker="Distribution" title="Versions" right={filterBar} />

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
              <h2 className="section-title">Users by Version</h2>
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
      {/* Header — mandate kicker left; latest badge + view toggle + global filters right */}
      <PageHeader
        kicker="Distribution"
        title="Versions"
        right={
          <>
            <Select
              aria-label="Time window"
              value={view}
              onValueChange={(value) => setView(value as "current" | "alltime")}
            >
              <option value="current">Current</option>
              <option value="alltime">All time</option>
            </Select>
            {filterBar}
          </>
        }
      />

      {/* Adoption KPIs — version-specific only (lifetime totals live on Overview) */}
      <div className="stat-grid stat-grid-4">
        <KpiStatCard
          label="On Latest"
          value={formatNumber(onLatestUsers)}
          sub={`${onLatestSharePct}% of known · v${latestVersion}`}
          icon={<CircleCheck size={14} />}
          tone="success"
          drilldown={onLatestDrilldown}
          chartColor={chartPalette.sessionsLine}
        />
        <KpiStatCard
          label="Outdated"
          value={formatNumber(outdatedUsers)}
          sub={`${outdatedSharePct}% of known · not on v${latestVersion}`}
          icon={<History size={14} />}
          tone={outdatedUsers > 0 ? "warning" : "primary"}
          drilldown={outdatedDrilldown}
          chartColor={chartPalette.sessionsLine}
        />
        <KpiStatCard
          label="Versions Tracked"
          value={String(versionRows.length)}
          sub="Incl. zero-user releases"
          icon={<Layers size={14} />}
          tone="primary"
          drilldown={trackedDrilldown}
          chartColor={chartPalette.sessionsLine}
        />
        <KpiStatCard
          label="Top Version"
          value={topVersion?.label ?? "—"}
          sub={
            topVersion
              ? `${formatNumber(topVersion.value)} ${view === "current" ? "current" : "all-time"} users`
              : "No data"
          }
          icon={<Crown size={14} />}
          tone="primary"
          drilldown={topVersionDrilldown}
          chartColor={chartPalette.sessionsLine}
        />
      </div>

      {/* Adoption funnel: rank bars left, coverage gauges + latest release right */}
      <div className="main-side">
        <CollapsiblePanel
          kicker="Distribution"
          title="Users by Version"
          sub={
            view === "current"
              ? "Users whose latest session ran each version — adoption right now."
              : "Distinct users who ever ran each version — all-time."
          }
          padding="body"
        >
          {rankItems.length > 0 ? (
            <RankList items={rankItems} />
          ) : (
            <EmptyState icon={<Layers />} title="No version data">
              Adoption populates here with the first session ingest.
            </EmptyState>
          )}
        </CollapsiblePanel>

        <div className="side-stack">
          <CollapsiblePanel kicker="Health" title="Coverage" padding="body">
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <RadialGauge
                ratio={totalCurrentKnown > 0 ? onLatestUsers / totalCurrentKnown : 0}
                title="On Latest"
                sub={`${formatNumber(onLatestUsers)} of ${formatNumber(totalCurrentKnown)} known current`}
              />
              <RadialGauge
                ratio={
                  stats.totals.rpcKnownUsers > 0
                    ? stats.totals.rpcEnabledUsers / stats.totals.rpcKnownUsers
                    : 0
                }
                title="Discord RPC On"
                sub={`${formatNumber(stats.totals.rpcEnabledUsers)} of ${formatNumber(stats.totals.rpcKnownUsers)} reporting`}
              />
            </div>
          </CollapsiblePanel>

          {latestRow ? (
            <CollapsiblePanel kicker="Release" title="Latest Release" padding="tight">
              <KvList
                items={[
                  { k: "Version", v: latestRow.label, tag: "accent" },
                  { k: "Current Users", v: formatNumber(latestRow.currentUsers) },
                  { k: "All-Time Users", v: formatNumber(latestRow.allTimeUsers) },
                  { k: "Sessions", v: formatNumber(latestRow.sessions) },
                  { k: "First Seen", v: formatDay(latestRow.firstSeen) },
                  { k: "Last Seen", v: formatDay(latestRow.lastSeen) },
                ]}
              />
            </CollapsiblePanel>
          ) : null}
        </div>
      </div>

      {/* Release table */}
      <CollapsiblePanel
        kicker="Releases"
        title="Release History"
        sub="Every known release · current vs. all-time adoption."
        defaultOpen={false}
        padding="flush"
        right={<IconButton icon={<Download />} title="Download CSV" onClick={downloadCsv} />}
      >
        {versionRows.length > 0 ? (
          <DataTable<VersionRow>
            flush
            columns={RELEASE_COLUMNS}
            rows={versionRows}
            rowKey={(row) => row.key}
          />
        ) : (
          <EmptyState icon={<Package />} title="No releases">
            GitHub releases and telemetry versions merge here once available.
          </EmptyState>
        )}
      </CollapsiblePanel>
    </div>
  );
}
