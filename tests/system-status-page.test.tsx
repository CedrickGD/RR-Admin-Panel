import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { SystemStatusPage } from "../src/pages/SystemStatusPage";
import { fetchApi } from "../src/utils/api";
import { SERVICE_ORDER } from "../src/utils/systemStatus";
import type { SystemStatusPayload } from "../shared/system-status";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * SystemStatusPage on jsdom, over the one thing this page must never get wrong: what it knows
 * RIGHT NOW. Only the API call is stubbed; the tiles, the service table, the dots and the
 * incident panel are the real components. A payload loads, the next poll fails, and the page
 * must stop presenting the old result as a passing health check (three staleness tests were
 * deleted together with systemChecks(); this replaces them at the page level).
 */
vi.mock("../src/utils/api", () => ({
  apiUrl: (path: string) => path,
  fetchApi: vi.fn(),
}));

const generatedAt = "2026-09-13T12:00:00.000Z";

function payload(patch: Partial<SystemStatusPayload> = {}): SystemStatusPayload {
  return {
    ok: true,
    generatedAt,
    overall: "ok",
    build: { commit: "abc1234", environment: "nas" },
    runtime: { node: "22.12.0", uptimeSeconds: 3600 },
    database: { reachable: true, latencyMs: 1 },
    // No event rates: the chart is recharts, and this test is about the health summary.
    events: null,
    storage: null,
    backup: { newestFile: "rr-20260913-0315.sqlite.gz", newestAt: generatedAt, ageSeconds: 60 },
    serverErrors: null,
    bot: { reachable: true, latencyMs: 12, uptimeSeconds: 600, clients: 0, watching: 1 },
    containers: [
      {
        service: "rr-api",
        name: "razorreaper-rr-api-1",
        state: "running",
        health: "healthy",
        uptimeSeconds: 24 * 3600,
        cpuPercent: 1.5,
        memoryBytes: 64 * 1024 * 1024,
        memoryLimitBytes: null,
      },
    ],
    sources: { containers: "ok" },
    incidents: [],
    ...patch,
  };
}

/** One successful poll; anything after the queued answers rejects, like a dead rr-api. */
function answerOnce(data: SystemStatusPayload) {
  vi.mocked(fetchApi).mockResolvedValueOnce({
    ok: true,
    json: async () => data,
  } as unknown as Response);
}

let root: Root;
let container: HTMLDivElement;

beforeAll(() => {
  if (!("ResizeObserver" in globalThis))
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    });
});

beforeEach(() => {
  history.replaceState(null, "", "http://localhost:3000/#/system");
  vi.mocked(fetchApi).mockReset();
  vi.mocked(fetchApi).mockRejectedValue(new Error("rr-api did not answer"));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

async function render() {
  await act(async () => root.render(<SystemStatusPage />));
  await act(async () => {});
}

/** The page polls on visibilitychange, so this is one more refresh without touching timers. */
async function poll() {
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await act(async () => {});
}

function tile(label: string): HTMLElement {
  const match = [...container.querySelectorAll<HTMLElement>(".stat-card")].find((el) =>
    el.textContent?.includes(label),
  );
  if (!match) throw new Error(`no "${label}" tile`);
  return match;
}

/** Green dots carry no modifier class; warn/err/idle are the amber, red and grey ones. */
function greenDots(): number {
  return container.querySelectorAll(".status-dot:not(.warn):not(.err):not(.idle)").length;
}

describe("SystemStatusPage: what it knows right now", () => {
  it("reports a healthy system while the polls succeed", async () => {
    answerOnce(payload());
    await render();

    expect(tile("Overall").textContent).toContain("Healthy");
    expect(tile("Overall").textContent).toContain("No incidents");
    expect(container.textContent).toContain("Every check passed on the last refresh.");
    expect(container.textContent).toContain("Refreshes every 30 seconds.");
    expect(greenDots()).toBeGreaterThan(0);
  });

  it("stops claiming everything is healthy once a refresh fails", async () => {
    answerOnce(payload());
    await render();
    expect(tile("Overall").textContent).toContain("Healthy");

    await poll(); // the default mock rejects: rr-api is gone, the old payload stays on screen

    // The summary no longer passes the last result off as a current check.
    expect(tile("Overall").textContent).toContain("Stale");
    expect(tile("Overall").textContent).not.toContain("Healthy");
    expect(tile("Overall").textContent).toContain("No incidents at the last check");
    expect(container.textContent).toContain("The last refresh failed.");
    expect(container.textContent).not.toContain("Every check passed on the last refresh.");
    expect(container.textContent).toContain("Last successful check; the refresh after it failed.");
    // Nothing is presented as verified any more, but the last reading is still listed.
    expect(greenDots()).toBe(0);
    expect(container.textContent).toContain("rr-api");
  });

  it("prints a calm dash for restarts and takes uptime from the container list", async () => {
    answerOnce(payload());
    await render();

    const cells = (label: string) => [
      ...container.querySelectorAll<HTMLElement>(`td[data-label="${label}"]`),
    ];
    const restarts = cells("Restarts");
    expect(restarts).toHaveLength(SERVICE_ORDER.length);
    for (const cell of restarts) {
      // Not collected: the gateway refuses inspect, and RestartCount lives only there. It reads
      // as the same "—" every other unreported figure uses — no error styling, no red wording.
      expect(cell.textContent).toBe("—");
      expect(cell.className).toBe("numeric");
      expect(cell.querySelector(".status-dot, .warn, .err")).toBeNull();
    }
    // 24 h, straight out of the list entry's "Up 24 hours" — no synthetic start timestamp.
    expect(cells("Uptime")[0].textContent).toBe("24 h 0 min");
    // The page says why the column is empty instead of leaving it mysteriously blank.
    expect(container.textContent).toContain("Restart counts need Docker inspect");
    // And a figure nobody can read is not an incident: the summary stays green.
    expect(tile("Overall").textContent).toContain("Healthy");
    expect(greenDots()).toBeGreaterThan(0);
  });

  it("goes back to a live summary on the next successful poll", async () => {
    answerOnce(payload());
    await render();
    await poll();
    expect(tile("Overall").textContent).toContain("Stale");

    answerOnce(payload());
    await poll();

    expect(tile("Overall").textContent).toContain("Healthy");
    expect(container.textContent).toContain("Every check passed on the last refresh.");
    expect(greenDots()).toBeGreaterThan(0);
  });
});
