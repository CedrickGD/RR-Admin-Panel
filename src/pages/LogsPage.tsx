import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Search, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { StatusBadge } from "../components/StatusBadge";
import { TimeframeSelector } from "../components/TimeframeSelector";
import type { SummaryPayload, TelemetryEvent, TelemetryStatus, Timeframe } from "../types/telemetry";
import { formatUtc, timeAgo } from "../utils/format";
import { describeScope, filterEvents } from "../utils/telemetry";

interface LogsPageProps {
  summary: SummaryPayload;
}

const STATUS_ICON: Record<TelemetryStatus, typeof CheckCircle2> = {
  ok: CheckCircle2,
  degraded: AlertCircle,
  down: XCircle,
};

export function LogsPage({ summary }: LogsPageProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>("1M");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TelemetryStatus | "all">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const perPage = 25;

  const filtered = useMemo(() => {
    let events = filterEvents(summary.recent, timeframe);
    if (statusFilter !== "all") {
      events = events.filter((e) => e.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      events = events.filter(
        (e) =>
          e.source.toLowerCase().includes(q) ||
          e.service.toLowerCase().includes(q) ||
          (e.message ?? "").toLowerCase().includes(q) ||
          JSON.stringify(e.metrics).toLowerCase().includes(q)
      );
    }
    return events;
  }, [summary.recent, timeframe, statusFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const currentPage = Math.min(page, totalPages - 1);
  const visible = filtered.slice(currentPage * perPage, (currentPage + 1) * perPage);

  const toggleExpand = (id: string) =>
    setExpanded((prev) => (prev === id ? null : id));

  return (
    <div className="page-content">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold">Logs</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {describeScope(timeframe)} &middot; {filtered.length} event
            {filtered.length !== 1 ? "s" : ""}
          </p>
        </div>
        <TimeframeSelector value={timeframe} onChange={setTimeframe} />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="input-group flex-1 max-w-md">
          <Search className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
          <input
            type="text"
            placeholder="Search events..."
            className="input"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <div className="flex gap-2">
          {(["all", "ok", "degraded", "down"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                statusFilter === s
                  ? "bg-[hsl(var(--primary))] text-white"
                  : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted)/0.8)]"
              }`}
              onClick={() => {
                setStatusFilter(s);
                setPage(0);
              }}
            >
              {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Log list */}
      <div className="card divide-y divide-[hsl(var(--border)/0.5)]">
        {visible.map((evt) => {
          const Icon = STATUS_ICON[evt.status] ?? AlertCircle;
          const isOpen = expanded === evt.id;
          return (
            <div
              key={evt.id}
              className="transition-colors hover:bg-[hsl(var(--muted)/0.15)]"
            >
              <button
                type="button"
                className="w-full flex items-center gap-3 px-5 py-3 text-left"
                onClick={() => toggleExpand(evt.id)}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 ${
                    evt.status === "ok"
                      ? "text-emerald-500"
                      : evt.status === "degraded"
                      ? "text-amber-400"
                      : "text-rose-400"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold">{evt.source}</span>
                    <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                      {evt.service}
                    </span>
                    <StatusBadge status={evt.status} showDot={false} />
                  </div>
                  {evt.message ? (
                    <p className="text-xs text-[hsl(var(--muted-foreground))] truncate mt-0.5">
                      {evt.message}
                    </p>
                  ) : null}
                </div>
                <span className="text-[11px] text-[hsl(var(--muted-foreground))] shrink-0 ml-2">
                  {timeAgo(evt.timestamp)}
                </span>
                {isOpen ? (
                  <ChevronUp className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
                )}
              </button>
              {isOpen ? (
                <div className="px-5 pb-4 animate-fade-in">
                  <div className="bg-[hsl(var(--muted)/0.3)] rounded-lg p-4 text-xs space-y-2">
                    <Row label="ID" value={evt.id} />
                    <Row label="Source" value={evt.source} />
                    <Row label="Service" value={evt.service} />
                    <Row label="Status" value={evt.status} />
                    <Row label="Timestamp" value={formatUtc(evt.timestamp)} />
                    <Row label="Received" value={formatUtc(evt.receivedAt)} />
                    {evt.message ? (
                      <Row label="Message" value={evt.message} />
                    ) : null}
                    <div>
                      <span className="text-[hsl(var(--muted-foreground))] font-medium">
                        Metrics:
                      </span>
                      <pre className="mt-1 p-2 rounded bg-[hsl(var(--background))] overflow-x-auto font-[JetBrains_Mono,monospace] text-[11px] leading-relaxed">
                        {JSON.stringify(evt.metrics, null, 2)}
                      </pre>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
        {visible.length === 0 ? (
          <div className="py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">
            No events match your filters
          </div>
        ) : null}
      </div>

      {/* Pagination */}
      {totalPages > 1 ? (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button
            type="button"
            className="btn-ghost text-xs"
            disabled={currentPage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </button>
          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            Page {currentPage + 1} of {totalPages}
          </span>
          <button
            type="button"
            className="btn-ghost text-xs"
            disabled={currentPage >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="text-[hsl(var(--muted-foreground))] font-medium w-20 shrink-0">
        {label}:
      </span>
      <span className="font-[JetBrains_Mono,monospace] break-all">{value}</span>
    </div>
  );
}
