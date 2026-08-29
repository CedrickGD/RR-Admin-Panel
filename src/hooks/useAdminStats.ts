import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StatsFilters, StatsPayload, UserRollupRecord } from "../types/telemetry";
import { fetchAdminStats, fetchAdminUsers } from "../utils/api";
import { useRefreshSignal } from "../utils/refreshBus";

const STATS_REFRESH_MS = 60_000;

type VisibilityRefreshTarget = EventTarget & {
  readonly visibilityState: DocumentVisibilityState;
};

export function subscribeToVisibleRefresh(
  refresh: () => void,
  target: VisibilityRefreshTarget = document,
): () => void {
  const handleVisibilityChange = () => {
    if (target.visibilityState === "visible") refresh();
  };
  target.addEventListener("visibilitychange", handleVisibilityChange);
  return () => target.removeEventListener("visibilitychange", handleVisibilityChange);
}

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
export interface AdminStatsNeeds {
  stats: boolean;
  users: boolean;
  userScope: "all" | "filtered";
}

export function resolveUserRollupFilters(
  filters: StatsFilters,
  scope: AdminStatsNeeds["userScope"],
): StatsFilters {
  return scope === "filtered"
    ? { ...filters, range: "all" }
    : { range: "all", version: null, platform: null, country: null };
}

export function useAdminStats(needs: AdminStatsNeeds, filters: StatsFilters) {
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [users, setUsers] = useState<UserRollupRecord[] | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const statsRequestSeq = useRef(0);
  const usersRequestSeq = useRef(0);
  const hasStats = useRef(false);

  // The users rollup is all-time. Range affects stats only, so changing 7d ->
  // 30d must not trigger another full-history users query and payload. Access
  // and Heatmap always receive every user because their own controls cannot
  // reveal or clear a global dimension filter retained from another page.
  const userFilters = useMemo<StatsFilters>(
    () => resolveUserRollupFilters(filters, needs.userScope),
    [filters.version, filters.platform, filters.country, needs.userScope],
  );

  const loadStats = useCallback(
    async (silent: boolean) => {
      const seq = ++statsRequestSeq.current;
      if (!silent) setStatsLoading(true);

      try {
        const statsRes = await fetchAdminStats(filters);
        if (seq !== statsRequestSeq.current) return;

        if (statsRes.ok && statsRes.stats) {
          hasStats.current = true;
          setStats(statsRes.stats);
          setError(null);
        } else if (!silent && !hasStats.current) {
          // Only surface the failure state when there's nothing on screen —
          // with data visible, the next background refresh self-heals quietly.
          setError("Failed to load stats.");
        }
      } catch {
        if (seq === statsRequestSeq.current && !silent && !hasStats.current) {
          setError("Failed to load stats.");
        }
      } finally {
        if (seq === statsRequestSeq.current) setStatsLoading(false);
      }
    },
    [filters],
  );

  const loadUsers = useCallback(
    async (silent: boolean) => {
      const seq = ++usersRequestSeq.current;
      if (!silent) setUsersLoading(true);
      try {
        const usersRes = await fetchAdminUsers(userFilters);
        if (seq === usersRequestSeq.current && usersRes.ok && usersRes.users) {
          setUsers(usersRes.users);
        }
      } catch {
        // Keep the last good rollup; the next visible refresh self-heals.
      } finally {
        if (seq === usersRequestSeq.current) setUsersLoading(false);
      }
    },
    [userFilters],
  );

  useEffect(() => {
    if (!needs.stats) return;

    void loadStats(false);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadStats(true);
    }, STATS_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [needs.stats, loadStats]);

  useEffect(() => {
    if (!needs.users) return;

    void loadUsers(false);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadUsers(true);
    }, STATS_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [needs.users, loadUsers]);

  // Interval callbacks are intentionally skipped while hidden. Refresh once as
  // soon as the tab returns so the page never waits up to another full minute.
  useEffect(() => {
    if (!needs.stats && !needs.users) return;
    return subscribeToVisibleRefresh(() => {
      if (needs.stats) void loadStats(true);
      if (needs.users) void loadUsers(true);
    });
  }, [needs.stats, needs.users, loadStats, loadUsers]);

  // Header refresh button: silent re-pull so visible data never blinks away.
  useRefreshSignal(() => {
    if (needs.stats) void loadStats(true);
    if (needs.users) void loadUsers(true);
  });

  const refresh = () => {
    if (needs.stats) void loadStats(false);
    if (needs.users) void loadUsers(false);
  };

  return {
    stats,
    users,
    loading: statsLoading || usersLoading,
    error,
    refresh,
  } as const;
}
