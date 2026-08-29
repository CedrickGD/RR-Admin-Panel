import { FilterX, ListFilter } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { StatsFilters, StatsPayload, StatsRange } from "../types/telemetry";
import { GlassDropdown } from "./GlassDropdown";

const RANGES: Array<{ key: StatsRange; label: string }> = [
  // "today" is a rolling last-24-hours window server-side, so label it honestly.
  { key: "today", label: "24 h" },
  { key: "7d", label: "7 d" },
  { key: "30d", label: "30 d" },
  { key: "90d", label: "90 d" },
  { key: "all", label: "All" },
];

interface FilterBarProps {
  filters: StatsFilters;
  stats: StatsPayload | null;
  onChange: (next: StatsFilters) => void;
}

/**
 * Global KPI filters, compact presentation: a single pill in the page header's
 * right slot showing the active range (plus a count badge when dimension
 * filters are set). Clicking it opens a popover with the full controls —
 * range seg-control, the version / country dropdowns, and Clear. Platform is
 * intentionally omitted because every supported client is Windows.
 * Options are sourced from the unfiltered option lists so a selected filter
 * never hides its own alternatives.
 */
export function FilterBar({ filters, stats, onChange }: FilterBarProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const versionOptions = useMemo(() => {
    const fromStats =
      stats?.options?.versions ?? stats?.breakdowns.versionsAllTime.map((v) => v.version) ?? [];
    return dedupeSorted([...fromStats, ...(filters.version ? [filters.version] : [])]);
  }, [stats, filters.version]);

  const countryOptions = useMemo(() => {
    const fromStats =
      stats?.options?.countries ?? stats?.breakdowns.countries.map((c) => c.key) ?? [];
    return dedupeSorted([...fromStats, ...(filters.country ? [filters.country] : [])]);
  }, [stats, filters.country]);

  const hasDimensionFilter = Boolean(filters.version || filters.country);
  const dimensionCount = [filters.version, filters.country].filter(Boolean).length;
  const rangeLabel = RANGES.find((range) => range.key === filters.range)?.label ?? filters.range;

  // Outside pointer-down + Escape dismissal — same pattern as GlassDropdown.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // If a GlassDropdown menu inside the popover is open, this Escape press
      // belongs to it (its own listener closes it). React flushes the DOM
      // after the dispatch, so the menu node is still present here.
      if (rootRef.current?.querySelector(".gdrop-menu")) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="filter-bar-right" ref={rootRef}>
      <button
        type="button"
        className={`filter-pill${hasDimensionFilter ? " filter-pill-active" : ""}`}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="true"
        title="Filters"
      >
        <ListFilter size={14} />
        <span className="filter-pill-label">{rangeLabel}</span>
        {dimensionCount > 0 ? (
          <>
            <span className="filter-pill-sep" aria-hidden="true">
              ·
            </span>
            <span className="filter-pill-count">{dimensionCount}</span>
          </>
        ) : null}
      </button>

      {open ? (
        <div className="filter-pop">
          <div className="seg-control">
            {RANGES.map((range) => (
              <button
                key={range.key}
                type="button"
                className={`seg-btn${filters.range === range.key ? " active" : ""}`}
                onClick={() => onChange({ ...filters, range: range.key })}
              >
                {range.label}
              </button>
            ))}
          </div>
          <GlassDropdown
            placeholder="All versions"
            options={versionOptions}
            value={filters.version}
            onChange={(version) => onChange({ ...filters, version })}
            renderOption={(option) => (option === "legacy" ? "Legacy (pre-1.4)" : option)}
          />
          <GlassDropdown
            placeholder="All countries"
            options={countryOptions}
            value={filters.country}
            onChange={(country) => onChange({ ...filters, country })}
          />
          {hasDimensionFilter ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              title="Clear filters"
              onClick={() => onChange({ ...filters, version: null, platform: null, country: null })}
            >
              <FilterX size={14} />
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function dedupeSorted(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true }),
  );
}
