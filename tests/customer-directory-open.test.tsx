import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Warms the workspace chunk here, while the file is collected and no per-test timeout applies,
// instead of inside the first test. CustomerWorkspaceRouter lazy-loads it, and that import fetches
// its ~30 modules one RPC at a time through vitest's single main process: ~0.7 s alone, 4-5 s in a
// full run with every worker collecting at once, past the 5 s cap. The router's lazy import then
// resolves from this worker's module cache.
import "../src/components/Customer360Overlay";
import { CustomerWorkspaceRouter } from "../src/components/CustomerWorkspaceRouter";
import { resetHistoryLayers } from "../src/hooks/useHistoryLayer";
import { PanelIdentity } from "../src/hooks/usePanelPermission";
import { CustomersPage } from "../src/pages/CustomersPage";
import type { AuthUser, UserRollupRecord } from "../src/types/telemetry";
import { PERMISSIONS } from "../shared/panel-policy";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * The directory's card head on a real jsdom session history: tapping it opens
 * Customer 360 as one history entry, and Back closes the workspace onto the
 * same directory — same rows, same settings, focus back on the card that was
 * tapped. The page, the router and the workspace are real; only data fetching,
 * the animated canvas and the Licenses chunk (which the workspace preloads)
 * are stubbed.
 */
const fixtures = vi.hoisted(() => ({
  customer: {
    anchor: {
      requested_by: "hwid",
      requested_value: "hw_customer_01",
      requested_session_id: null,
      identity: "ins_customer_01",
      hwid: "hw_customer_01",
      install_id: "ins_customer_01",
      confidence: "device_only",
    },
    profile: {
      user_label: "Alex Morgan",
      customer_name: "Alex Morgan",
      email: "customer@example.test",
      discord: null,
      verified_discord: null,
      contact: null,
    },
    summary: {
      is_active: true,
      license_tier: "premium",
      app_version: "1.5.2",
      display_version: "1.5.2",
      platform: "Windows",
      os_version: "Windows 11",
      device_model: "Desktop PC",
      country: "DE",
      city: "Berlin",
      region: null,
      timezone: "Europe/Berlin",
      first_seen: "2025-11-04T12:00:00Z",
      last_seen: "2026-09-13T15:42:00Z",
      total_sessions: 146,
      total_duration_seconds: 296040,
      error_count: 0,
    },
    settings: { rpc_enabled: true, features: {} },
    diagnostics: null,
    activity: null,
    usage: [],
    orders: [],
    licenses: [],
    access: [],
    discord_links: [],
    feedback: [],
    errors: [],
    installs: [],
    sessions: [],
    section_errors: {},
  },
}));

vi.mock("../src/utils/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/utils/api")>()),
  fetchCustomer360: vi.fn(async () => ({
    ok: true,
    status: 200,
    data: { ok: true, customer: fixtures.customer },
  })),
  fetchAdminSuspensions: vi.fn(async () => ({ ok: true, status: 200, suspensions: [] })),
}));
vi.mock("../src/components/PanelBackground", () => ({ PanelBackground: () => null }));
vi.mock("../src/pages/LicensesPage", () => ({ LicensesPage: () => null }));

const OWNER: AuthUser = {
  email: "owner@example.test",
  role: "admin",
  panelRole: "owner",
  permissions: PERMISSIONS.map((permission) => permission.key),
};

const PAGE = "http://localhost:3000/#/customers";
const CUSTOMER = "http://localhost:3000/?customer=hw_customer_01&customerBy=hwid#/customers";

function customer(overrides: Partial<UserRollupRecord> = {}): UserRollupRecord {
  return {
    identity: "ins_customer_01",
    userLabel: "Alex Morgan",
    firstSeen: "2025-11-04T12:00:00Z",
    lastSeen: "2026-09-13T15:42:00Z",
    sessions: 146,
    totalDurationSeconds: 296040,
    errors: 0,
    isActive: true,
    licenseTier: "premium",
    hwid: "hw_customer_01",
    appVersion: "1.5.2",
    displayVersion: "1.5.2",
    platform: "Windows",
    osVersion: "Windows 11",
    deviceModel: "Desktop PC",
    country: "DE",
    city: "Berlin",
    timezone: "Europe/Berlin",
    rpcEnabled: null,
    discordUser: "alexm",
    latitude: null,
    longitude: null,
    lastStatus: null,
    lastEvent: null,
    features: {},
    recentErrors: [],
    ...overrides,
  };
}

