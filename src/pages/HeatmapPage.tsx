import { Activity, AlertTriangle, Earth, Map as MapIcon, MapPin, MapPinOff, Users } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { WorldHeatmap } from "../components/charts/WorldHeatmap";
import { EmptyState } from "../components/ds/EmptyState";
import { MetaRow, PageHeader } from "../components/ds/PageHeader";
import { GlassDropdown } from "../components/GlassDropdown";
import { KpiStatCard } from "../components/KpiStatCard";
import type {
  AppSessionRecord,
  SummaryPayload,
  ThemeMode,
  UserRollupRecord,
} from "../types/telemetry";
import {
  type CountryGeo,
  formatCountryLabel,
  getMacroRegion,
  getRegionColor,
  resolveCountry,
} from "../utils/geography";
import {
  buildHeatmapPoints,
  buildHeatmapSessionPoints,
  type HeatmapPoint,
  type HeatmapSessionPoint,
} from "../utils/dashboardInsights";
import { formatNumber, timeAgo } from "../utils/format";

type MapView = "live" | "alltime";

const ALL_REGIONS = ["North America", "South America", "Europe", "Asia", "Africa", "Oceania"];
const REGION_SHORT: Record<string, string> = {
  "North America": "NA",
  "South America": "SA",
  Europe: "EU",
  Asia: "AS",
  Africa: "AF",
  Oceania: "OC",
};

interface HeatmapPageProps {
  summary: SummaryPayload;
  users: UserRollupRecord[] | null;
  theme: ThemeMode;
  onOpenSession: (sessionId: string) => void;
  focusedSessionId?: string | null;
  focusedSessionToken?: number;
  filterBar?: ReactNode;
}

interface StatChip {
  label: string;
  val: string;
  sub: string;
  /** Lucide icon for the tile's right-side well (DS tile anatomy, 14px). */
  icon: ReactNode;
  tone?: "danger";
}

interface MappedUser {
  user: UserRollupRecord;
  country: CountryGeo | null;
  region: string;
  latitude: number;
  longitude: number;
}

function getSessionIdentity(session: AppSessionRecord): string {
  const hwid = session.hwid?.trim();
  return (hwid && hwid.length > 0 ? hwid : session.installId.trim()).toLowerCase();
}

function getSessionRecency(session: AppSessionRecord): number {
  const stamps = [session.lastSeenAt, session.endedAt, session.startedAt]
    .map((value) => Date.parse(value ?? ""))
    .filter((value) => Number.isFinite(value));
  return stamps.length > 0 ? Math.max(...stamps) : 0;
}

/** Live mode renders one dot per user: keep the most recent session per hwid/installId. */
function dedupeSessionsByUser(sessions: AppSessionRecord[]): AppSessionRecord[] {
  const byUser = new Map<string, AppSessionRecord>();
  for (const session of sessions) {
    const identity = getSessionIdentity(session);
    const previous = byUser.get(identity);
    if (!previous || getSessionRecency(session) >= getSessionRecency(previous)) {
      byUser.set(identity, session);
    }
  }
  return Array.from(byUser.values());
}

function formatVersionTag(raw: string | null): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  return `v${trimmed.replace(/^v/i, "")}`;
}

function renderCountryOption(code: string): string {
  const country = resolveCountry(code);
  return country ? `${country.flag} ${country.label}` : code;
}

