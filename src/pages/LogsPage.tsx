import { AlertTriangle, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { StatusBadge } from "../components/StatusBadge";
import type { SummaryPayload } from "../types/telemetry";
import { formatDate, formatUtc, timeAgo } from "../utils/format";

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
    <div className="page-content">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold">Errors</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Recent app errors with timestamps and raw payload details
          </p>
        </div>
        <div className="input-group w-full sm:w-[280px]">
          <Search className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
          <input
            type="text"
            className="input"
            placeholder="Search errors..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      <div className="card divide-y divide-[hsl(var(--border)/0.5)]">
        {errors.map((event) => (
          <div key={event.id} className="px-5 py-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/10 text-rose-400">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold">{event.message ?? "Unhandled application error"}</p>
                  <StatusBadge status={event.status} showDot={false} />
                </div>
                <div className="mt-2 grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                  <InfoBlock label="Source" value={event.source} />
                  <InfoBlock label="When" value={formatDate(event.timestamp)} />
                  <InfoBlock label="Received" value={timeAgo(event.receivedAt)} />
                  <InfoBlock label="Type" value={String(event.metrics["exception_type"] ?? event.service)} />
                </div>
                <div className="mt-3 rounded-xl bg-[hsl(var(--muted)/0.35)] p-3">
                  <p className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] mb-2">
                    Raw Payload
                  </p>
                  <pre className="overflow-x-auto text-[11px] font-[JetBrains_Mono,monospace] leading-relaxed whitespace-pre-wrap">
                    {JSON.stringify(
                      {
                        timestamp: formatUtc(event.timestamp),
                        receivedAt: formatUtc(event.receivedAt),
                        metrics: event.metrics,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        ))}

        {errors.length === 0 ? (
          <div className="py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">
            No recent errors
          </div>
        ) : null}
      </div>
    </div>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-[hsl(var(--muted-foreground))]">{label}</p>
      <p className="font-medium break-all">{value}</p>
    </div>
  );
}
