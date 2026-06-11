import { Activity, AlertTriangle, ChevronDown, ChevronRight, Eye, EyeOff, Filter, SearchX, Timer, X } from "lucide-react";
import { useMemo, useState } from "react";
import { CollapsiblePanel } from "../components/CollapsiblePanel";
import { KpiStatCard } from "../components/KpiStatCard";
import { Badge } from "../components/ds/Badge";
import { Button } from "../components/ds/Button";
import { EmptyState } from "../components/ds/EmptyState";
import { MetaRow, PageHeader } from "../components/ds/PageHeader";
import { SearchInput } from "../components/ds/SearchInput";
import { Tag } from "../components/ds/Tag";
import type { SummaryPayload, TelemetryEvent } from "../types/telemetry";
import { formatDate, formatNumber, timeAgo } from "../utils/format";

interface LogsPageProps {
  summary: SummaryPayload;
}

/* ── helpers ─────────────────────────────────────────────────── */

const KIND_LABELS: Record<string, string> = {
  background:  "Background Task",
  unhandled:   "Unhandled",
};

const DEFAULT_HIDDEN_KINDS = new Set(["background"]);

function kindLabel(kind: string) {
  return KIND_LABELS[kind] ?? kind;
}

/** Group key: same exception_type + message = same error */
function errorKey(e: TelemetryEvent) {
  return `${e.metrics["exception_type"] ?? "unknown"}::${e.message ?? ""}`;
}

interface GroupedError {
  key: string;
  type: string;
  kind: string;
  code: string;
  source: string;
  message: string;
  count: number;
  latest: TelemetryEvent;
  all: TelemetryEvent[];
}

/* ── component ───────────────────────────────────────────────── */

