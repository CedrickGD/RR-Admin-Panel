// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerVersionChart, CustomersPage } from "../src/pages/CustomersPage";
import { LicenseInventoryCharts, LicensesPage } from "../src/pages/LicensesPage";
import { LEGACY_VERSION_LABEL } from "../src/utils/versionLabel";
import type { UserRollupRecord } from "../src/types/telemetry";

type ChartCapture = {
  title: string;
  description?: string;
  data: ReadonlyArray<{ label: string; value: number; color?: string }>;
  unavailable?: boolean;
  variant?: string;
  emptyMessage?: string;
};
const fixture = vi.hoisted(() => ({
  charts: new Map<string, ChartCapture>(),
  queries: { customers: "", licenses: "" } as Record<string, string>,
  licenses: [] as unknown[],
  fail: false,
}));
vi.mock("../src/components/charts/DistributionChart", () => ({
  DistributionChart: (props: ChartCapture) => {
    fixture.charts.set(props.title, props);
    return (
      <section aria-label={props.title} data-unavailable={props.unavailable}>
        {props.title}
      </section>
    );
  },
}));
vi.mock("../src/hooks/usePanelPermission", () => ({
  usePanelPermission: (permission?: string) => permission !== "access.read",
}));
vi.mock("../src/hooks/useWorkspaceSearch", () => ({
  useWorkspaceSearch: (page: string) => [fixture.queries[page] || "", () => {}],
}));
vi.mock("../src/components/CustomerProfiles", () => ({
  useCustomerDirectory: (users: UserRollupRecord[] | null) => users,
  useCustomerProfiles: () => () => null,
  CustomerAvatar: ({ label }: { label: string }) => <span>{label}</span>,
}));
vi.mock("../src/components/Customer360Overlay", () => ({ Customer360Overlay: () => null }));
vi.mock("../src/components/CustomerAccessDialog", () => ({ CustomerAccessDialog: () => null }));
vi.mock("../src/components/CustomerReturnLink", () => ({ CustomerReturnLink: () => null }));
vi.mock("../src/utils/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/utils/api")>();
  return {
    ...original,
    apiUrl: (path: string) => path,
    fetchApi: vi.fn(async () => {
      if (fixture.fail) throw new Error("Fixture load failed");
      return { json: async () => ({ ok: true, licenses: fixture.licenses }) };
    }),
  };
});

