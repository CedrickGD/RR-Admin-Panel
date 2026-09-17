import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  apiUrl: (path: string) => path,
  fetchAdminData: vi.fn(),
  fetchSession: vi.fn(),
  postAuth: vi.fn(),
  postLogout: vi.fn(),
}));

// The same minimal hook harness as use-dashboard-auth.test.ts: state and refs by call order,
// effects collected per render and run by hand. useRefreshSignal takes its useRef/useEffect from
// the same mock, so the bus subscription lands in `effects` like the hook's own.
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
import { emitRefresh } from "../../src/utils/refreshBus";

const user = { email: "admin@example.test", role: "admin" as const };
const signedIn = { authenticated: true, hasUsers: true, authMode: "access" as const, user };
const signedOut = { authenticated: false, hasUsers: true, authMode: "app" as const };

function dashboard(generatedAt: string, unread: number) {
  return {
    ok: true,
    status: 200,
    data: {
      summary: { generatedAt, feedbackUnread: { feedback: unread, support: 0, total: unread } },
      health: { ok: true },
      user,
      authMode: "access",
    },
  };
}

function render() {
  hookHarness.beginRender();
  return useDashboard("feedback");
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
}

/** Mounts the first render's effects (the bootstrap and the bus subscription among them). */
async function mount(): Promise<void> {
  if (!hookHarness.effects.length) throw new Error("Dashboard mount effects were not registered.");
  for (const effect of hookHarness.effects) effect();
  await settle();
}

beforeEach(() => {
  hookHarness.reset();
  vi.clearAllMocks();
});

describe("useDashboard on the refresh bus", () => {
  // Signed out first: its subscription stays registered for the file, and must stay inert.
  it("ignores the bus while signed out", async () => {
    apiMocks.fetchSession.mockResolvedValue(signedOut);
    render();
    await mount();
    render();

    emitRefresh();
    await settle();
    expect(apiMocks.fetchAdminData).not.toHaveBeenCalled();
  });

  it("re-pulls the summary silently when a page emits after changing data", async () => {
    apiMocks.fetchSession.mockResolvedValue(signedIn);
    apiMocks.fetchAdminData.mockResolvedValue(dashboard("2026-09-17T10:00:00.000Z", 3));
    render();
    await mount();
    expect(apiMocks.fetchAdminData).toHaveBeenCalledTimes(1);
    // The next render hands the subscription a callback that sees the signed-in user.
    expect(render().summary?.feedbackUnread?.total).toBe(3);

    // Feedback's Mark read: the rail count follows the summary on the very next request.
    apiMocks.fetchAdminData.mockResolvedValue(dashboard("2026-09-17T10:00:05.000Z", 2));
    emitRefresh();
    await settle();
    expect(apiMocks.fetchAdminData).toHaveBeenCalledTimes(2);
    const refreshed = render();
    expect(refreshed.summary?.feedbackUnread?.total).toBe(2);
    expect(refreshed.loadError).toBeNull();

    // A blip on that re-pull is silent: the data on screen stays, no load-error banner.
    apiMocks.fetchAdminData.mockRejectedValueOnce(new Error("refresh blip"));
    emitRefresh();
    await settle();
    expect(apiMocks.fetchAdminData).toHaveBeenCalledTimes(3);
    const afterBlip = render();
    expect(afterBlip.summary?.feedbackUnread?.total).toBe(2);
    expect(afterBlip.loadError).toBeNull();
  });
});
