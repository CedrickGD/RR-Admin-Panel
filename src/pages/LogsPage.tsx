import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { StatusBadge } from "../components/StatusBadge";
import type { SummaryPayload } from "../types/telemetry";
import { formatDate, formatNumber, timeAgo } from "../utils/format";

interface LogsPageProps {
  summary: SummaryPayload;
}

export function LogsPage({ summary }: LogsPageProps) {
  const [query, setQuery] = useState("");

  const errors = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return summary.recentErrors;
    }

    return summary.recentErrors.filter((event) => {
      const haystack = [
        event.source,
        event.service,
        event.message ?? "",
        JSON.stringify(event.metrics),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [query, summary.recentErrors]);

  return (
    <div className="page-content page-content-wide page-stack">
      <section className="page-header">
        <div>
          <h1 className="page-title">Errors</h1>
          <p className="page-subtitle">Only real application errors.</p>
        </div>
        <div className="page-meta">
          <span>Errors 24h</span>
          <strong>{formatNumber(summary.stats.errorsLast24Hours)}</strong>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Recent Errors</h2>
            <p className="panel-subtitle">Message, source, time, and exception type.</p>
          </div>
          <div className="input-group search-small">
            <Search className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
            <input
              type="text"
              className="input"
              placeholder="Search errors..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>

        <div className="table-shell">
          <div className="table-scroller">
            <table>
              <thead>
                <tr>
                  <th>Message</th>
                  <th>Source</th>
                  <th>Type</th>
                  <th>Occurred</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((event) => (
                  <tr key={event.id}>
                    <td>
                      <div className="font-semibold">{event.message ?? "Unhandled application error"}</div>
                      <div className="table-subline">{event.service}</div>
                    </td>
                    <td>{event.source}</td>
                    <td>{String(event.metrics["exception_type"] ?? event.service)}</td>
                    <td>
                      <div>{formatDate(event.timestamp)}</div>
                      <div className="table-subline">{timeAgo(event.receivedAt)}</div>
                    </td>
                    <td>
                      <StatusBadge status={event.status} showDot={false} />
                    </td>
                  </tr>
                ))}

                {errors.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      <div className="empty-panel small">No recent errors.</div>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
