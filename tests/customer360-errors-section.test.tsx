import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerWorkspaceRouter } from "../src/components/CustomerWorkspaceRouter";
import { resetHistoryLayers } from "../src/hooks/useHistoryLayer";
import { PanelIdentity } from "../src/hooks/usePanelPermission";
import type { AuthUser } from "../src/types/telemetry";
import { openCustomerWorkspace } from "../src/utils/customerNavigation";
import { PERMISSIONS } from "../shared/panel-policy";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * F1, the rendering half: the Errors section heading must count what Key figures
 * counts. Background faults stay listed and labelled — the owner wants the noise
 * visible here — they are just never called errors.
 */
const REAL_ERROR_MESSAGE = "Object reference not set to an instance of an object.";
const BACKGROUND_MESSAGE = "A Task's exception(s) were not observed";
const BACKGROUND_ROWS = 40;

const fixtures = vi.hoisted(() => {
  /** What the API attaches to a background row from a client before 1.5.3: one row, one fault. */
  const legacyReport = {
    kind: null,
    occurrences: 1,
    faultSource: "unobserved_task",
    topFrame: null,
    topFrames: null,
    baseExceptionType: "System.NullReferenceException",
    leafExceptionCount: null,
    suppressedAbortedIo: 0,
    renderOwner: null,
    renderOrigin: null,
    renderStopped: false,
  };
  const errorRow = (
    index: number,
    kind: "unhandled" | "background",
    report: Record<string, unknown> | null = kind === "background" ? legacyReport : null,
  ) => ({
    id: `evt-${kind}-${index}`,
    timestamp: new Date(Date.UTC(2026, 8, 13, 12, 0, index)).toISOString(),
    receivedAt: new Date(Date.UTC(2026, 8, 13, 12, 0, index)).toISOString(),
    message:
      kind === "background"
        ? "A Task's exception(s) were not observed"
        : "Object reference not set to an instance of an object.",
    type: kind === "background" ? "System.AggregateException" : "System.NullReferenceException",
    kind,
    code: kind === "background" ? "RR-E1003" : "RR-E2001",
    sessionId: "s-1",
    appVersion: "1.5.2",
    source: "desktop-app",
    extras: {},
    report,
  });

  return {
    legacyReport,
    customer: {
      anchor: {
        requested_by: "hwid",
        requested_value: "device-1",
        requested_session_id: null,
        identity: "device-1",
        hwid: "device-1",
        install_id: "install-1",
        confidence: "device_only",
      },
      profile: {
        user_label: "Avery Stone",
        customer_name: "Avery Stone",
        email: null,
        discord: null,
        verified_discord: null,
        contact: null,
      },
      summary: {
        is_active: false,
        license_tier: "free",
        app_version: "1.5.2",
        display_version: "1.5.2",
        platform: "Windows",
        os_version: "Windows 11",
        device_model: "Desktop PC",
        country: "DE",
        city: "Berlin",
        region: null,
        timezone: "Europe/Berlin",
        first_seen: "2026-01-01T12:00:00Z",
        last_seen: "2026-09-13T12:00:00Z",
        total_sessions: 3,
        total_duration_seconds: 600,
        // Real errors only — what the server counts, and what the heading must match.
        error_count: 1,
      },
      settings: { rpc_enabled: null, features: {} },
      diagnostics: null,
      activity: null,
      usage: [],
      orders: [],
      licenses: [],
      access: [],
      discord_links: [],
      feedback: [],
      errors: [
        errorRow(0, "unhandled"),
        ...Array.from({ length: 38 }, (_, index) => errorRow(index + 1, "background")),
        // The client from 1.5.3: one 5-minute rollup standing for 412 faults, and the aborted
        // Discord-pipe I/O it suppressed, which is not a fault at all.
        errorRow(39, "background", {
          ...legacyReport,
          kind: "rollup",
          occurrences: 412,
          topFrame: "RazorReaper.Components.Pages.Home.UpdateResources (Home.razor:1394)",
          topFrames: "Home.UpdateResources (Home.razor:1394)",
        }),
        errorRow(40, "background", {
          ...legacyReport,
          kind: "suppressed",
          occurrences: 17,
          suppressedAbortedIo: 17,
          baseExceptionType: null,
          leafExceptionCount: 0,
        }),
      ],
      installs: [],
      sessions: [],
      section_errors: {},
    },
  };
});

vi.mock("../src/utils/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/utils/api")>()),
  fetchCustomer360: vi.fn(async () => ({
    ok: true,
    status: 200,
    data: { ok: true, customer: fixtures.customer },
  })),
  fetchAdminSuspensions: vi.fn(async () => ({ ok: true, suspensions: [] })),
}));
vi.mock("../src/components/PanelBackground", () => ({ PanelBackground: () => null }));
vi.mock("../src/pages/LicensesPage", () => ({ LicensesPage: () => null }));

const OWNER: AuthUser = {
  email: "owner@example.test",
  role: "admin",
  panelRole: "owner",
  permissions: PERMISSIONS.map((permission) => permission.key),
};

let root: Root;
let container: HTMLDivElement;

beforeAll(() => {
  if (!("getAnimations" in Element.prototype))
    Object.defineProperty(Element.prototype, "getAnimations", {
      configurable: true,
      value: () => [],
    });
});

beforeEach(() => {
  resetHistoryLayers();
  history.replaceState(null, "", "http://localhost:3000/#/customers");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  document.documentElement.style.overflow = "";
  vi.restoreAllMocks();
  resetHistoryLayers();
});

