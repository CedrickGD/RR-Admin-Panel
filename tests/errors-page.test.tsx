import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { useAdminErrors } from "../src/hooks/useAdminErrors";
import { PanelIdentity } from "../src/hooks/usePanelPermission";
import { ErrorsPage } from "../src/pages/ErrorsPage";
import type {
  AuthUser,
  BackgroundFaultGroup,
  ErrorsPayload,
  ErrorUserGroup,
} from "../src/types/telemetry";
import { PERMISSIONS } from "../shared/panel-policy";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * ErrorsPage on jsdom with the production situation: no real errors, background faults only.
 * Only the data hook is stubbed; segment control, empty state, link and fault table are real.
 */
vi.mock("../src/hooks/useAdminErrors", () => ({ useAdminErrors: vi.fn() }));

const OWNER: AuthUser = {
  email: "owner@example.test",
  role: "admin",
  panelRole: "owner",
  permissions: PERMISSIONS.map((permission) => permission.key),
};

const FAULTS: BackgroundFaultGroup[] = [
  {
    code: "RR-E1003",
    exceptionType: "System.NullReferenceException",
    faultSource: "unobserved_task",
    topFrame: "RazorReaper.Components.Pages.Home.UpdateResources (Home.razor:1394)",
    topFrames: "Home.UpdateResources (Home.razor:1394) > Home.OnInitializedAsync (Home.razor:889)",
    // 1,702 faults behind 23 client reports: first sightings plus 5-minute rollups.
    events: 1702,
    reports: 23,
    installs: 9,
    sessions: 11,
    stoppedSessions: 0,
    versions: ["1.5.2", "1.4.9", "1.4.8.11"],
    firstSeen: new Date(Date.now() - 23 * 3600e3).toISOString(),
    lastSeen: new Date(Date.now() - 60e3).toISOString(),
  },
  {
    code: "RR-E1003",
    exceptionType: "System.Net.Sockets.SocketException",
    faultSource: "render_dispatch",
    topFrame: "RazorReaper.Components.Pages.Server.RefreshVisibleServersAsync (Server.razor:496)",
    topFrames: "RazorReaper.Components.Pages.Server.RefreshVisibleServersAsync (Server.razor:496)",
    events: 595,
    reports: 595,
    installs: 5,
    sessions: 6,
    stoppedSessions: 2,
    versions: ["1.5.2"],
    firstSeen: new Date(Date.now() - 22 * 3600e3).toISOString(),
    lastSeen: new Date(Date.now() - 600e3).toISOString(),
  },
];

function payload(overrides: Partial<ErrorsPayload> = {}): ErrorsPayload {
  return {
    generatedAt: new Date().toISOString(),
    range: "24h",
    cutoff: new Date(Date.now() - 24 * 3600e3).toISOString(),
    scanTruncated: false,
    usersTruncated: false,
    totals: { errors: 0, backgroundErrors: 2297, affectedUsers: 0, lastErrorAt: null },
    users: [],
    backgroundFaults: FAULTS,
    backgroundFaultsTruncated: false,
    ...overrides,
  };
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
  if (!("getAnimations" in Element.prototype))
    Object.defineProperty(Element.prototype, "getAnimations", {
      configurable: true,
      value: () => [],
    });
});

