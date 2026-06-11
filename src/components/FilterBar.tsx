import { FilterX } from "lucide-react";
import { useMemo } from "react";
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
 * Global KPI filter bar: time range plus version / platform / country dimensions.
 * Rendered in the page header's right slot (DS filter pattern: .filter-bar-right
 * wrapping the segmented range control, then the dimension dropdowns).
 * Options are sourced from the unfiltered option lists so a selected filter
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
    <div className="filter-bar-right">
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
        placeholder="All platforms"
        options={platformOptions}
        value={filters.platform}
        onChange={(platform) => onChange({ ...filters, platform })}
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
  );
}

function dedupeSorted(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true })
  );
}
