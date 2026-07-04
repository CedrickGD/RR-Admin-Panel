import { useCallback, useEffect, useRef, useState } from "react";
import type { StatsFilters, StatsPayload, UserRollupRecord } from "../types/telemetry";
import { fetchAdminStats, fetchAdminUsers } from "../utils/api";

const STATS_REFRESH_MS = 60_000;

export const DEFAULT_STATS_FILTERS: StatsFilters = {
  range: "30d",
  version: null,
  platform: null,
  country: null,
};

/**
 * Server-side aggregates over the FULL session history (not the 200-row summary
 * window) plus the per-user rollup list. Refetches whenever filters change and
 * every minute in the background.
 */
export function useAdminStats(enabled: boolean, filters: StatsFilters) {
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [users, setUsers] = useState<UserRollupRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);
  const hasStats = useRef(false);

  const load = useCallback(
    async (silent: boolean) => {
      const seq = ++requestSeq.current;
      if (!silent) {
        setLoading(true);
      }

      try {
        const [statsRes, usersRes] = await Promise.all([fetchAdminStats(filters), fetchAdminUsers(filters)]);
        if (seq !== requestSeq.current) {
          return;
        }

        if (statsRes.ok && statsRes.stats) {
          hasStats.current = true;
          setStats(statsRes.stats);
          setError(null);
        } else if (!silent && !hasStats.current) {
          // Only surface the failure state when there's nothing on screen —
          // with data visible, the next background refresh self-heals quietly.
          setError("Failed to load stats.");
        }

        if (usersRes.ok && usersRes.users) {
          setUsers(usersRes.users);
        }
      } catch {
        if (seq === requestSeq.current && !silent && !hasStats.current) {
          setError("Failed to load stats.");
        }
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false);
        }
      }
    },
    [filters]
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void load(false);
    const id = window.setInterval(() => void load(true), STATS_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [enabled, load]);

  return { stats, users, loading, error, refresh: () => void load(false) } as const;
}
