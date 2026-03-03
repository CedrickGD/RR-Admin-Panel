import { Radio } from "lucide-react";
import { useMemo } from "react";
import { StatusBadge } from "../components/StatusBadge";
import type { SummaryPayload, TelemetryEvent, TelemetryStatus } from "../types/telemetry";
import { formatDate, timeAgo } from "../utils/format";

const ACTIVE_WINDOW_MS = 2 * 60 * 1000;
const FUTURE_SKEW_MS = 15 * 1000;

interface LivePageProps {
  summary: SummaryPayload;
}

interface LiveSession {
  key: string;
  installId: string | null;
  ip: string | null;
  source: string;
  service: string;
  status: TelemetryStatus;
  lastSeen: string;
}

function metricText(metrics: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = metrics[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return null;
}

function sessionKey(event: TelemetryEvent): string {
  const installId = metricText(event.metrics, ["install_id", "installId"]);
  if (installId) {
    return `install:${installId}`;
  }

  const ip = metricText(event.metrics, ["client_ip", "ip"]);
  const source = event.source || "unknown";
  if (ip) {
    return `source:${source}|ip:${ip}`;
  }

  return `source:${source}|service:${event.service}`;
}

function newerTimestamp(leftIso: string, rightIso: string): boolean {
  const left = Date.parse(leftIso);
  const right = Date.parse(rightIso);
  if (!Number.isFinite(left)) {
    return Number.isFinite(right);
  }
  if (!Number.isFinite(right)) {
    return false;
  }
  return right > left;
}

export function LivePage({ summary }: LivePageProps) {
  const sessions = useMemo<LiveSession[]>(() => {
    const map = new Map<string, LiveSession>();

    for (const event of summary.recent) {
      const key = sessionKey(event);
      const installId = metricText(event.metrics, ["install_id", "installId"]);
      const ip = metricText(event.metrics, ["client_ip", "ip"]);
      const source = event.source || "unknown";
      const seenAt = event.receivedAt || event.timestamp;
      const existing = map.get(key);

      if (!existing) {
        map.set(key, {
          key,
          installId,
          ip,
          source,
          service: event.service,
          status: event.status,
          lastSeen: seenAt,
        });
        continue;
      }

      if (newerTimestamp(existing.lastSeen, seenAt)) {
        existing.lastSeen = seenAt;
        existing.service = event.service;
        existing.status = event.status;
      }

      if (!existing.installId && installId) {
        existing.installId = installId;
      }

      if (!existing.ip && ip) {
        existing.ip = ip;
      }
    }

    return [...map.values()].sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen));
  }, [summary.recent]);

  const activeSessions = useMemo(() => {
    const now = Date.now();
    return sessions.filter((session) => {
      const ts = Date.parse(session.lastSeen);
      if (!Number.isFinite(ts)) {
        return false;
      }

      if (ts > now + FUTURE_SKEW_MS) {
        return false;
      }

      if (session.service === "app_stop") {
        return false;
      }

      return now - ts <= ACTIVE_WINDOW_MS;
    });
  }, [sessions]);

  return (
    <div className="page-content">
      <div className="mb-6">
        <h1 className="text-xl font-bold">LIVE</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Active users = last event received by backend within 2 minutes
        </p>
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
          <h3 className="text-sm font-semibold">Active Users</h3>
          <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
            {activeSessions.length} connected
          </span>
        </div>

        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[hsl(var(--border))]">
                <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">
                  User
                </th>
                <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">
                  IP
                </th>
                <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">
                  Source
                </th>
                <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">
                  Status
                </th>
                <th className="text-right py-2 font-medium text-[hsl(var(--muted-foreground))]">
                  Last Seen
                </th>
              </tr>
            </thead>
            <tbody>
              {activeSessions.map((session) => (
                <tr
                  key={session.key}
                  className="border-b border-[hsl(var(--border)/0.5)] last:border-0 hover:bg-[hsl(var(--muted)/0.3)] transition-colors"
                >
                  <td className="py-2.5 pr-4 font-[JetBrains_Mono,monospace]">
                    {session.installId ?? "unknown"}
                  </td>
                  <td className="py-2.5 pr-4 font-[JetBrains_Mono,monospace]">
                    {session.ip ?? "unknown"}
                  </td>
                  <td className="py-2.5 pr-4">{session.source}</td>
                  <td className="py-2.5 pr-4">
                    <StatusBadge status={session.status} />
                  </td>
                  <td className="py-2.5 text-right text-[hsl(var(--muted-foreground))]">
                    {timeAgo(session.lastSeen)}
                  </td>
                </tr>
              ))}

              {activeSessions.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="py-8 text-center text-[hsl(var(--muted-foreground))]"
                  >
                    No active users in the last 2 minutes
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
