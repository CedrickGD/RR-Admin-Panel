import { AlertTriangle, ChevronDown, ChevronRight, Eye, EyeOff, Filter, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
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
      {/* Header */}
      <section className="page-header">
        <div>
          <h1 className="page-title">
            Errors
            <span className="kicker">Incident Feed</span>
          </h1>
          <p className="page-subtitle">Application error log — real failures only, no telemetry noise.</p>
        </div>
        <div className="page-header-right">
          <div className="meta-row">
            {[
              { label: "Errors 24h",   val: formatNumber(summary.stats.errorsLast24Hours) },
              { label: "Unique",       val: formatNumber(groups.length) },
              { label: "Total Visible", val: formatNumber(totalVisible) },
              { label: "Latest",       val: latestError ? timeAgo(latestError.timestamp) : "None" },
            ].map((m) => (
              <div className="meta-item" key={m.label}><span>{m.label}</span><strong>{m.val}</strong></div>
            ))}
          </div>
        </div>
      </section>

      {/* Error list */}
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
                placeholder="Search errors…"
                className="glass-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Filter toolbar */}
        <div className="error-filter-toolbar">
          <div className="error-filter-toolbar-left">
            <button
              className="error-filter-toggle"
              onClick={() => setShowFilterPanel((p) => !p)}
              data-active={showFilterPanel || activeFilterCount > 0 ? "" : undefined}
            >
              <Filter className="h-3.5 w-3.5" />
              <span>Filters</span>
              {activeFilterCount > 0 && (
                <span className="error-filter-count">{activeFilterCount}</span>
              )}
            </button>
            {activeFilterCount > 0 && (
              <button className="error-filter-clear" onClick={clearFilters}>
                <X className="h-3 w-3" />
                Clear all
              </button>
            )}
          </div>
          {activeFilterCount > 0 && (
            <p className="error-filter-summary">
              Hiding {summary.recentErrors.length - totalVisible} of {summary.recentErrors.length} errors
            </p>
          )}
        </div>

        {/* Expandable filter panel */}
        {showFilterPanel && (
          <div className="error-filter-panel">
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
                      {hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
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
                      {hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
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
        <div className="panel-body-flush">
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
                        {isOpen
                          ? <ChevronDown className="h-3.5 w-3.5" />
                          : <ChevronRight className="h-3.5 w-3.5" />}
                      </div>
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--danger)" }} />
                      <div className="error-group-info">
                        <span className="error-group-type mono">{group.type}</span>
                        <span className="error-group-msg">{group.message}</span>
                      </div>
                      <div className="error-group-meta">
                        <span className={`badge ${group.kind === "unhandled" ? "badge-danger" : group.kind === "background" ? "badge-warning" : "badge-muted"}`}>
                          {kindLabel(group.kind)}
                        </span>
                        {group.count > 1 && (
                          <span className="error-group-count">{group.count}x</span>
                        )}
                        <span className="error-group-time muted" title={formatDate(group.latest.timestamp)}>
                          {timeAgo(group.latest.timestamp)}
                        </span>
                      </div>
                    </button>

                    {/* Expanded detail */}
                    {isOpen && (
                      <div className="error-group-detail">
                        <div className="error-group-detail-header">
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <span className="badge badge-muted">{group.source}</span>
                            {group.code && <span className="badge badge-muted">{group.code}</span>}
                            <span className="muted" style={{ fontSize: "0.75rem" }}>
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
                                  <span className="mono muted" style={{ fontSize: "0.6875rem" }}>{formatDate(e.timestamp)}</span>
                                  <span className="muted" style={{ fontSize: "0.75rem" }}>{timeAgo(e.timestamp)}</span>
                                  <span className="badge badge-muted" style={{ fontSize: "0.625rem" }}>{e.source}</span>
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
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon"><AlertTriangle className="h-5 w-5" /></div>
              <strong>{query || activeFilterCount > 0 ? "No errors match your filters." : "No errors recorded."}</strong>
              <p>
                {query || activeFilterCount > 0
                  ? "Try adjusting your search or filter settings."
                  : "The system is clean."}
              </p>
              {activeFilterCount > 0 && (
                <button className="error-filter-clear" onClick={clearFilters} style={{ marginTop: 8 }}>
                  <X className="h-3 w-3" /> Clear filters
                </button>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