function user(overrides: Partial<UserRollupRecord> = {}): UserRollupRecord {
  return {
    identity: "customer-1",
    userLabel: "Avery Stone",
    hwid: "hw-1",
    firstSeen: "2026-08-01T10:00:00Z",
    lastSeen: "2026-09-14T10:00:00Z",
    sessions: 12,
    totalDurationSeconds: 3600,
    errors: 0,
    isActive: true,
    licenseTier: "premium",
    suspension: null,
    appVersion: "1.5.0",
    displayVersion: "1.5.0",
    platform: "Windows",
    osVersion: "Windows 11",
    deviceModel: "Desktop PC",
    country: "DE",
    city: "Berlin",
    timezone: "Europe/Berlin",
    rpcEnabled: null,
    discordUser: "avery",
    latitude: null,
    longitude: null,
    lastStatus: null,
    lastEvent: null,
    features: {},
    recentErrors: [],
    ...overrides,
  };
}
type License = ComponentProps<typeof LicenseInventoryCharts>["licenses"][number];
function license(overrides: Partial<License> = {}): License {
  return {
    id: 1,
    license_key: "PREVIEW-KEY-0001",
    type: "lifetime",
    duration_days: null,
    hwid: "hw-1",
    status: "active",
    custom_options: "{}",
    usage_count: 1,
    max_uses: 1,
    created_at: "2026-08-01T10:00:00Z",
    activated_at: "2026-08-01T11:00:00Z",
    expires_at: null,
    customer_name: "Avery Stone",
    customer_email: "avery@example.test",
    order_id: "ORDER-1",
    order_source: "admin",
    ...overrides,
  };
}
function capture(title: string) {
  const chart = fixture.charts.get(title);
  expect(chart).toBeDefined();
  return chart!;
}
function values(chart: ChartCapture) {
  return Object.fromEntries(chart.data.map((item) => [item.label, item.value]));
}
let root: Root | null = null;
let host: HTMLDivElement | null = null;
async function mountLicenses() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<LicensesPage />);
  });
}
beforeEach(() => {
  fixture.charts.clear();
  fixture.queries.customers = "";
  fixture.queries.licenses = "";
  fixture.licenses = [];
  fixture.fail = false;
  window.history.replaceState(null, "", "/");
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Customer and license chart scopes", () => {
  it("keeps unknown and legacy visible when grouping many customer versions", () => {
    const users = [
      ...Array.from({ length: 8 }, (_, index) =>
        user({ appVersion: `1.${index}.0`, displayVersion: null }),
      ),
      user({ appVersion: null, displayVersion: null }),
      user({ appVersion: "legacy", displayVersion: null }),
    ];
    renderToStaticMarkup(<CustomerVersionChart users={users} filtered={false} />);
    const chart = capture("App version mix");
    expect(chart.data).toHaveLength(6);
    expect(values(chart).Unknown).toBe(1);
    expect(values(chart)[LEGACY_VERSION_LABEL]).toBe(1);
    expect(values(chart)["Other reported versions"]).toBe(5);
    expect(chart.data.reduce((sum, item) => sum + item.value, 0)).toBe(10);
  });

  it("counts every matching customer before the 75-row table pagination", () => {
    const users = Array.from({ length: 81 }, (_, index) =>
      user({ identity: "customer-" + index, hwid: "hw-" + index }),
    );
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<CustomersPage users={users} />);
    expect(values(capture("App version mix"))["1.5.0"]).toBe(81);
    expect(host.querySelectorAll(".customer-directory-section tbody > tr")).toHaveLength(75);
    expect(capture("App version mix").description).toContain(
      "81 loaded customers, before pagination",
    );
  });

  it("uses the actual filtered directory instead of the unfiltered KPI totals", () => {
    fixture.queries.customers = "Avery";
    renderToStaticMarkup(
      <CustomersPage
        users={[
          user(),
          user({
            identity: "customer-2",
            hwid: "hw-2",
            userLabel: "Morgan Ellis",
            discordUser: "morgan",
            appVersion: "1.4.9",
            displayVersion: "1.4.9",
          }),
        ]}
      />,
    );
    expect(values(capture("App version mix"))).toEqual({ "1.5.0": 1 });
    expect(capture("App version mix").description).toContain("1 matching loaded");
  });

  it("distinguishes unavailable customer data from an empty filtered selection", () => {
    renderToStaticMarkup(<CustomerVersionChart users={null} filtered={false} />);
    expect(capture("App version mix").unavailable).toBe(true);
    expect(capture("App version mix").data).toHaveLength(0);
    renderToStaticMarkup(<CustomerVersionChart users={[]} filtered />);
    expect(capture("App version mix").unavailable).toBe(false);
    expect(capture("App version mix").emptyMessage).toBe("No customers match the current filters.");
  });

  it("keeps recorded license state separate from binding and effective access", () => {
    renderToStaticMarkup(
      <LicenseInventoryCharts
        licenses={[
          license({ expires_at: "2025-01-01T00:00:00Z" }),
          license({ id: 2, status: "revoked", hwid: null }),
          license({ id: 3, status: "expired", hwid: "hw-3" }),
          license({ id: 4, status: "", hwid: null }),
        ]}
        unavailable={false}
        filtered={false}
      />,
    );
    expect(values(capture("License states"))).toEqual({
      Active: 1,
      Revoked: 1,
      Expired: 1,
      Unknown: 1,
    });
    expect(values(capture("Device binding"))).toEqual({ Bound: 2, Unbound: 2 });
    expect(capture("License states").description).toContain(
      "Recorded status, not effective access",
    );
    expect(capture("Device binding").description).toContain("not online presence or seat usage");
    expect(capture("License states").variant).toBe("donut");
  });

  it("does not infer seat counts from unlimited master licenses", () => {
    renderToStaticMarkup(
      <LicenseInventoryCharts
        licenses={[license({ max_uses: -1, usage_count: 12, custom_options: '{"master":true}' })]}
        unavailable={false}
        filtered
      />,
    );
    expect(values(capture("Device binding"))).toEqual({ Bound: 1, Unbound: 0 });
    expect(capture("Device binding").description).toContain("1 matching loaded licenses");
  });

  it("does not display the initial license request as a zero-license inventory", () => {
    renderToStaticMarkup(<LicensesPage />);
    expect(capture("License states").unavailable).toBe(true);
    expect(capture("Device binding").unavailable).toBe(true);
    expect(capture("License states").data).toHaveLength(0);
  });

  it("preserves unavailable state after an initial license fetch failure", async () => {
    fixture.fail = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await mountLicenses();
    expect(capture("License states").unavailable).toBe(true);
    expect(capture("Device binding").data).toHaveLength(0);
  });

  it("recognizes a successful empty inventory without treating it as unavailable", async () => {
    await mountLicenses();
    expect(capture("License states").unavailable).toBe(false);
    expect(capture("License states").data).toHaveLength(0);
    expect(capture("License states").emptyMessage).toBe("No loaded licenses to chart.");
  });

  it("uses the same searched license records as the inventory table", async () => {
    fixture.queries.licenses = "Avery";
    fixture.licenses = [
      license(),
      license({
        id: 2,
        license_key: "PREVIEW-KEY-0002",
        customer_name: "Morgan Ellis",
        customer_email: "morgan@example.test",
        status: "revoked",
        hwid: null,
      }),
    ];
    await mountLicenses();
    expect(values(capture("License states"))).toEqual({ Active: 1 });
    expect(values(capture("Device binding"))).toEqual({ Bound: 1, Unbound: 0 });
    expect(capture("License states").description).toContain("1 matching loaded licenses");
    expect(host?.querySelectorAll(".license-inventory-row")).toHaveLength(1);
  });
});