beforeEach(() => {
  history.replaceState(null, "", "http://localhost:3000/#/errors");
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

async function render(data: ErrorsPayload) {
  vi.mocked(useAdminErrors).mockReturnValue({
    data,
    loading: false,
    error: null,
    refresh: vi.fn(),
  } as unknown as ReturnType<typeof useAdminErrors>);
  await act(async () =>
    root.render(
      <PanelIdentity.Provider value={OWNER}>
        <ErrorsPage />
      </PanelIdentity.Provider>,
    ),
  );
}

function radio(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
    (el) => el.textContent?.trim() === label,
  );
  if (!match) throw new Error(`no radio "${label}"`);
  return match;
}

function tileText(label: string): string {
  const tile = [...container.querySelectorAll(".stat-card")].find((el) =>
    el.textContent?.includes(label),
  );
  if (!tile) throw new Error(`no ${label} tile`);
  return tile.textContent ?? "";
}

const errorsTileText = () => tileText("Errors in range");

/** One affected customer the server shipped inside the 500-group cap. */
function userGroup(index: number): ErrorUserGroup {
  const at = new Date(Date.now() - (index + 1) * 60e3).toISOString();
  return {
    identity: `HW-${index}`,
    userLabel: `Customer ${index}`,
    discordUser: null,
    hwid: `HW-${index}`,
    installId: `inst-${index}`,
    licenseTier: "free",
    country: "DE",
    city: null,
    timezone: null,
    platform: "win32",
    osVersion: null,
    deviceModel: null,
    appVersion: "1.5.2",
    displayVersion: "1.5.2",
    isActive: false,
    lastSeen: at,
    errorCount: 1,
    firstErrorAt: at,
    lastErrorAt: at,
    events: [
      {
        id: `evt-${index}`,
        timestamp: at,
        receivedAt: at,
        message: "Object reference not set to an instance of an object.",
        type: "System.NullReferenceException",
        kind: "unhandled",
        code: "RR-E2001",
        sessionId: `s-${index}`,
        appVersion: "1.5.2",
        source: "desktop-app",
        extras: {},
      },
    ],
    truncated: false,
  };
}

describe("ErrorsPage: Errors | Background faults", () => {
  it("opens on real errors with a calm empty state and one line about background faults", async () => {
    await render(payload());

    expect(radio("Errors").getAttribute("aria-checked")).toBe("true");
    expect(radio("Background faults").getAttribute("aria-checked")).toBe("false");
    expect(container.textContent).toContain("No crashes reported in the last 24 hours");
    expect(container.textContent).toContain(
      "2,297 background faults from a known client bug are listed under Background faults.",
    );
    // The old select is gone, and the tiles count real errors only.
    expect(container.querySelector('[aria-label="Background task errors"]')).toBeNull();
    expect(errorsTileText()).toMatch(/^0\s*Errors in range/);
    expect(container.querySelector("table")).toBeNull();
  });

  it("the empty-state link switches to the fault table without a history entry", async () => {
    await render(payload());
    const href = location.href;
    const historyLength = history.length;

    const link = container.querySelector<HTMLButtonElement>(".record-link.is-inline");
    expect(link?.textContent?.trim()).toBe("Background faults");
    await act(async () => link!.click());

    expect(radio("Background faults").getAttribute("aria-checked")).toBe("true");
    expect(container.textContent).toContain(
      "Faults in the desktop app's background tasks and render updates, reported once per distinct fault and rolled up every 5 minutes. They do not crash the app and are not counted as errors anywhere.",
    );
    // The badge counts faults (SUM of occurrences), never rows.
    expect(container.textContent).toContain("2,297 faults");
    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
    const firstRow = [...rows[0].querySelectorAll("td")];
    expect(firstRow.map((cell) => cell.getAttribute("data-label"))).toEqual([
      "Code",
      "Exception",
      "Top frame",
      "Source",
      "Faults",
      "Installs",
      "Sessions",
      "Versions",
      "First seen",
      "Last seen",
    ]);
    expect(firstRow[0].textContent).toBe("RR-E1003");
    expect(firstRow[1].textContent).toBe("NullReferenceException");
    // The frame without its namespace; the full chain stays in the title.
    expect(firstRow[2].textContent).toBe("Home.UpdateResources (Home.razor:1394)");
    expect(firstRow[2].querySelector("span")?.getAttribute("title")).toBe(
      "Home.UpdateResources (Home.razor:1394) > Home.OnInitializedAsync (Home.razor:889)",
    );
    expect(firstRow[3].textContent).toBe("Task");
    expect(firstRow[4].textContent).toBe("1,702");
    expect(firstRow[4].querySelector("span")?.getAttribute("title")).toBe(
      "23 reports from the client",
    );
    expect(firstRow[7].textContent).toBe("1.5.2, 1.4.9, 1.4.8.11");
    // A render fault names its source, and says when the breaker stopped a component.
    const secondRow = [...rows[1].querySelectorAll("td")];
    expect(secondRow[2].textContent).toBe(
      "Server.RefreshVisibleServersAsync (Server.razor:496)",
    );
    expect(secondRow[3].textContent).toBe("Render · stopped in 2 sessions");
    expect(secondRow[4].querySelector("span")?.getAttribute("title")).toBeNull();
    // A segment is plain state: no navigation, no history entry, tiles unchanged.
    expect(location.href).toBe(href);
    expect(history.length).toBe(historyLength);
    expect(errorsTileText()).toMatch(/^0\s*Errors in range/);

    await act(async () => radio("Errors").click());
    expect(container.textContent).toContain("No crashes reported in the last 24 hours");
  });

  it("mentions suppressed Discord-pipe I/O once, only on the fault segment, only when there is some", async () => {
    await render(
      payload({
        totals: {
          errors: 0,
          backgroundErrors: 2297,
          backgroundSuppressed: 1204,
          affectedUsers: 0,
          lastErrorAt: null,
        },
      }),
    );
    const note = () =>
      [...container.querySelectorAll(".page-note")].find((el) =>
        el.textContent?.includes("suppressed"),
      );

    expect(note()).toBeUndefined();
    await act(async () => radio("Background faults").click());
    expect(note()?.textContent).toBe(
      "The client also suppressed 1,204 aborted-I/O faults on the Discord pipe before reporting; they are not faults in the app and are not listed.",
    );
    // Nothing of it reaches the tiles: it is not an error, and not a fault either.
    expect(errorsTileText()).toMatch(/^0\s*Errors in range/);
    expect(container.textContent).toContain("2,297 faults");

    await render(payload());
    await act(async () => radio("Background faults").click());
    expect(note()).toBeUndefined();
  });

  it("says plainly when the API build does not report background faults yet", async () => {
    await render(payload({ backgroundFaults: undefined, backgroundFaultsTruncated: undefined }));

    await act(async () => radio("Background faults").click());

    expect(container.textContent).toContain("Not reported by this API build");
    expect(container.querySelector("table")).toBeNull();
  });

  it("drops the background line when the range has no faults", async () => {
    await render(
      payload({
        totals: { errors: 0, backgroundErrors: 0, affectedUsers: 0, lastErrorAt: null },
        backgroundFaults: [],
      }),
    );

    expect(container.textContent).toContain("No crashes reported in the last 24 hours");
    expect(container.textContent).toContain("New errors surface here within seconds of ingest.");
    expect(container.querySelector(".record-link.is-inline")).toBeNull();

    await act(async () => radio("Background faults").click());
    expect(container.textContent).toContain("No background faults in the last 24 hours");
  });
});

describe("ErrorsPage: KPI tiles report the server totals, not the capped list", () => {
  // The response caps the user list at 500 groups but keeps totals uncapped.
  const SHIPPED = 3;
  const AFFECTED = 640;

  const truncated = () =>
    payload({
      usersTruncated: true,
      totals: {
        errors: 812,
        backgroundErrors: 0,
        affectedUsers: AFFECTED,
        lastErrorAt: new Date(Date.now() - 60e3).toISOString(),
      },
      users: Array.from({ length: SHIPPED }, (_, index) => userGroup(index)),
      backgroundFaults: [],
    });

  it("counts every affected customer, not the ones that fit in the payload", async () => {
    await render(truncated());

    // The note that promises it, and the tile that has to keep the promise.
    expect(container.textContent).toContain("totals still count everyone");
    expect(tileText("Affected customers")).toMatch(/^640\s*Affected customers/);
    expect(tileText("Affected customers")).not.toMatch(/^3\s/);
    // Errors in range was already the server total; the two tiles now agree on scope.
    expect(errorsTileText()).toMatch(/^812\s*Errors in range/);
  });

  it("still counts the shipped groups in the table subtitle", async () => {
    await render(truncated());

    // The "N of M shown" distinction stays the list's own, so the page says both.
    expect(container.textContent).toContain("3 of 3 affected customers shown");
  });

  it("leaves an untruncated range reading the same number as its rows", async () => {
    await render(
      payload({
        usersTruncated: false,
        totals: {
          errors: 3,
          backgroundErrors: 0,
          affectedUsers: SHIPPED,
          lastErrorAt: new Date(Date.now() - 60e3).toISOString(),
        },
        users: Array.from({ length: SHIPPED }, (_, index) => userGroup(index)),
        backgroundFaults: [],
      }),
    );

    expect(container.textContent).not.toContain("totals still count everyone");
    expect(tileText("Affected customers")).toMatch(/^3\s*Affected customers/);
  });
});
