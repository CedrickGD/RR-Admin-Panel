import { AlertTriangle, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { SummaryPayload } from "../types/telemetry";
import { formatDate, formatNumber, timeAgo } from "../utils/format";

interface LogsPageProps {
  summary: SummaryPayload;
}

export function LogsPage({ summary }: LogsPageProps) {
  const [query, setQuery] = useState("");

  const errors = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return summary.recentErrors;
    return summary.recentErrors.filter((e) => {
      const hay = [e.source, e.service, e.message ?? "", JSON.stringify(e.metrics)].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [query, summary.recentErrors]);

  const latestError = summary.recentErrors[0];

  return (
    <div className="page-content page-stack-lg">
      {/* Header */}
      <section className="page-header">
        <div>
          <p className="kicker">Incident Feed</p>
          <h1 className="page-title" style={{ marginTop: 6 }}>Errors</h1>
          <p className="page-subtitle">Application error log — real failures only, no telemetry noise.</p>
        </div>
        <div className="page-header-right">
          <div className="meta-row">
            {[
              { label: "Errors 24h",   val: formatNumber(summary.stats.errorsLast24Hours) },
              { label: "Visible Rows", val: formatNumber(errors.length) },
              { label: "Latest",       val: latestError ? timeAgo(latestError.timestamp) : "None" },
            ].map((m) => (
              <div className="meta-item" key={m.label}><span>{m.label}</span><strong>{m.val}</strong></div>
            ))}
          </div>
        </div>
      </section>

      {/* Search bar + table */}
      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-left">
            <p className="kicker">Log</p>
            <h2 className="section-title">Error Events</h2>
          </div>
          <div className="panel-head-right">
            <div className="search-wrap" style={{ width: "min(320px, 100%)" }}>
              <Search className="search-icon h-3.5 w-3.5" />
              <input
                type="search"
                placeholder="Filter errors…"
                className="glass-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="panel-body-flush">
          {errors.length > 0 ? (
            <div className="data-table-wrap" style={{ borderRadius: 0, border: "none" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Source</th>
                    <th>Service</th>
                    <th>Message</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {errors.map((error) => {
                    const errType = String(error.metrics["exception_type"] ?? "—");
                    return (
                      <tr key={error.id}>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--danger)" }} />
                            <span className="mono" style={{ fontSize: "0.75rem", color: "var(--text-1)" }}>{errType}</span>
                          </div>
                        </td>
                        <td className="mono">{error.source}</td>
                        <td><span className="badge badge-muted">{error.service}</span></td>
                        <td style={{ maxWidth: 300 }}>
                          <span style={{ color: "var(--text-2)", fontSize: "0.8125rem", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {error.message ?? "No message"}
                          </span>
                        </td>
                        <td className="muted" style={{ whiteSpace: "nowrap" }}>
                          <span title={formatDate(error.timestamp)}>{timeAgo(error.timestamp)}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon"><AlertTriangle className="h-5 w-5" /></div>
              <strong>{query ? "No errors match your filter." : "No errors recorded."}</strong>
              <p>{query ? "Try a different search term." : "The system is clean."}</p>
            </div>
          )}
        </div>
      </section>

      {/* Detail cards for recent errors */}
      {errors.length > 0 ? (
        <section className="panel">
          <div className="panel-head">
            <div className="panel-head-left">
              <p className="kicker">Detail</p>
              <h2 className="section-title">Error Metadata</h2>
              <p className="section-sub">Full context for the most recent {Math.min(errors.length, 10)} errors.</p>
            </div>
          </div>
          <div className="panel-body">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {errors.slice(0, 10).map((error) => (
                <div key={error.id} className="glass-inset" style={{ padding: "14px 16px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 700, fontSize: "0.875rem", marginBottom: 4 }}>
                        {String(error.metrics["exception_type"] ?? error.service)}
                      </p>
                      <p style={{ fontSize: "0.8125rem", color: "var(--text-2)", marginBottom: 8 }}>
                        {error.message ?? "No message provided"}
                      </p>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <span className="badge badge-muted">{error.source}</span>
                        <span className="badge badge-muted">{error.service}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <p style={{ fontSize: "0.75rem", color: "var(--text-3)", marginBottom: 2 }}>{timeAgo(error.timestamp)}</p>
                      <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.6875rem", color: "var(--text-3)" }}>
                        {formatDate(error.timestamp)}
                      </p>
                    </div>
                  </div>
                  {Object.keys(error.metrics).length > 0 ? (
                    <div style={{ marginTop: 10, borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 10 }}>
                      <p className="label-sm" style={{ marginBottom: 6 }}>Metrics</p>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {Object.entries(error.metrics).slice(0, 8).map(([k, v]) => (
                          <span key={k} style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.6875rem", color: "var(--text-2)", background: "rgba(255,255,255,0.05)", padding: "2px 7px", borderRadius: 5 }}>
                            {k}: {String(v)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
