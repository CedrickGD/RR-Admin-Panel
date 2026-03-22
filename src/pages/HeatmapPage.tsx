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

export function HeatmapPage({
  summary,
  theme,
  onOpenSession,
  focusedSessionId = null,
  focusedSessionToken = 0,
}: HeatmapPageProps) {
  const points       = useMemo(() => buildHeatmapPoints(summary), [summary]);
  const sessionPoints = useMemo(() => buildHeatmapSessionPoints(summary), [summary]);
  const mappedUsers  = sessionPoints.length;
  const unresolvedUsers = Math.max(0, summary.activeSessions.length - mappedUsers);

  const ALL_REGIONS = ["North America", "South America", "Europe", "Asia", "Africa", "Oceania"];

  const regionRows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const region of ALL_REGIONS) counts.set(region, 0);
    for (const point of points) {
      counts.set(point.region, (counts.get(point.region) ?? 0) + point.value);
    }
    const total = Math.max(1, mappedUsers);
    return Array.from(counts.entries())
      .map(([label, value]) => ({ label, value, share: value / total, color: getRegionColor(label) }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  }, [mappedUsers, points]);

  const topMarket  = points[0];
  const errorTotal = summary.activeSessions.reduce((sum, s) => sum + s.errorCount, 0);

  return (
    <div className="page-content page-stack-lg">
      {/* Header */}
      <section className="page-header">
        <div>
          <p className="kicker">Live Geography</p>
          <h1 className="page-title" style={{ marginTop: 6 }}>Heatmap</h1>
          <p className="page-subtitle">
            Click a node to jump to that session's live view.
          </p>
        </div>
        <div className="page-header-right">
          <div className="meta-row">
            {[
              { label: "Errors",   val: formatNumber(errorTotal) },
              { label: "Ingest",   val: summary.stats.lastIngestAt ? timeAgo(summary.stats.lastIngestAt) : "Waiting" },
            ].map((m) => (
              <div className="meta-item" key={m.label}><span>{m.label}</span><strong>{m.val}</strong></div>
            ))}
          </div>
        </div>
      </section>

      {/* Stat row */}
      <div className="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))" }}>
        {[
          { label: "Active Users",    val: formatNumber(summary.activeSessions.length), sub: "Online right now" },
          { label: "Mapped Sessions", val: formatNumber(mappedUsers),  sub: "With geo coordinates" },
          { label: "Regions Online",  val: `${regionRows.filter((r) => r.value > 0).length} / ${regionRows.length}`, sub: "Macro regions active" },
          { label: "Countries Live",  val: formatNumber(points.length), sub: topMarket ? `Top: ${topMarket.label}` : "No data" },
          { label: "Active Errors",   val: formatNumber(errorTotal), sub: "Across active sessions", tone: errorTotal > 0 ? "danger" : undefined },
          { label: "Unmapped",        val: formatNumber(unresolvedUsers), sub: "No geo data available" },
        ].map((s) => (
          <div className={`stat-card${s.tone ? ` tone-${s.tone}` : ""}`} key={s.label}>
            <span className="stat-label">{s.label}</span>
            <strong className="stat-value" style={{ fontSize: "1.5rem" }}>{s.val}</strong>
            <p className="stat-sub">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Map + regions */}
      <div className="main-side-lg">
        {/* World map */}
        <section className="panel">
          <div className="panel-head">
            <div className="panel-head-left">
              <p className="kicker">World View</p>
              <h2 className="section-title">Active User Field</h2>
            </div>
          </div>
          <div className="panel-body-flush" style={{ minHeight: 480 }}>
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

        {/* Regional breakdown */}
        <section className="panel">
          <div className="panel-head">
            <div className="panel-head-left">
              <p className="kicker">Regions</p>
              <h2 className="section-title">Regional Load</h2>
            </div>
          </div>
          <div className="panel-body-tight">
            {regionRows.length > 0 ? (
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
              <div className="empty-state" style={{ padding: "24px 16px" }}><p>No active geographic data.</p></div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
