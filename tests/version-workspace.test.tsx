// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VersionsPage, VersionReleaseStatus } from "../src/pages/VersionsPage";
import { LEGACY_VERSION_LABEL } from "../src/utils/versionLabel";
import type { StatsPayload, SummaryPayload } from "../src/types/telemetry";

const fixture = vi.hoisted(() => ({
  latest: "1.5.0",
  releases: ["1.5.0", "1.4.9", "1.3.0", "1.2.0"],
  exports: true,
  kpis: new Map<string, unknown>(),
}));
vi.mock("../src/hooks/useLatestVersion", () => ({ useLatestVersion: () => fixture.latest }));
vi.mock("../src/hooks/useReleaseVersions", () => ({ useReleaseVersions: () => fixture.releases }));
vi.mock("../src/hooks/useChartColors", () => ({ useChartColors: () => ({ override: null }) }));
vi.mock("../src/hooks/usePanelPermission", () => ({
  usePanelPermission: (permission?: string) => permission !== "exports.read" || fixture.exports,
}));
vi.mock("../src/components/KpiStatCard", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/components/KpiStatCard")>();
  return {
    ...original,
    KpiStatCard: (props: Parameters<typeof original.KpiStatCard>[0]) => {
      fixture.kpis.set(String(props.label), props);
      return <original.KpiStatCard {...props} />;
    },
  };
});

function stats(): StatsPayload {
  const dates = { firstSeen: "2026-08-01T10:00:00Z", lastSeen: "2026-09-14T10:00:00Z" };
  return {
    totals: { rpcEnabledUsers: 2, rpcKnownUsers: 4 },
    breakdowns: {
      versionsAllTime: [
        { version: "1.5", users: 8, sessions: 20, ...dates },
        { version: "1.5.0", users: 2, sessions: 5, ...dates },
        { version: "1.4.9", users: 12, sessions: 90, ...dates },
        { version: "1.3.0", users: 5, sessions: 8, ...dates },
        { version: "legacy", users: 2, sessions: 4, ...dates },
        { version: "unknown", users: 1, sessions: 1, ...dates },
      ],
      versionsCurrent: [
        { version: "1.5", users: 4, activeUsers: 1 },
        { version: "1.5.0", users: 2, activeUsers: 0 },
        { version: "1.4.9", users: 2, activeUsers: 0 },
        { version: "legacy", users: 1, activeUsers: 0 },
        { version: "unknown", users: 1, activeUsers: 0 },
      ],
    },
  } as StatsPayload;
}
const summary = {} as SummaryPayload;
function renderPage(value: StatsPayload | null = stats()) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    <VersionsPage summary={summary} stats={value} theme="dark" />,
  );
  return host;
}
function releaseRow(host: HTMLElement, label: string) {
  return [...host.querySelectorAll<HTMLTableRowElement>("tbody > tr")].find(
    (row) => row.cells[0]?.textContent === label,
  );
}
let mountedRoot: Root | null = null;
let mountedHost: HTMLDivElement | null = null;
beforeEach(() => {
  fixture.latest = "1.5.0";
  fixture.releases = ["1.5.0", "1.4.9", "1.3.0", "1.2.0"];
  fixture.exports = true;
  fixture.kpis.clear();
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
  if (mountedRoot) await act(async () => mountedRoot?.unmount());
  mountedRoot = null;
  mountedHost?.remove();
  mountedHost = null;
  vi.unstubAllGlobals();
});

