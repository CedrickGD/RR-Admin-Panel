import { Radio } from "lucide-react";
import { useMemo } from "react";
import { StatusBadge } from "../components/StatusBadge";
import type { SummaryPayload, TelemetryStatus } from "../types/telemetry";
import { formatDate, timeAgo } from "../utils/format";

const ACTIVE_WINDOW_MS = 2 * 60 * 1000;

interface LivePageProps {
  summary: SummaryPayload;
}

interface LiveSession {
  source: string;
  lastSeen: string;
  status: TelemetryStatus;
  services: number;
}

function compareStatus(left: TelemetryStatus, right: TelemetryStatus): TelemetryStatus {
  const rank: Record<TelemetryStatus, number> = {
    down: 3,
    degraded: 2,
    ok: 1,
  };
  return rank[left] >= rank[right] ? left : right;
}

export function LivePage({ summary }: LivePageProps) {
  const sessions = useMemo<LiveSession[]>(() => {
    const map = new Map<
      string,
      {
        lastSeen: string;
        status: TelemetryStatus;
        services: Set<string>;
      }
    >();

    const events = summary.latest;
    for (const event of events) {
      const source = event.source || "unknown";
      const current = map.get(source);

      if (!current) {
        map.set(source, {
          lastSeen: event.timestamp,
          status: event.status,
          services: new Set([event.service]),
        });
        continue;
      }

      const currentTs = Date.parse(current.lastSeen);
      const nextTs = Date.parse(event.timestamp);
      if (Number.isFinite(nextTs) && (!Number.isFinite(currentTs) || nextTs > currentTs)) {
        current.lastSeen = event.timestamp;
      }
      current.status = compareStatus(current.status, event.status);
      current.services.add(event.service);
    }

    return [...map.entries()]
      .map(([source, value]) => ({
        source,
        lastSeen: value.lastSeen,
        status: value.status,
        services: value.services.size,
      }))
      .sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen));
  }, [summary.latest]);

  const activeSessions = useMemo(
    () =>
      sessions.filter((session) => {
        const ts = Date.parse(session.lastSeen);
        return Number.isFinite(ts) && Date.now() - ts <= ACTIVE_WINDOW_MS;
      }),
    [sessions]
  );

  return (
    <div className="page-content">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold">LIVE</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Realtime active sessions (heartbeat in the last 2 minutes)
          </p>
        </div>
      </div>

      <div className="card p-8 mb-6">
        <div className="flex flex-col items-center justify-center text-center">
          <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--primary)/0.14)] text-[hsl(var(--primary))]">
            <Radio className="h-6 w-6" />
          </div>
          <p className="text-xs uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
            Active Users Now
          </p>
          <p className="mt-2 text-5xl font-extrabold font-[JetBrains_Mono,monospace] leading-none">
            {activeSessions.length}
          </p>
          <p className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">
            Last ingest: {timeAgo(summary.stats.lastIngestAt)} ({formatDate(summary.stats.lastIngestAt)})
          </p>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">Active Session List</h3>
          <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
            {activeSessions.length} active
          </span>
        </div>

        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[hsl(var(--border))]">
                <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">
                  Source
                </th>
                <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">
                  Status
                </th>
                <th className="text-right py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">
                  Services
                </th>
                <th className="text-right py-2 font-medium text-[hsl(var(--muted-foreground))]">
                  Last Seen
                </th>
              </tr>
            </thead>
            <tbody>
              {activeSessions.map((session) => (
                <tr
                  key={session.source}
                  className="border-b border-[hsl(var(--border)/0.5)] last:border-0 hover:bg-[hsl(var(--muted)/0.3)] transition-colors"
                >
                  <td className="py-2.5 pr-4 font-medium">{session.source}</td>
                  <td className="py-2.5 pr-4">
                    <StatusBadge status={session.status} />
                  </td>
                  <td className="py-2.5 pr-4 text-right font-[JetBrains_Mono,monospace]">
                    {session.services}
                  </td>
                  <td className="py-2.5 text-right text-[hsl(var(--muted-foreground))]">
                    {timeAgo(session.lastSeen)}
                  </td>
                </tr>
              ))}

              {activeSessions.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="py-8 text-center text-[hsl(var(--muted-foreground))]"
                  >
                    No active sessions in the last 2 minutes
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