export function HeatmapPage({
  summary,
  users,
  theme,
  onOpenSession,
  focusedSessionId = null,
  focusedSessionToken = 0,
  filterBar,
}: HeatmapPageProps) {
  const [view, setView] = useState<MapView>("live");
  const [regionFilter, setRegionFilter] = useState<string | null>(null);
  const [countryCode, setCountryCode] = useState<string | null>(null);

  const filtersActive = regionFilter !== null || countryCode !== null;

  /* ── Live pipeline: dedupe active sessions per user, then apply geo filters ── */
  const liveSessions = useMemo(() => dedupeSessionsByUser(summary.activeSessions), [summary]);

  const liveMappedCount = useMemo(
    () => liveSessions.reduce((count, session) => count + (resolveCountry(session.clientCountry) ? 1 : 0), 0),
    [liveSessions],
  );

  const liveFilteredSessions = useMemo(
    () =>
      liveSessions.filter((session) => {
        if (!regionFilter && !countryCode) return true;
        const country = resolveCountry(session.clientCountry);
        if (countryCode && country?.code !== countryCode) return false;
        if (regionFilter && (country ? getMacroRegion(country) : "Unknown") !== regionFilter) return false;
        return true;
      }),
    [liveSessions, regionFilter, countryCode],
  );

  const liveSummary = useMemo<SummaryPayload>(
    () => ({ ...summary, activeSessions: liveFilteredSessions }),
    [summary, liveFilteredSessions],
  );
  const liveMarkets = useMemo(() => buildHeatmapPoints(liveSummary), [liveSummary]);
  const livePoints = useMemo(() => buildHeatmapSessionPoints(liveSummary), [liveSummary]);

  /* ── All-time pipeline: one dot per rollup user with coordinates ── */
  const mappedUsers = useMemo<MappedUser[]>(() => {
    const byIdentity = new Map<string, MappedUser>();
    for (const user of users ?? []) {
      if (
        !Number.isFinite(user.latitude ?? Number.NaN) ||
        !Number.isFinite(user.longitude ?? Number.NaN)
      ) {
        continue;
      }
      const country = resolveCountry(user.country);
      const next: MappedUser = {
        user,
        country,
        region: country ? getMacroRegion(country) : "Unknown",
        latitude: Number(user.latitude),
        longitude: Number(user.longitude),
      };
      const previous = byIdentity.get(user.identity);
      if (!previous || Date.parse(user.lastSeen) >= Date.parse(previous.user.lastSeen)) {
        byIdentity.set(user.identity, next);
      }
    }
    return Array.from(byIdentity.values());
  }, [users]);

  const filteredUsers = useMemo(
    () =>
      mappedUsers.filter((entry) => {
        if (countryCode && entry.country?.code !== countryCode) return false;
        if (regionFilter && entry.region !== regionFilter) return false;
        return true;
      }),
    [mappedUsers, regionFilter, countryCode],
  );

  const alltimeMarkets = useMemo<HeatmapPoint[]>(() => {
    const counts = new Map<string, HeatmapPoint>();
    for (const entry of filteredUsers) {
      const label = entry.country?.label ?? formatCountryLabel(entry.user.country);
      const key = entry.country?.code ?? label;
      const current = counts.get(key) ?? {
        code: entry.country?.code ?? null,
        label,
        value: 0,
        region: entry.region,
        share: 0,
        active: 0,
        errors: 0,
        flag: entry.country?.flag ?? null,
        latitude: entry.country?.latitude ?? entry.latitude,
        longitude: entry.country?.longitude ?? entry.longitude,
        intensity: 0,
      };
      current.value += 1;
      current.active += entry.user.isActive ? 1 : 0;
      current.errors += entry.user.errors;
      counts.set(key, current);
    }
    const points = Array.from(counts.values()).sort(
      (a, b) => b.value - a.value || a.label.localeCompare(b.label),
    );
    const total = points.reduce((sum, point) => sum + point.value, 0);
    const peak = Math.max(1, ...points.map((point) => point.value));
    return points.map((point) => ({
      ...point,
      share: total > 0 ? point.value / total : 0,
      intensity: point.value / peak,
    }));
  }, [filteredUsers]);

  const alltimePoints = useMemo<HeatmapSessionPoint[]>(() => {
    const marketLookup = new Map<string, HeatmapPoint>();
    for (const market of alltimeMarkets) marketLookup.set(market.code ?? market.label, market);

    return filteredUsers
      .map((entry) => {
        const countryLabel = entry.country?.label ?? formatCountryLabel(entry.user.country);
        const marketKey = entry.country?.code ?? countryLabel;
        const market = marketLookup.get(marketKey);
        const displayName =
          entry.user.discordUser?.trim() ||
          entry.user.userLabel?.trim() ||
          `User ${entry.user.identity.slice(0, 8)}`;
        const version = formatVersionTag(entry.user.displayVersion ?? entry.user.appVersion);
        const city = entry.user.city?.trim();

        return {
          key: entry.user.identity,
          marketKey,
          label: displayName,
          region: entry.region,
          flag: entry.country?.flag ?? null,
          latitude: entry.latitude,
          longitude: entry.longitude,
          anchorLatitude: entry.country?.latitude ?? entry.latitude,
          anchorLongitude: entry.country?.longitude ?? entry.longitude,
          marketValue: market?.value ?? 1,
          marketErrors: market?.errors ?? entry.user.errors,
          errors: entry.user.errors,
          // Zero intensity + spread styling = the smallest, dimmest marker variant.
          intensity: 0,
          locationLabel: city ? `${city}, ${countryLabel}` : countryLabel,
          userLabel: `Last seen ${timeAgo(entry.user.lastSeen)}${version ? ` · ${version}` : ""}`,
          geoSource: null,
          geoSignalSource: null,
          accuracyMeters: null,
          precise: false,
        };
      })
      .sort(
        (left, right) =>
          right.marketValue - left.marketValue ||
          left.label.localeCompare(right.label) ||
          left.key.localeCompare(right.key),
      );
  }, [filteredUsers, alltimeMarkets]);

  /* ── Active dataset for the selected view ── */
  const markets = view === "live" ? liveMarkets : alltimeMarkets;
  const dots = view === "live" ? livePoints : alltimePoints;

  /* ── Offline session focus: synthesize a dot when the focused session is not rendered ── */
  const focusPoint = useMemo<HeatmapSessionPoint | null>(() => {
    if (!focusedSessionId) return null;
    const baseDots = view === "live" ? livePoints : alltimePoints;
    if (baseDots.some((point) => point.key === focusedSessionId)) return null;

    const session =
      summary.activeSessions.find((entry) => entry.id === focusedSessionId) ??
      summary.recentSessions.find((entry) => entry.id === focusedSessionId);
    if (!session) return null;

    const country = resolveCountry(session.clientCountry);
    const hasExact =
      Number.isFinite(session.clientLatitude ?? Number.NaN) &&
      Number.isFinite(session.clientLongitude ?? Number.NaN);
    const latitude = hasExact ? Number(session.clientLatitude) : country?.latitude ?? null;
    const longitude = hasExact ? Number(session.clientLongitude) : country?.longitude ?? null;
    if (latitude === null || longitude === null) return null;

    const countryLabel = country?.label ?? formatCountryLabel(session.clientCountry);
    const locationParts = [session.clientCity, session.clientRegion].filter(
      (value): value is string => Boolean(value?.trim()),
    );
    const name = session.userLabel?.trim() || `Session ${session.id.slice(0, 8)}`;

    return {
      key: session.id,
      marketKey: country?.code ?? countryLabel,
      label: countryLabel,
      region: country ? getMacroRegion(country) : "Unknown",
      flag: country?.flag ?? null,
      latitude,
      longitude,
      anchorLatitude: country?.latitude ?? latitude,
      anchorLongitude: country?.longitude ?? longitude,
      marketValue: 1,
      marketErrors: session.errorCount,
      errors: session.errorCount,
      intensity: session.isActive ? 0.5 : 0.15,
      locationLabel: locationParts.length > 0 ? locationParts.join(", ") : countryLabel,
      userLabel: `${name} · ${session.isActive ? "Active now" : `Last seen ${timeAgo(session.lastSeenAt)}`}`,
      geoSource: session.clientGeoSource ?? null,
      geoSignalSource: session.clientGeoSignalSource ?? null,
      accuracyMeters: Number.isFinite(session.clientAccuracyMeters ?? Number.NaN)
        ? Number(session.clientAccuracyMeters)
        : null,
      precise: hasExact,
    };
  }, [focusedSessionId, view, livePoints, alltimePoints, summary]);

  const mapDots = useMemo(
    () => (focusPoint ? [...dots, focusPoint] : dots),
    [dots, focusPoint],
  );

  /* ── Regional load follows the selected view + filters ── */
  const regionRows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const region of ALL_REGIONS) counts.set(region, 0);
    for (const market of markets) {
      counts.set(market.region, (counts.get(market.region) ?? 0) + market.value);
    }
    const total = Math.max(1, Array.from(counts.values()).reduce((sum, value) => sum + value, 0));
    return Array.from(counts.entries())
      .map(([label, value]) => ({ label, value, share: value / total, color: getRegionColor(label) }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  }, [markets]);

  /* ── Country dropdown options scoped to the active view + region chip ── */
  const countryCodes = useMemo(() => {
    const labels = new Map<string, string>();
    if (view === "live") {
      for (const session of liveSessions) {
        const country = resolveCountry(session.clientCountry);
        if (!country) continue;
        if (regionFilter && getMacroRegion(country) !== regionFilter) continue;
        labels.set(country.code, country.label);
      }
    } else {
      for (const entry of mappedUsers) {
        if (!entry.country) continue;
        if (regionFilter && entry.region !== regionFilter) continue;
        labels.set(entry.country.code, entry.country.label);
      }
    }
    return Array.from(labels.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([code]) => code);
  }, [view, liveSessions, mappedUsers, regionFilter]);

  function selectRegion(next: string | null) {
    setRegionFilter(next);
    // Drop a country selection that falls outside the newly picked region.
    if (next && countryCode) {
      const country = resolveCountry(countryCode);
      if (!country || getMacroRegion(country) !== next) setCountryCode(null);
    }
  }

  /* ── Header chips follow the selected view ── */
  const errorTotal =
    view === "live"
      ? liveFilteredSessions.reduce((sum, session) => sum + session.errorCount, 0)
      : filteredUsers.reduce((sum, entry) => sum + entry.user.errors, 0);
  const topMarket = markets[0];
  const regionsActive = regionRows.filter((row) => row.value > 0).length;
  const totalUsers = users?.length ?? 0;

  const statCards: StatChip[] =
    view === "live"
      ? [
          { label: "Active Users", val: formatNumber(liveSessions.length), sub: "Online right now", icon: <Activity size={14} /> },
          { label: "Mapped Dots", val: formatNumber(dots.length), sub: filtersActive ? "Matching filters" : "With geo data", icon: <MapPin size={14} /> },
          { label: "Regions Online", val: `${regionsActive} / ${regionRows.length}`, sub: "Macro regions active", icon: <Earth size={14} /> },
          { label: "Countries Live", val: formatNumber(markets.length), sub: topMarket ? `Top: ${topMarket.label}` : "No data", icon: <MapIcon size={14} /> },
          { label: "Active Errors", val: formatNumber(errorTotal), sub: "Across live sessions", icon: <AlertTriangle size={14} />, tone: errorTotal > 0 ? "danger" : undefined },
          { label: "Unmapped", val: formatNumber(Math.max(0, liveSessions.length - liveMappedCount)), sub: "No geo data", icon: <MapPinOff size={14} /> },
        ]
      : [
          { label: "Total Users", val: formatNumber(totalUsers), sub: users ? "All-time rollup" : "Rollup loading…", icon: <Users size={14} /> },
          { label: "Mapped Users", val: formatNumber(dots.length), sub: filtersActive ? "Matching filters" : "With coordinates", icon: <MapPin size={14} /> },
          { label: "Regions Reached", val: `${regionsActive} / ${regionRows.length}`, sub: "Macro regions ever", icon: <Earth size={14} /> },
          { label: "Countries", val: formatNumber(markets.length), sub: topMarket ? `Top: ${topMarket.label}` : "No data", icon: <MapIcon size={14} /> },
          { label: "Lifetime Errors", val: formatNumber(errorTotal), sub: "Across mapped users", icon: <AlertTriangle size={14} />, tone: errorTotal > 0 ? "danger" : undefined },
          { label: "Unmapped", val: formatNumber(Math.max(0, totalUsers - mappedUsers.length)), sub: "No coordinates", icon: <MapPinOff size={14} /> },
        ];

  return (
    <div className="page-content page-stack-lg heatmap-page">
      {/* Header — view seg + country filter + meta right; region chips on their own row */}
      <PageHeader
        kicker="Geography"
        title="Heatmap"
        right={
          <>
            {filterBar}
            {/* View mode */}
            <div className="seg-control">
              <button type="button" className={`seg-btn${view === "live" ? " active" : ""}`} onClick={() => setView("live")}>
                Live
              </button>
              <button type="button" className={`seg-btn${view === "alltime" ? " active" : ""}`} onClick={() => setView("alltime")}>
                All time
              </button>
            </div>
            {/* Country filter */}
            <GlassDropdown
              placeholder="All countries"
              options={countryCodes}
              value={countryCode}
              onChange={setCountryCode}
              renderOption={renderCountryOption}
            />
            <MetaRow
              items={[
                { label: "Errors", value: formatNumber(errorTotal) },
                { label: "Ingest", value: summary.stats.lastIngestAt ? timeAgo(summary.stats.lastIngestAt) : "Waiting" },
              ]}
            />
          </>
        }
      />

      {/* Region chips */}
      <div className="filters">
        <div className="seg-control">
          <button
            type="button"
            title="All regions"
            className={`seg-btn${regionFilter === null ? " active" : ""}`}
            onClick={() => selectRegion(null)}
          >
            All
          </button>
          {ALL_REGIONS.map((region) => (
            <button
              key={region}
              type="button"
              title={region}
              className={`seg-btn${regionFilter === region ? " active" : ""}`}
              onClick={() => selectRegion(regionFilter === region ? null : region)}
            >
              {REGION_SHORT[region] ?? region}
            </button>
          ))}
        </div>
      </div>

      {/* KPI row */}
      <div className="stat-grid stat-grid-6 v2-stagger">
        {statCards.map((s) => (
          <KpiStatCard key={s.label} label={s.label} value={s.val} sub={s.sub} icon={s.icon} tone={s.tone} />
        ))}
      </div>

      {/* Map + regions — Regional Load sits beside the map; stretch the row so the
          side panel tracks the map height instead of leaving a dead band below. */}
      <div className="main-side-lg main-side-stretch">
        {/* World map */}
        <section className="panel">
          <div className="panel-head">
            <div className="panel-head-left">
              <p className="kicker">Map</p>
              <h2 className="section-title">World View</h2>
            </div>
            <div className="panel-head-right">
              <span className="section-sub">
                {formatNumber(mapDots.length)} {mapDots.length === 1 ? "dot" : "dots"}
                {filtersActive ? " · filtered" : ""}
              </span>
            </div>
          </div>
          <div className="panel-body-flush heatmap-map-container">
            <WorldHeatmap
              marketPoints={markets}
              sessionPoints={mapDots}
              theme={theme}
              onOpenSession={onOpenSession}
              focusedSessionId={focusedSessionId}
              focusedSessionToken={focusedSessionToken}
            />
          </div>
        </section>

        {/* Regional breakdown */}
        <section className="panel">
          <div className="panel-head">
            <div className="panel-head-left">
              <p className="kicker">Regions</p>
              <h2 className="section-title">Regional Load</h2>
            </div>
            <div className="panel-head-right">
              <span className="section-sub">{view === "live" ? "Live sessions" : "All-time users"}</span>
            </div>
          </div>
          <div className="panel-body-tight">
            {regionRows.some((row) => row.value > 0) ? (
              <div className="progress-wrap">
                {regionRows.map((row) => (
                  <div className="progress-row" key={row.label}>
                    <div className="progress-head">
                      <span className="progress-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 50, background: row.color, display: "inline-block", flexShrink: 0 }} />
                        {row.label}
                      </span>
                      <span className="progress-val">{formatNumber(row.value)}</span>
                    </div>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${Math.round(row.share * 100)}%`, background: row.color }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<Earth />}
                title={filtersActive ? "No matching data" : view === "live" ? "No live geography" : "No mapped users"}
              >
                {filtersActive
                  ? "No geographic data matches the active filters."
                  : view === "live"
                    ? "No active sessions with geo data. Dots surface here as users come online."
                    : "No mapped users yet. Users appear once coordinates are ingested."}
              </EmptyState>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
