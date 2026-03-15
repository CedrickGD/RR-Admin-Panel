import { Globe2, Radio, ShieldAlert, Waypoints } from "lucide-react";
import { useMemo } from "react";
import { StatCard } from "../components/StatCard";
import { WorldHeatmap } from "../components/charts/WorldHeatmap";
import type { SummaryPayload, ThemeMode } from "../types/telemetry";
import { getRegionColor } from "../utils/geography";
import { buildHeatmapPoints, buildHeatmapSessionPoints } from "../utils/dashboardInsights";
import { formatNumber, timeAgo } from "../utils/format";

interface HeatmapPageProps {
  summary: SummaryPayload;
  theme: ThemeMode;
  onOpenSession: (sessionId: string) => void;
  focusedSessionId?: string | null;
  focusedSessionToken?: number;
}

export function HeatmapPage({
  summary,
  theme,
  onOpenSession,
  focusedSessionId = null,
  focusedSessionToken = 0,
}: HeatmapPageProps) {
  const points = useMemo(() => buildHeatmapPoints(summary), [summary]);
  const sessionPoints = useMemo(() => buildHeatmapSessionPoints(summary), [summary]);
  const mappedUsers = sessionPoints.length;
  const unresolvedUsers = Math.max(0, summary.activeSessions.length - mappedUsers);
  const regionRows = useMemo(() => {
    const counts = new Map<string, { label: string; value: number }>();
    const total = Math.max(1, mappedUsers);

    for (const point of points) {
      const current = counts.get(point.region) ?? { label: point.region, value: 0 };
      current.value += point.value;
      counts.set(point.region, current);
    }

    return Array.from(counts.values())
      .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label))
      .map((row) => ({
        ...row,
        share: row.value / total,
        color: getRegionColor(row.label),
      }));
  }, [mappedUsers, points]);
  const topMarket = points[0];
  const errorTotal = summary.activeSessions.reduce((sum, session) => sum + session.errorCount, 0);

  return (
    <div className="page-content page-content-wide page-stack heatmap-page">
      <section className="page-header">
        <div>
          <p className="page-kicker">Live Geography</p>
          <h1 className="page-title">Heatmap</h1>
          <p className="page-subtitle">
            A production-facing live world view on a free deep-zoom map stack. Only active sessions render here, and the turquoise pulse field tracks users who are online right now.
          </p>
        </div>

        <div className="page-header-side">
          <div className="page-meta-stack page-meta-stack-live">
            <div className="page-meta">
              <span>Active now</span>
              <strong>{formatNumber(summary.activeSessions.length)}</strong>
            </div>
            <div className="page-meta">
              <span>Mapped users</span>
              <strong>{formatNumber(mappedUsers)}</strong>
            </div>
            <div className="page-meta">
              <span>Countries live</span>
              <strong>{formatNumber(points.length)}</strong>
            </div>
            <div className="page-meta">
              <span>Last ingest</span>
              <strong>{summary.stats.lastIngestAt ? timeAgo(summary.stats.lastIngestAt) : "Waiting"}</strong>
            </div>
          </div>
        </div>
      </section>

      <div className="overview-stat-grid">
        <StatCard
          label="Mapped Live Users"
          value={formatNumber(mappedUsers)}
          sub="Active sessions with a resolved country centroid"
          icon={<Radio className="h-5 w-5" />}
          tone="primary"
        />
        <StatCard
          label="Regions Online"
          value={formatNumber(regionRows.length)}
          sub="Macro-regions represented on the map right now"
          icon={<Waypoints className="h-5 w-5" />}
          tone="accent"
        />
        <StatCard
          label="Top Live Market"
          value={topMarket ? `${topMarket.flag ? `${topMarket.flag} ` : ""}${topMarket.label}` : "None"}
          sub={topMarket ? `${formatNumber(topMarket.value)} active sessions` : "No active geo data"}
          icon={<Globe2 className="h-5 w-5" />}
          tone="accent"
        />
        <StatCard
          label="Active Errors"
          value={formatNumber(errorTotal)}
          sub={`${formatNumber(unresolvedUsers)} users could not be mapped`}
          icon={<ShieldAlert className="h-5 w-5" />}
          tone="rose"
        />
      </div>

      <div className="heatmap-layout">
        <section className="panel panel-dense">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">World View</p>
              <h2 className="panel-title">Active user field</h2>
              <p className="panel-subtitle">
                Turquoise micro-nodes mark each active session on the world map. Click a node to lock its label and open that exact session in Live.
              </p>
            </div>
          </div>

          <div className="world-map-shell">
            <WorldHeatmap
              marketPoints={points}
              sessionPoints={sessionPoints}
              theme={theme}
              onOpenSession={onOpenSession}
              focusedSessionId={focusedSessionId}
              focusedSessionToken={focusedSessionToken}
            />
          </div>
        </section>

        <div className="overview-side-stack">
          <section className="panel panel-dense">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Regions</p>
                <h2 className="panel-title">Live regional load</h2>
                <p className="panel-subtitle">Current active users grouped into macro regions.</p>
              </div>
            </div>

            <div className="heatmap-region-list">
              {regionRows.length > 0 ? (
                regionRows.map((row) => (
                  <div key={row.label} className="heatmap-region-row">
                    <div className="heatmap-region-copy">
                      <strong>{row.label}</strong>
                      <span>{(row.share * 100).toFixed(1)}% of mapped live users</span>
                    </div>
                    <div className="heatmap-region-bar">
                      <span
                        className="heatmap-region-bar-fill"
                        style={{
                          width: `${Math.max(8, row.share * 100)}%`,
                          backgroundColor: row.color,
                        }}
                      />
                    </div>
                    <span className="heatmap-region-value">{formatNumber(row.value)}</span>
                  </div>
                ))
              ) : (
                <div className="empty-panel small">No mapped active regions yet.</div>
              )}
            </div>
          </section>

          <section className="panel panel-dense">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Markets</p>
                <h2 className="panel-title">Top live locations</h2>
                <p className="panel-subtitle">Highest-volume active countries in the current frame.</p>
              </div>
            </div>

            <div className="heatmap-location-list">
              {points.length > 0 ? (
                points.slice(0, 8).map((point) => (
                  <div key={point.code ?? point.label} className="heatmap-location-row">
                    <div className="heatmap-location-copy">
                      <strong>{point.flag ? `${point.flag} ${point.label}` : point.label}</strong>
                      <span>{point.region}</span>
                    </div>
                    <div className="heatmap-location-side">
                      <strong>{formatNumber(point.value)}</strong>
                      <span>{formatNumber(point.errors)} errors</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-panel small">No active locations to rank right now.</div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