async function waitFor(check: () => boolean, what: string, timeout = 3000) {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

function controlLabel(element: Element | null): string {
  return element?.getAttribute("aria-label")?.trim() || element?.textContent?.trim() || "";
}

function buttonNamed(name: string): HTMLButtonElement | null {
  return (
    [...document.body.querySelectorAll("button")].find((button) => controlLabel(button) === name) ??
    null
  );
}

function workspaceShown(): boolean {
  const workspace = document.querySelector("section.customer-workspace");
  return Boolean(workspace && workspace.querySelector(".customer-action-bar"));
}

/** The "Errors" card on the Support & history tab. */
function errorsCard(): HTMLElement {
  const card = [...document.querySelectorAll<HTMLElement>("section.customer360-card")].find(
    (section) => section.querySelector(".customer360-section-heading h3")?.textContent === "Errors",
  );
  if (!card) throw new Error("no Errors card");
  return card;
}

async function openErrorsSection() {
  await act(async () =>
    root.render(
      <PanelIdentity.Provider value={OWNER}>
        <main>
          <div className="page-enter">Customers</div>
        </main>
        <CustomerWorkspaceRouter user={OWNER} />
      </PanelIdentity.Provider>,
    ),
  );
  await act(async () => openCustomerWorkspace({ selector: "hwid", value: "device-1" }));
  await waitFor(workspaceShown, "Customer 360");
  await act(async () => buttonNamed("Support & history")!.click());
  await waitFor(() => {
    try {
      return Boolean(errorsCard());
    } catch {
      return false;
    }
  }, "the Errors card");
}

describe("Customer 360 Errors section", () => {
  it("counts real errors in the heading, not the rows it lists", async () => {
    await openErrorsSection();
    const badge = errorsCard().querySelector(
      ".customer360-section-heading .badge, .customer360-section-heading [class*='badge']",
    );

    // 41 rows are listed; exactly one of them is an error.
    expect(badge?.textContent?.trim()).toBe("1");
    expect(errorsCard().querySelectorAll("details.customer360-record")).toHaveLength(
      BACKGROUND_ROWS + 1,
    );
  });

  it("agrees with the Key figures count on the Overview tab", async () => {
    await openErrorsSection();
    const heading = errorsCard()
      .querySelector(".customer360-section-heading")
      ?.textContent?.replace("Errors", "")
      .trim();

    expect(heading).toBe(String(fixtures.customer.summary.error_count));
  });

  it("keeps background faults visible and labelled as background", async () => {
    await openErrorsSection();
    const card = errorsCard();

    expect(card.textContent).toContain(REAL_ERROR_MESSAGE);
    expect(card.textContent).toContain(BACKGROUND_MESSAGE);
    const badges = [...card.querySelectorAll("details.customer360-record summary")].map(
      (summary) => summary.lastElementChild?.textContent?.trim() ?? "",
    );
    expect(badges.filter((label) => label === "background")).toHaveLength(BACKGROUND_ROWS);
    expect(badges.filter((label) => label === "unhandled")).toHaveLength(1);
  });

  it("gives the real error the error tone and background faults the muted one", async () => {
    await openErrorsSection();
    const badges = [...errorsCard().querySelectorAll("details.customer360-record summary .badge")];
    const tone = (badge: Element) =>
      badge.classList.contains("badge-danger")
        ? "danger"
        : badge.classList.contains("badge-muted")
          ? "muted"
          : [...badge.classList].join(" ");
    const byLabel = (label: string) =>
      badges.filter((badge) => badge.textContent?.trim() === label).map(tone);

    // "unhandled" is what the client sends for a crash — a kind, not the word "error" — and it
    // must read as one; the noise stays muted, like the caption above it says.
    expect(byLabel("unhandled")).toEqual(["danger"]);
    expect(byLabel("background")).toEqual(Array.from({ length: BACKGROUND_ROWS }, () => "muted"));
    expect(badges).toHaveLength(BACKGROUND_ROWS + 1);
  });

  it("says why the listed faults are not counted, before it lists them", async () => {
    await openErrorsSection();
    const card = errorsCard();
    const caption = card.querySelector(".customer360-caption");
    const list = card.querySelector(".customer360-record-list");

    // 40 rows, of which 38 are one fault each and one is a rollup of 412; the suppressed I/O
    // row stands for no fault.
    expect(caption?.textContent).toContain(
      "40 background fault reports are listed below, standing for 450 faults",
    );
    expect(caption?.textContent).toContain("never counted as errors");
    // Read before the rows, not after 40 of them: the explanation is what keeps a list of
    // background noise under a heading that counts 1 from reading as 41 crashes.
    expect(caption && list && caption.compareDocumentPosition(list)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("says on the row what a rollup or a suppressed-I/O row stands for", async () => {
    await openErrorsSection();
    const metas = [...errorsCard().querySelectorAll("details.customer360-record summary small")].map(
      (small) => small.textContent ?? "",
    );

    expect(metas).toHaveLength(BACKGROUND_ROWS + 1);
    expect(metas.filter((meta) => meta.includes("5-minute rollup, 412 faults"))).toHaveLength(1);
    expect(
      metas.filter((meta) =>
        meta.includes("17 faults of aborted Discord-pipe I/O, suppressed by the client"),
      ),
    ).toHaveLength(1);
    // A row that is one fault says nothing extra; neither does the real error.
    expect(metas.filter((meta) => /rollup|suppressed|sighting/.test(meta))).toHaveLength(2);
  });

  it("counts a list of only old-style rows as one fault each, with no standing-for clause", async () => {
    const all = fixtures.customer.errors;
    fixtures.customer.errors = all.filter((row) => row.report === null || row.report.kind === null);
    try {
      await openErrorsSection();
      const caption = errorsCard().querySelector(".customer360-caption");

      expect(caption?.textContent).toContain("38 background fault reports are listed below —");
      expect(caption?.textContent).not.toContain("standing for");
    } finally {
      fixtures.customer.errors = all;
    }
  });
});