let root: Root;
let container: HTMLDivElement;

beforeAll(() => {
  // The hand-off waits for the page underneath to finish animating in.
  if (!("getAnimations" in Element.prototype))
    Object.defineProperty(Element.prototype, "getAnimations", {
      configurable: true,
      value: () => [],
    });
  // TableFrame measures its frame; jsdom has no layout and no observer.
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
  resetHistoryLayers();
  history.replaceState(null, "", PAGE);
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

async function mount(users: UserRollupRecord[] = [customer()]) {
  await act(async () =>
    root.render(
      <PanelIdentity.Provider value={OWNER}>
        <main>
          <div className="page-enter">
            <CustomersPage users={users} />
          </div>
        </main>
        <CustomerWorkspaceRouter user={OWNER} />
      </PanelIdentity.Provider>,
    ),
  );
}

/** Lets React, the lazy workspace chunk, fetches and jsdom's async traversals settle. */
async function waitFor(check: () => boolean, what: string, timeout = 3000) {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

/** The live (not handed-off) Customer 360 with its record loaded. */
function workspaceShown(): boolean {
  const workspace = document.querySelector("section.customer-workspace");
  return Boolean(
    workspace &&
    !workspace.hasAttribute("inert") &&
    workspace.querySelector(".customer-action-bar"),
  );
}

function layerOf(state: unknown) {
  return (state as { rrLayer?: { key: string | null; depth: number } } | null)?.rrLayer ?? null;
}

function cardHead(name = "Alex Morgan"): HTMLButtonElement {
  const head = document.querySelector<HTMLButtonElement>(
    `.customer-directory-open[aria-label="Open Customer 360 for ${name}"]`,
  );
  if (!head) throw new Error(`no card head for ${name}`);
  return head;
}

function density(): string | null {
  return (
    document.querySelector(".customer-directory-section")?.getAttribute("data-density") ?? null
  );
}

describe("Customer directory card head on the session history", () => {
  it("tapping the card head opens Customer 360 as one history entry above the directory", async () => {
    await mount();
    const head = cardHead();
    expect(head.tagName).toBe("BUTTON");
    const push = vi.spyOn(history, "pushState");

    await act(async () => head.click());
    await waitFor(workspaceShown, "Customer 360");
    expect(location.href).toBe(CUSTOMER);
    expect(layerOf(history.state)).toMatchObject({ key: "customer", depth: 1 });
    expect(push).toHaveBeenCalledTimes(1);
    // The page underneath is held, not replaced: the same card is still in the DOM.
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.querySelector(".customer-directory-open")).toBe(head);
  });

  it("Back returns to the same directory with its settings and focus on the tapped card", async () => {
    await mount([
      customer(),
      customer({ identity: "ins_customer_02", hwid: "hw_customer_02", userLabel: "Bea Lund" }),
    ]);
    // A setting the directory holds in its own state, so a remount would lose it.
    const compact = [
      ...document.querySelectorAll<HTMLElement>(
        '[aria-label="Customer row density"] [role="radio"]',
      ),
    ].find((radio) => radio.textContent?.trim() === "Compact");
    await act(async () => compact!.click());
    expect(density()).toBe("compact");
    const head = cardHead("Bea Lund");

    await act(async () => head.click());
    await waitFor(workspaceShown, "Customer 360");
    expect(new URL(location.href).searchParams.get("customer")).toBe("hw_customer_02");

    history.back();
    await waitFor(
      () => location.href === PAGE && !document.querySelector("section.customer-workspace"),
      "the directory after Back",
    );
    expect(layerOf(history.state)).toBeNull();
    // The page is usable again, and it is the same page: same nodes, same density, no reload.
    expect(document.documentElement.style.overflow).toBe("");
    expect(Boolean(document.querySelector("main")!.inert)).toBe(false);
    expect(density()).toBe("compact");
    expect(document.querySelectorAll(".customer-directory-row")).toHaveLength(2);
    expect(cardHead("Bea Lund")).toBe(head);
    // Focus lands back on the card that was tapped, so the reader picks up where it left off.
    expect(document.activeElement).toBe(head);
  });
});