export function LogsPage({ summary }: LogsPageProps) {
  const [query, setQuery] = useState("");
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(() => new Set(DEFAULT_HIDDEN_KINDS));
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  /* ── derive unique facets from all errors ────────────────── */
  const facets = useMemo(() => {
    const kinds = new Map<string, number>();
    const types = new Map<string, number>();
    for (const e of summary.recentErrors) {
      const kind = String(e.metrics["error_kind"] ?? "unknown");
      const type = String(e.metrics["exception_type"] ?? "unknown");
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
      types.set(type, (types.get(type) ?? 0) + 1);
    }
    return {
      kinds: [...kinds.entries()].sort((a, b) => b[1] - a[1]),
      types: [...types.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [summary.recentErrors]);

  /* ── filtered + grouped errors ───────────────────────────── */
  const groups = useMemo(() => {
    const filtered = summary.recentErrors.filter((e) => {
      const kind = String(e.metrics["error_kind"] ?? "unknown");
      const type = String(e.metrics["exception_type"] ?? "unknown");
      if (hiddenKinds.has(kind)) return false;
      if (hiddenTypes.has(type)) return false;
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        const hay = [e.source, e.service, e.message ?? "", JSON.stringify(e.metrics)].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const map = new Map<string, GroupedError>();
    for (const e of filtered) {
      const k = errorKey(e);
      const existing = map.get(k);
      if (existing) {
        existing.count++;
        existing.all.push(e);
      } else {
        map.set(k, {
          key: k,
          type: String(e.metrics["exception_type"] ?? "—"),
          kind: String(e.metrics["error_kind"] ?? "—"),
          code: String(e.metrics["error_code"] ?? ""),
          source: e.source,
          message: e.message ?? "No message",
          count: 1,
          latest: e,
          all: [e],
        });
      }
    }
    return [...map.values()];
  }, [query, summary.recentErrors, hiddenKinds, hiddenTypes]);

  const totalVisible = groups.reduce((s, g) => s + g.count, 0);
  const activeFilterCount = hiddenKinds.size + hiddenTypes.size;
  const latestError = groups[0]?.latest;

  /* ── toggle helpers ──────────────────────────────────────── */
  function toggleKind(kind: string) {
    setHiddenKinds((prev) => {
      const next = new Set(prev);
      next.has(kind) ? next.delete(kind) : next.add(kind);
      return next;
    });
  }
  function toggleType(type: string) {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
  }
  function clearFilters() {
    setHiddenKinds(new Set());
    setHiddenTypes(new Set());
  }
  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  return (
    <div className="page-content page-stack-lg">
      <PageHeader
        kicker="Failures"
        title="Errors"
        sub="Application error log — real failures only, no telemetry noise."
        right={
          <MetaRow
            items={[
              { label: "Retained", value: formatNumber(summary.recentErrors.length) },
              { label: "Storage", value: summary.storage.toUpperCase() },
            ]}
          />
        }
      />

      {/* KPIs */}
      <div className="stat-grid stat-grid-3 v2-stagger">
        <KpiStatCard
          label="Errors 24 h"
          value={formatNumber(summary.stats.errorsLast24Hours)}
          sub="Real failures only · noise filtered at ingest"
          tone={summary.stats.errorsLast24Hours > 0 ? "danger" : "primary"}
          icon={<AlertTriangle size={14} />}
        />
        <KpiStatCard
          label="Unique Failures"
          value={formatNumber(groups.length)}
          sub={`${formatNumber(totalVisible)} in view · ${formatNumber(summary.recentErrors.length)} retained`}
          icon={<Activity size={14} />}
        />
        <KpiStatCard
          label="Last Failure"
          value={latestError ? timeAgo(latestError.timestamp) : "None"}
          sub={latestError ? groups[0]?.type ?? "—" : "No failures in view"}
          tone={latestError ? "warning" : "primary"}
          icon={<Timer size={14} />}
        />
      </div>

      {/* Grouped failures */}
      <CollapsiblePanel
        kicker="Grouped"
        title="Recent Failures"
        sub="Real application failures only — heartbeats and noise are filtered at ingest."
        padding="flush"
        right={
          <>
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search errors…"
              style={{ width: "min(240px, 60vw)" }}
            />
            <Button
              size="sm"
              icon={<Filter />}
              className={showFilterPanel || activeFilterCount > 0 ? "is-active" : ""}
              onClick={() => setShowFilterPanel((p) => !p)}
            >
              Filters
              {activeFilterCount > 0 ? <Badge tone="accent">{activeFilterCount}</Badge> : null}
            </Button>
            {activeFilterCount > 0 ? (
              <Button size="sm" icon={<X />} onClick={clearFilters}>
                Clear All
              </Button>
            ) : null}
          </>
        }
      >
        {/* Expandable filter panel */}
        {showFilterPanel && (
          <div className="error-filter-panel">
            {activeFilterCount > 0 && (
              <p className="error-filter-summary">
                Hiding {summary.recentErrors.length - totalVisible} of {summary.recentErrors.length} errors
              </p>
            )}
            <div className="error-filter-section">
              <p className="label-sm" style={{ marginBottom: 6 }}>Error Kind</p>
              <div className="error-filter-chips">
                {facets.kinds.map(([kind, count]) => {
                  const hidden = hiddenKinds.has(kind);
                  return (
                    <button
                      key={kind}
                      className={`error-filter-chip ${hidden ? "excluded" : "included"}`}
                      onClick={() => toggleKind(kind)}
                      title={hidden ? `Show "${kindLabel(kind)}" errors` : `Hide "${kindLabel(kind)}" errors`}
                    >
                      {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                      <span>{kindLabel(kind)}</span>
                      <span className="error-filter-chip-count">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="error-filter-section">
              <p className="label-sm" style={{ marginBottom: 6 }}>Exception Type</p>
              <div className="error-filter-chips">
                {facets.types.map(([type, count]) => {
                  const hidden = hiddenTypes.has(type);
                  return (
                    <button
                      key={type}
                      className={`error-filter-chip ${hidden ? "excluded" : "included"}`}
                      onClick={() => toggleType(type)}
                      title={hidden ? `Show "${type}" errors` : `Hide "${type}" errors`}
                    >
                      {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                      <span className="mono">{type}</span>
                      <span className="error-filter-chip-count">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Grouped error rows */}
        {groups.length > 0 ? (
          <div className="error-group-list">
            {groups.map((group) => {
              const isOpen = expanded.has(group.key);
              return (
                <div key={group.key} className={`error-group${isOpen ? " is-open" : ""}`}>
                  {/* Summary row */}
                  <button
                    type="button"
                    className="error-group-row"
                    onClick={() => toggleExpand(group.key)}
                  >
                    <div className="error-group-chevron">
                      {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </div>
                    <AlertTriangle size={14} style={{ flexShrink: 0, color: "var(--danger)" }} />
                    <div className="error-group-info">
                      <span className="error-group-type mono">{group.type}</span>
                      <span className="error-group-msg">{group.message}</span>
                    </div>
                    <div className="error-group-meta">
                      <Badge tone={group.kind === "unhandled" ? "danger" : group.kind === "background" ? "warning" : "muted"}>
                        {kindLabel(group.kind)}
                      </Badge>
                      <Badge tone="warning" title={`${group.count} occurrence${group.count !== 1 ? "s" : ""}`}>
                        {group.count}×
                      </Badge>
                      <span className="error-group-time muted-text" title={formatDate(group.latest.timestamp)}>
                        {timeAgo(group.latest.timestamp)}
                      </span>
                    </div>
                  </button>

                  {/* Expanded detail */}
                  {isOpen && (
                    <div className="error-group-detail">
                      <div className="error-group-detail-header">
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                          <Tag>{group.source}</Tag>
                          {group.code && <Tag>{group.code}</Tag>}
                          <span className="muted-text" style={{ fontSize: "0.75rem" }}>
                            {group.count} occurrence{group.count !== 1 ? "s" : ""}
                          </span>
                        </div>
                      </div>

                      {/* Latest occurrence metrics */}
                      {Object.keys(group.latest.metrics).length > 0 && (
                        <div style={{ marginTop: 10 }}>
                          <p className="label-sm" style={{ marginBottom: 6 }}>Latest Metrics</p>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {Object.entries(group.latest.metrics).map(([k, v]) => (
                              <span key={k} className="error-metric-tag">
                                {k}: {String(v)}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Occurrence timeline (if more than 1) */}
                      {group.count > 1 && (
                        <div style={{ marginTop: 12 }}>
                          <p className="label-sm" style={{ marginBottom: 6 }}>Occurrences</p>
                          <div className="error-occurrence-list">
                            {group.all.map((e) => (
                              <div key={e.id} className="error-occurrence-item">
                                <span className="mono muted-text" style={{ fontSize: "0.6875rem" }}>{formatDate(e.timestamp)}</span>
                                <span className="muted-text" style={{ fontSize: "0.75rem" }}>{timeAgo(e.timestamp)}</span>
                                <Tag>{e.source}</Tag>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : query || activeFilterCount > 0 ? (
          <>
            <EmptyState icon={<SearchX />} title="No Matches">
              No errors match the active search or filters.
            </EmptyState>
            {activeFilterCount > 0 && (
              <div style={{ display: "flex", justifyContent: "center", padding: "0 0 18px" }}>
                <Button size="sm" icon={<X />} onClick={clearFilters}>
                  Clear Filters
                </Button>
              </div>
            )}
          </>
        ) : (
          <EmptyState allClear>
            No failures in the selected range. New errors surface here within seconds of ingest.
          </EmptyState>
        )}
      </CollapsiblePanel>
    </div>
  );
}
