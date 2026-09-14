// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LivePage, LiveSessionConnectionDetails, LiveSessionSignals } from "../src/pages/LivePage";
import type { AppSessionRecord, SummaryPayload } from "../src/types/telemetry";

const fixture = vi.hoisted(() => ({ customersRead: true, query: "" }));
vi.mock("../src/hooks/usePanelPermission", () => ({
  usePanelPermission: (permission?: string) =>
    permission !== "customers.read" || fixture.customersRead,
}));
vi.mock("../src/hooks/useWorkspaceSearch", () => ({
  useWorkspaceSearch: () => [fixture.query, () => {}],
}));
vi.mock("../src/components/CustomerProfiles", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/components/CustomerProfiles")>();
  return { ...original, useCustomerProfiles: () => () => undefined };
});

const NOW = Date.parse("2026-09-14T12:00:00Z");
function session(overrides: Partial<AppSessionRecord> = {}): AppSessionRecord {
  return {
    id: "session-avery",
    installId: "install-avery",
    hwid: "hardware-avery",
    source: "app",
    userLabel: "Avery Stone",
    discordUser: "avery",
    clientIp: "192.0.2.10",
    clientCountry: "DE",
    clientCity: "Berlin",
    clientRegion: null,
    appVersion: "1.5.0",
    displayVersion: "1.5.0",
    platform: "Windows",
    osVersion: "Windows 11",
    deviceModel: "Desktop PC",
    rpcEnabled: true,
    startedAt: "2026-09-14T11:00:00Z",
    lastSeenAt: "2026-09-14T11:59:00Z",
    endedAt: null,
    durationSeconds: 3540,
    isActive: true,
    lastEvent: "heartbeat",
    lastStatus: "ok",
    errorCount: 2,
    ...overrides,
  } as AppSessionRecord;
}
function renderPage(sessions: AppSessionRecord[] = [session()]) {
  const summary = {
    generatedAt: new Date(NOW).toISOString(),
    storage: "d1",
    activeSessions: sessions,
    recentSessions: sessions,
    recentEvents: [],
    recentErrors: [],
    stats: {},
  } as unknown as SummaryPayload;
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<LivePage summary={summary} onOpenMapSession={() => {}} />);
  return host;
}
beforeEach(() => {
  fixture.customersRead = true;
  fixture.query = "";
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("Live Monitoring workspace", () => {
  it("keeps RPC and error signals visible together without turning RPC into presence", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<LiveSessionSignals errorCount={2} rpcEnabled={true} />);
    expect(host.querySelector(".live-session-presence")?.textContent).toContain("Online");
    expect(host.querySelector(".live-session-rpc")?.textContent).toBe("RPC on");
    expect(host.querySelector(".live-session-errors")?.textContent).toBe("2 errors");
    expect(host.querySelector(".live-session-errors")?.getAttribute("data-has-errors")).toBe(
      "true",
    );
  });

  it("does not claim RPC is disabled or telemetry is faultless when its state is unknown", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<LiveSessionSignals errorCount={0} rpcEnabled={null} />);
    expect(host.querySelector(".live-session-rpc")?.textContent).toBe("RPC not reported");
    expect(host.querySelector(".live-session-errors")?.textContent).toBe("No errors reported");
  });

  it("keeps technical fields in a closed native disclosure, including the mobile-hidden version", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<LiveSessionConnectionDetails session={session()} />);
    const details = host.querySelector("details");
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toBe("Connection & device details");
    for (const value of [
      "1.5.0",
      "Windows 11",
      "Desktop PC",
      "install-avery",
      "session-avery",
      "hardware-avery",
      "192.0.2.10",
    ]) {
      expect(details?.textContent).toContain(value);
    }
  });

  it("keeps one filter home, six table columns and readable customer actions", () => {
    const host = renderPage();
    expect(host.querySelectorAll('[aria-label="Live session filters"]')).toHaveLength(1);
    expect(host.querySelector('[aria-label="Search live sessions"]')).not.toBeNull();
    expect(host.querySelectorAll("thead th")).toHaveLength(6);
    expect(host.querySelector(".live-session-customer")?.textContent).toContain("Avery Stone");
    expect(host.querySelector(".live-workspace-count")?.textContent).toBe("1 shown / 1 live");
    expect(
      [...host.querySelectorAll(".live-action-label")].map((node) => node.textContent),
    ).toEqual(["Customer", "Map", "Details"]);
    expect(host.querySelectorAll('[aria-expanded="false"]')).not.toHaveLength(0);
  });

  it("preserves the live cutoff rather than presenting stale sessions as online", () => {
    const host = renderPage([
      session(),
      session({
        id: "stale",
        installId: "stale-install",
        hwid: "stale-hardware",
        lastSeenAt: "2026-09-14T11:50:00Z",
      }),
    ]);
    expect(host.querySelectorAll(".live-session-row")).toHaveLength(1);
    expect(host.querySelector(".live-workspace-count")?.textContent).toBe("1 shown / 1 live");
  });

  it("gates Customer workspace by permission while leaving session details available", () => {
    fixture.customersRead = false;
    const host = renderPage();
    expect(host.querySelector('[aria-label="Open customer workspace for Avery Stone"]')).toBeNull();
    expect(
      host.querySelector('[aria-label="Show session details for Avery Stone"]'),
    ).not.toBeNull();
  });

  it("does not offer a map action without a resolvable country", () => {
    const host = renderPage([session({ clientCountry: null, clientCity: null })]);
    expect(host.querySelector('[aria-label="View Avery Stone on map"]')).toBeNull();
    expect(
      host.querySelector('[aria-label="Open customer workspace for Avery Stone"]'),
    ).not.toBeNull();
  });

  it("keeps a zero-match search distinct from an empty live feed", () => {
    fixture.query = "no-such-customer";
    const host = renderPage();
    expect(host.querySelector(".live-workspace-count")?.textContent).toBe("0 shown / 1 live");
    expect(host.textContent).toContain("No matching live sessions");
    expect(host.querySelector('[aria-label="Live session filters"]')?.textContent).toContain(
      "Reset",
    );
  });
});
