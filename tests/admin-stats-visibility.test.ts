import { describe, expect, it, vi } from "vitest";

import { resolveUserRollupFilters, subscribeToVisibleRefresh } from "../src/hooks/useAdminStats";

describe("admin stats visibility refresh", () => {
  it("never carries hidden global dimensions into all-user pages", () => {
    const filtered = {
      range: "30d" as const,
      version: "1.4.9",
      platform: "winui",
      country: "DE",
    };

    expect(resolveUserRollupFilters(filtered, "filtered")).toEqual({
      ...filtered,
      range: "all",
    });
    expect(resolveUserRollupFilters(filtered, "all")).toEqual({
      range: "all",
      version: null,
      platform: null,
      country: null,
    });
  });

  it("refreshes immediately when a hidden tab becomes visible and cleans up", () => {
    let visibilityState: DocumentVisibilityState = "hidden";
    const target = new EventTarget() as EventTarget & {
      readonly visibilityState: DocumentVisibilityState;
    };
    Object.defineProperty(target, "visibilityState", {
      get: () => visibilityState,
    });
    const refreshStats = vi.fn();
    const refreshUsers = vi.fn();
    const unsubscribe = subscribeToVisibleRefresh(() => {
      refreshStats();
      refreshUsers();
    }, target);

    target.dispatchEvent(new Event("visibilitychange"));
    expect(refreshStats).not.toHaveBeenCalled();
    expect(refreshUsers).not.toHaveBeenCalled();

    visibilityState = "visible";
    target.dispatchEvent(new Event("visibilitychange"));
    expect(refreshStats).toHaveBeenCalledTimes(1);
    expect(refreshUsers).toHaveBeenCalledTimes(1);

    unsubscribe();
    target.dispatchEvent(new Event("visibilitychange"));
    expect(refreshStats).toHaveBeenCalledTimes(1);
    expect(refreshUsers).toHaveBeenCalledTimes(1);
  });
});
