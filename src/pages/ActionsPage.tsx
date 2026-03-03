import { Activity, Clock3, KeyRound, ListChecks } from "lucide-react";
import { useMemo, useState } from "react";
import { StatCard } from "../components/StatCard";
import { TimeframeSelector } from "../components/TimeframeSelector";
import type { SummaryPayload, Timeframe } from "../types/telemetry";
import { formatNumber, timeAgo } from "../utils/format";
import { describeScope, filterEvents, isUpdateCheckEvent } from "../utils/telemetry";

interface ActionsPageProps {
  summary: SummaryPayload;
}

interface ActionRow {
  key: string;
  count: number;
  lastSeen: string;
  sources: number;
  services: number;
  sampleValue: string;
}

function toPreview(value: unknown): string {
  if (value === null || value === undefined) {
    return "—";
  }

  if (typeof value === "string") {
    return value.length > 48 ? `${value.slice(0, 48)}…` : value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "object";
}

export function ActionsPage({ summary }: ActionsPageProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>("1D");
  const [query, setQuery] = useState("");

  const filtered = useMemo(
    () => filterEvents(summary.recent, timeframe).filter((event) => !isUpdateCheckEvent(event)),
    [summary.recent, timeframe]
  );

  const actions = useMemo<ActionRow[]>(() => {
    const map = new Map<
      string,
      {
        count: number;
        lastSeen: string;
        sources: Set<string>;
        services: Set<string>;
        sampleValue: string;
      }
    >();

    for (const event of filtered) {
      for (const [rawKey, value] of Object.entries(event.metrics)) {
        const key = rawKey.trim();
        if (!key) {
          continue;
        }

        const existing = map.get(key);
        if (!existing) {
          map.set(key, {
            count: 1,
            lastSeen: event.timestamp,
            sources: new Set([event.source]),
            services: new Set([event.service]),
            sampleValue: toPreview(value),
          });
          continue;
        }

        existing.count += 1;
        existing.sources.add(event.source);
        existing.services.add(event.service);

        const currentTs = Date.parse(existing.lastSeen);
        const nextTs = Date.parse(event.timestamp);
        if (Number.isFinite(nextTs) && (!Number.isFinite(currentTs) || nextTs > currentTs)) {
          existing.lastSeen = event.timestamp;
        }

        if (existing.sampleValue === "—") {
          existing.sampleValue = toPreview(value);
        }
      }
    }

    return [...map.entries()]
      .map(([key, value]) => ({
        key,
        count: value.count,
        lastSeen: value.lastSeen,
        sources: value.sources.size,
        services: value.services.size,
        sampleValue: value.sampleValue,
      }))
      .sort((left, right) => right.count - left.count);
  }, [filtered]);

  const visibleActions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return actions;
    }

    return actions.filter(
      (action) =>
        action.key.toLowerCase().includes(q) ||
        action.sampleValue.toLowerCase().includes(q)
    );
  }, [actions, query]);

  const totalHits = useMemo(
    () => actions.reduce((sum, action) => sum + action.count, 0),
    [actions]
  );
  const mostUsed = actions[0]?.key ?? "—";
  const latestActionAt = actions[0]?.lastSeen ?? null;

  return (
    <div className="page-content">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold">Tracked Actions</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {describeScope(timeframe)} · currently active keys from telemetry metrics
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="input-group w-full sm:w-[260px]">
            <input
              type="text"
              className="input"
              placeholder="Search key or value..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <TimeframeSelector value={timeframe} onChange={setTimeframe} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Tracked Actions"
          value={String(actions.length)}
          sub="Distinct active keys"
          icon={<ListChecks className="w-5 h-5" />}
          tone="primary"
        />
        <StatCard
          label="Total Hits"
          value={formatNumber(totalHits)}
          sub="How often keys were reported"
          icon={<Activity className="w-5 h-5" />}
          tone="accent"
        />
        <StatCard
          label="Most Used Key"
          value={mostUsed}
          sub="Top tracked action"
          icon={<KeyRound className="w-5 h-5" />}
          tone="amber"
        />
        <StatCard
          label="Latest Key Activity"
          value={timeAgo(latestActionAt)}
          sub={latestActionAt ?? "No key activity"}
          icon={<Clock3 className="w-5 h-5" />}
          tone="rose"
        />
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">Active Action Keys</h3>
          <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
            Showing {visibleActions.length} of {actions.length}
          </span>
        </div>
        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[hsl(var(--border))]">
                <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">
                  Key
                </th>
                <th className="text-right py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">
                  Hits
                </th>
                <th className="text-right py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">
                  Sources
                </th>
                <th className="text-right py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">
                  Services
                </th>
                <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">
                  Sample Value
                </th>
                <th className="text-right py-2 font-medium text-[hsl(var(--muted-foreground))]">
                  Last Seen
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleActions.map((action) => (
                <tr
                  key={action.key}
                  className="border-b border-[hsl(var(--border)/0.5)] last:border-0 hover:bg-[hsl(var(--muted)/0.3)] transition-colors"
                >
                  <td className="py-2.5 pr-4 font-[JetBrains_Mono,monospace] font-medium">
                    {action.key}
                  </td>
                  <td className="py-2.5 pr-4 text-right font-[JetBrains_Mono,monospace]">
                    {formatNumber(action.count)}
                  </td>
                  <td className="py-2.5 pr-4 text-right font-[JetBrains_Mono,monospace]">
                    {action.sources}
                  </td>
                  <td className="py-2.5 pr-4 text-right font-[JetBrains_Mono,monospace]">
                    {action.services}
                  </td>
                  <td className="py-2.5 pr-4 text-[hsl(var(--muted-foreground))] max-w-[280px] truncate">
                    {action.sampleValue}
                  </td>
                  <td className="py-2.5 text-right text-[hsl(var(--muted-foreground))]">
                    {timeAgo(action.lastSeen)}
                  </td>
                </tr>
              ))}
              {visibleActions.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="py-8 text-center text-[hsl(var(--muted-foreground))]"
                  >
                    No tracked actions for this scope
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
