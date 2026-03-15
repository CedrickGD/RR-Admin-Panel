import { useMemo } from "react";
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

type MetricTone = "primary" | "accent" | "warning" | "danger" | "neutral";

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
  const metrics: Array<{ label: string; value: string; note: string; tone: MetricTone }> = [
    {
      label: "Active users",
      value: formatNumber(summary.activeSessions.length),
      note: "Current online session count",
      tone: "primary",
    },
    {
      label: "Mapped users",
      value: formatNumber(mappedUsers),
      note: "Sessions with a resolved country centroid",
      tone: "accent",
    },
    {
      label: "Regions online",
      value: formatNumber(regionRows.length),
      note: "Macro regions represented right now",
      tone: "neutral",
    },
    {
      label: "Countries live",
      value: formatNumber(points.length),
      note: topMarket ? `Largest market: ${topMarket.label}` : "No active geo data",
      tone: "accent",
    },
    {
      label: "Active errors",
      value: formatNumber(errorTotal),
      note: "Errors across currently active sessions",
      tone: "danger",
    },
    {
      label: "Unmapped",
      value: formatNumber(unresolvedUsers),
      note: "Active sessions without map coordinates",
      tone: "warning",
    },
  ];

  return (
    <div className="page-content page-content-wide page-stack heatmap-page">
      <section className="page-header">
        <div>
          <p className="page-kicker">Live Geography</p>
          <h1 className="page-title">Heatmap</h1>
          <p className="page-subtitle">
            A live geographic command surface for active sessions only. The map stays central while regional load and
            top markets sit beside it as a compact command rail instead of separate stat widgets.
          </p>
        </div>

        <div className="page-header-side">
          <div className="page-meta-stack page-meta-stack-live">
            <div className="page-meta">
              <span>Last ingest</span>
              <strong>{summary.stats.lastIngestAt ? timeAgo(summary.stats.lastIngestAt) : "Waiting"}</strong>
            </div>
            <div className="page-meta">
              <span>Generated</span>
              <strong>{timeAgo(summary.generatedAt)}</strong>
            </div>
            <div className="page-meta">
              <span>Mapped users</span>
              <strong>{formatNumber(mappedUsers)}</strong>
            </div>
            <div className="page-meta">
              <span>Top market</span>
              <strong>{topMarket ? topMarket.label : "None"}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="command-slab">
        <div className="command-slab-head">
          <div>
            <p className="panel-kicker">Live geography posture</p>
            <h2 className="panel-title">Current map coverage</h2>
            <p className="panel-subtitle">
              A single command strip for coverage, geo resolution, and pressure before you start drilling into
              individual sessions.
            </p>
          </div>
        </div>

        <div className="command-strip command-strip-tight">
          {metrics.map((metric) => (
            <article key={metric.label} className={`command-metric command-metric-${metric.tone}`}>
              <span className="command-metric-label">{metric.label}</span>
              <strong className="command-metric-value">{metric.value}</strong>
              <p className="command-metric-note">{metric.note}</p>
            </article>
          ))}
        </div>
      </section>

      <div className="heatmap-layout">
        <section className="panel panel-dense">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">World view</p>
              <h2 className="panel-title">Active user field</h2>
              <p className="panel-subtitle">
                Every active session gets its own map node. Lock a node, then jump straight into that session on the
                live page.
              </p>
            </div>
            <div className="panel-inline-metrics">
              <div>
                <span>Markets</span>
                <strong>{formatNumber(points.length)}</strong>
              </div>
              <div>
                <span>Regions</span>
                <strong>{formatNumber(regionRows.length)}</strong>
              </div>
              <div>
                <span>Errors</span>
                <strong>{formatNumber(errorTotal)}</strong>
              </div>
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