describe("Version adoption workspace", () => {
  it("uses factual usage labels without inferring a release lifecycle or online state", () => {
    const current = renderToStaticMarkup(
      <VersionReleaseStatus row={{ isLatest: false, currentUsers: 2, allTimeUsers: 12 }} />,
    );
    const historical = renderToStaticMarkup(
      <VersionReleaseStatus row={{ isLatest: false, currentUsers: 0, allTimeUsers: 5 }} />,
    );
    const silent = renderToStaticMarkup(
      <VersionReleaseStatus row={{ isLatest: false, currentUsers: 0, allTimeUsers: 0 }} />,
    );
    expect(current).toContain("In use");
    expect(current).not.toContain("Active");
    expect(historical).toContain("Previously seen");
    expect(historical).not.toContain("Retired");
    expect(silent).toContain("No telemetry");
  });

  it("merges normalized versions while preserving zero-telemetry releases in history", () => {
    const host = renderPage();
    const latest = releaseRow(host, "1.5.0");
    expect(latest).toBeDefined();
    expect(latest?.cells[1].textContent).toBe("6");
    expect(latest?.cells[2].textContent).toBe("10");
    expect(latest?.cells[3].textContent).toBe("25");
    expect(releaseRow(host, "1.2.0")?.textContent).toContain("No telemetry");
    expect([...host.querySelectorAll(".rank-label")].map((node) => node.textContent)).not.toContain(
      "1.2.0",
    );
  });

  it("keeps legacy and unknown customers in the tracked current denominator", () => {
    const host = renderPage();
    expect(releaseRow(host, LEGACY_VERSION_LABEL)).toBeDefined();
    expect(releaseRow(host, "unknown")).toBeDefined();
    const onLatest = fixture.kpis.get("On latest") as { value: string; sub: string };
    const other = fixture.kpis.get("Not on latest") as { value: string; sub: string };
    expect(onLatest.value).toBe("6");
    expect(onLatest.sub).toContain("60% of tracked");
    expect(other.value).toBe("4");
    expect(other.sub).toContain("40% of tracked");
    expect(host.textContent).not.toContain("of known");
  });

  it("does not manufacture a latest-release entry when the reference is absent", () => {
    fixture.latest = "9.9.9";
    fixture.releases = [];
    renderPage();
    const tracked = fixture.kpis.get("Versions tracked") as {
      drilldown: { breakdown: Array<{ label: string; value: string }> };
    };
    expect(tracked.drilldown.breakdown.find((item) => item.label === "Latest release")?.value).toBe(
      "0",
    );
  });

  it("keeps RPC and source limitations in a closed disclosure, not primary adoption coverage", () => {
    const host = renderPage();
    const details = host.querySelector("details.version-reporting-details");
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.textContent).toContain("not a measure of version adoption");
    expect(details?.textContent).toContain("2 of 4 reporting");
    expect(details?.textContent).toContain("cannot be added across versions");
    expect(details?.textContent).toContain(
      "reference version can fall back to the configured default",
    );
    expect(host.querySelectorAll(".gauge")).toHaveLength(1);
    expect(host.querySelectorAll('[aria-label="Version adoption view"]')).toHaveLength(1);
  });

  it("preserves observation dates in closed native mobile disclosures", () => {
    const host = renderPage();
    const details = releaseRow(host, "1.5.0")?.querySelector("details.version-observation-details");
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toBe("Observation dates");
    expect(details?.querySelectorAll("dt")).toHaveLength(2);
  });

  it("gates CSV export independently of read-only release history", () => {
    fixture.exports = false;
    const host = renderPage();
    expect(host.querySelector('button[title="Download CSV"]')).toBeNull();
    expect(releaseRow(host, "1.5.0")).toBeDefined();
  });

  it("keeps the loading skeleton's four adoption labels consistent", () => {
    const host = renderPage(null);
    expect(fixture.kpis.size).toBe(4);
    expect(fixture.kpis.has("Not on latest")).toBe(true);
    expect(host.querySelector(".version-workspace")).not.toBeNull();
  });

  it("switches only the adoption view and discloses non-additive all-time customer counts", async () => {
    mountedHost = document.createElement("div");
    document.body.append(mountedHost);
    mountedRoot = createRoot(mountedHost);
    await act(async () => {
      mountedRoot?.render(<VersionsPage summary={summary} stats={stats()} theme="dark" />);
    });
    const allTime = [...mountedHost.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
      (button) => button.textContent?.includes("All time"),
    );
    expect(allTime).toBeDefined();
    await act(async () => {
      allTime?.click();
    });
    expect(mountedHost.querySelector(".rank-label")?.textContent).toBe("1.4.9");
    expect(mountedHost.querySelector(".rank-value")?.textContent).toBe("12");
    expect(mountedHost.textContent).toContain("A customer can appear in more than one version");
    expect((fixture.kpis.get("On latest") as { value: string }).value).toBe("6");
  });
});
