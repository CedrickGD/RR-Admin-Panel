import { FilterX, SlidersHorizontal } from "lucide-react";
import { useMemo } from "react";
import type { StatsFilters, StatsPayload, StatsRange } from "../types/telemetry";

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
 * Global KPI filter bar: time range plus version / platform / country dimensions.
 * Options are sourced from the unfiltered breakdown lists so a selected filter
 * never hides its own alternatives.
 */
export function FilterBar({ filters, stats, onChange }: FilterBarProps) {
  const versionOptions = useMemo(() => {
    const fromStats = stats?.options?.versions ?? stats?.breakdowns.versionsAllTime.map((v) => v.version) ?? [];
    return dedupeSorted([...fromStats, ...(filters.version ? [filters.version] : [])]);
  }, [stats, filters.version]);

  const platformOptions = useMemo(() => {
    const fromStats = stats?.options?.platforms ?? stats?.breakdowns.platforms.map((p) => p.key) ?? [];
    return dedupeSorted([...fromStats, ...(filters.platform ? [filters.platform] : [])]);
  }, [stats, filters.platform]);

  const countryOptions = useMemo(() => {
    const fromStats = stats?.options?.countries ?? stats?.breakdowns.countries.map((c) => c.key) ?? [];
    return dedupeSorted([...fromStats, ...(filters.country ? [filters.country] : [])]);
  }, [stats, filters.country]);

  const hasDimensionFilter = Boolean(filters.version || filters.platform || filters.country);

  return (
    <div className="filter-bar">
      <div className="filter-bar-left">
        <span className="filter-bar-icon">
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </span>
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
      </div>
      <div className="filter-bar-right">
        <select
          className="glass-select"
          value={filters.version ?? ""}
          onChange={(event) => onChange({ ...filters, version: event.target.value || null })}
        >
          <option value="">All versions</option>
          {versionOptions.map((version) => (
            <option key={version} value={version}>
              {version}
            </option>
          ))}
        </select>
        <select
          className="glass-select"
          value={filters.platform ?? ""}
          onChange={(event) => onChange({ ...filters, platform: event.target.value || null })}
        >
          <option value="">All platforms</option>
          {platformOptions.map((platform) => (
            <option key={platform} value={platform}>
              {platform}
            </option>
          ))}
        </select>
        <select
          className="glass-select"
          value={filters.country ?? ""}
          onChange={(event) => onChange({ ...filters, country: event.target.value || null })}
        >
          <option value="">All countries</option>
          {countryOptions.map((country) => (
            <option key={country} value={country}>
              {country}
            </option>
          ))}
        </select>
        {hasDimensionFilter ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            title="Clear filters"
            onClick={() => onChange({ ...filters, version: null, platform: null, country: null })}
          >
            <FilterX className="h-3.5 w-3.5" />
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

function dedupeSorted(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true })
  );
}
