import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { useAdminErrors } from "../src/hooks/useAdminErrors";
import { PanelIdentity } from "../src/hooks/usePanelPermission";
import { ErrorsPage } from "../src/pages/ErrorsPage";
import type { AuthUser, BackgroundFaultGroup, ErrorsPayload } from "../src/types/telemetry";
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
    events: 1702,
    installs: 9,
    sessions: 11,
    versions: ["1.5.2", "1.4.9", "1.4.8.11"],
    firstSeen: new Date(Date.now() - 23 * 3600e3).toISOString(),
    lastSeen: new Date(Date.now() - 60e3).toISOString(),
  },
  {
    code: "RR-E1003",
    exceptionType: "System.Net.Sockets.SocketException",
    events: 595,
    installs: 5,
    sessions: 6,
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

function errorsTileText(): string {
  const tile = [...container.querySelectorAll(".stat-card")].find((el) =>
    el.textContent?.includes("Errors in range"),
  );
  if (!tile) throw new Error("no Errors in range tile");
  return tile.textContent ?? "";
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
      "An unobserved background task in the desktop app throws repeatedly; it does not crash the app and is not counted as an error anywhere.",
    );
    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
    const firstRow = [...rows[0].querySelectorAll("td")];
    expect(firstRow.map((cell) => cell.getAttribute("data-label"))).toEqual([
      "Code",
      "Exception",
      "Events",
      "Installs",
      "Sessions",
      "Versions",
      "First seen",
      "Last seen",
    ]);
    expect(firstRow[0].textContent).toBe("RR-E1003");
    expect(firstRow[1].textContent).toBe("NullReferenceException");
    expect(firstRow[2].textContent).toBe("1,702");
    expect(firstRow[5].textContent).toBe("1.5.2, 1.4.9, 1.4.8.11");
    // A segment is plain state: no navigation, no history entry, tiles unchanged.
    expect(location.href).toBe(href);
    expect(history.length).toBe(historyLength);
    expect(errorsTileText()).toMatch(/^0\s*Errors in range/);

    await act(async () => radio("Errors").click());
    expect(container.textContent).toContain("No crashes reported in the last 24 hours");
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
