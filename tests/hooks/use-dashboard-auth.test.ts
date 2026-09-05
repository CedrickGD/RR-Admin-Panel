import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  fetchAdminData: vi.fn(),
  fetchSession: vi.fn(),
  postAuth: vi.fn(),
  postLogout: vi.fn(),
}));

const hookHarness = vi.hoisted(() => {
  const states: unknown[] = [];
  const refs: Array<{ current: unknown }> = [];
  const effects: Array<() => void | (() => void)> = [];
  let stateCursor = 0;
  let refCursor = 0;

  return {
    states,
    refs,
    effects,
    reset(): void {
      states.length = 0;
      refs.length = 0;
      effects.length = 0;
      stateCursor = 0;
      refCursor = 0;
    },
    beginRender(): void {
      effects.length = 0;
      stateCursor = 0;
      refCursor = 0;
    },
    useState(initial: unknown) {
      const index = stateCursor++;
      if (index >= states.length) states[index] = initial;
      return [
        states[index],
        (next: unknown) => {
          states[index] =
            typeof next === "function"
              ? (next as (previous: unknown) => unknown)(states[index])
              : next;
        },
      ];
    },
    useRef(initial: unknown) {
      const index = refCursor++;
      if (!refs[index]) refs[index] = { current: initial };
      return refs[index];
    },
    useEffect(effect: () => void | (() => void)): void {
      effects.push(effect);
    },
  };
});

vi.mock("react", () => ({
  useCallback: <T>(callback: T): T => callback,
  useEffect: hookHarness.useEffect,
  useRef: hookHarness.useRef,
  useState: hookHarness.useState,
}));

vi.mock("../../src/utils/api", () => apiMocks);

import { useDashboard } from "../../src/hooks/useDashboard";

const authenticatedSession = {
  authenticated: true,
  hasUsers: true,
  authMode: "access" as const,
  user: { email: "admin@example.test", role: "admin" as const },
};

function renderDashboard() {
  hookHarness.beginRender();
  return useDashboard("overview");
}

async function runBootstrapEffect(): Promise<void> {
  if (!hookHarness.effects.length) throw new Error("Dashboard mount effects were not registered.");
  // Mount all effects with the initial signed-out state, as React does. Their
  // order can change when the hook adds synchronization effects.
  for (const effect of hookHarness.effects) effect();

  // The effect deliberately starts an async task with `void`; give its nested
  // session and dashboard promises enough microtask turns to settle.
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
}

beforeEach(() => {
  hookHarness.reset();
  vi.clearAllMocks();
  apiMocks.postLogout.mockResolvedValue(undefined);
});

describe("useDashboard session transitions", () => {
  it("renders a verification error state, not an unauthenticated verdict, when bootstrap fails", async () => {
    apiMocks.fetchSession.mockRejectedValue(new Error("JWKS unavailable"));

    renderDashboard();
    await runBootstrapEffect();
    const dashboard = renderDashboard();

    expect(dashboard.ready).toBe(true);
    expect(dashboard.user).toBeNull();
    expect(dashboard.sessionError).toContain("temporarily unavailable");
    expect(dashboard.requiresBootstrap).toBe(false);
  });

  it("preserves the authenticated user when a dashboard 401 cannot be verified", async () => {
    apiMocks.fetchSession
      .mockResolvedValueOnce(authenticatedSession)
      .mockRejectedValueOnce(new Error("session verifier unavailable"));
    apiMocks.fetchAdminData.mockResolvedValue({ ok: false, status: 401 });

    renderDashboard();
    await runBootstrapEffect();
    const dashboard = renderDashboard();

    expect(dashboard.ready).toBe(true);
    expect(dashboard.user).toEqual(authenticatedSession.user);
    expect(dashboard.sessionError).toBeNull();
    expect(dashboard.loadError).toBe("session verifier unavailable");
  });

  it("clears the authenticated user after an explicit unauthenticated session verdict", async () => {
    apiMocks.fetchSession.mockResolvedValueOnce(authenticatedSession).mockResolvedValueOnce({
      authenticated: false,
      hasUsers: true,
      authMode: "app",
    });
    apiMocks.fetchAdminData.mockResolvedValue({ ok: false, status: 401 });

    renderDashboard();
    await runBootstrapEffect();
    const dashboard = renderDashboard();

    expect(dashboard.ready).toBe(true);
    expect(dashboard.user).toBeNull();
    expect(dashboard.sessionError).toBeNull();
    expect(dashboard.authError).toBe("Session expired. Please sign in again.");
  });
});
