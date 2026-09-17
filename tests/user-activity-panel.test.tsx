import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserActivityPanel } from "../src/components/UserActivityPanel";
import type { UserActivityPayload } from "../src/types/telemetry";
import { fetchUserActivity } from "../src/utils/api";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../src/utils/api", () => ({
  fetchUserActivity: vi.fn(),
}));

/* Berlin is UTC+2 in September: one long afternoon session (10:00–18:20) and
   one five-minute one, on two consecutive local days. */
const ACTIVITY: UserActivityPayload = {
  identity: "device-a",
  timezone: "Europe/Berlin",
  rangeDays: 7,
  totalSeconds: 30_300,
  sessionCount: 2,
  averageSessionSeconds: 15_150,
  firstSeen: "2026-09-03T14:59:28.000Z",
  lastSeen: "2026-09-17T07:40:00.000Z",
  legacyOnly: false,
  days: [
    { date: "2026-09-16", seconds: 300, sessions: 1 },
    { date: "2026-09-17", seconds: 30_000, sessions: 1 },
  ],
  intervals: [
    {
      startedAt: "2026-09-17T08:00:00.000Z",
      endedAt: "2026-09-17T16:20:00.000Z",
      approximateEnd: false,
    },
    {
      startedAt: "2026-09-16T14:00:00.000Z",
      endedAt: "2026-09-16T14:05:00.000Z",
      approximateEnd: false,
    },
  ],
  intervalsComplete: true,
  hourOfWeek: Array.from({ length: 7 }, () => Array(24).fill(0)),
  hourOfDay: Array(24).fill(0),
  weekdayTotals: Array(7).fill(0),
};

interface FakeEntry {
  target: Element;
  contentRect: { width: number };
}
type ResizeCallback = (entries: FakeEntry[]) => void;
const observers: Array<{ callback: ResizeCallback; targets: Element[] }> = [];

let container: HTMLDivElement;
let root: Root;
let identitySeq = 0;
let touch = false;

beforeEach(() => {
  vi.clearAllMocks();
  observers.length = 0;
  touch = false;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      callback: ResizeCallback;
      targets: Element[] = [];
      constructor(callback: ResizeCallback) {
        this.callback = callback;
        observers.push(this);
      }
      observe(target: Element) {
        this.targets.push(target);
      }
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  // jsdom has no matchMedia; the panel reads "(hover: none)" through it.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(hover: none)" && touch,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  vi.mocked(fetchUserActivity).mockResolvedValue({ ok: true, activity: ACTIVITY, status: 200 });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for the activity panel");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  }
}

/** Renders a fresh identity each time, so the panel's in-memory cache never short-circuits a fetch. */
async function render() {
  identitySeq += 1;
  await act(async () => {
    root.render(<UserActivityPanel identity={`device-${identitySeq}`} />);
  });
  await waitFor(() => container.querySelector(".user-activity-timeline") !== null);
}

function ticks() {
  return Array.from(container.querySelectorAll(".user-activity-timeline-axis span")).map(
    (tick) => ({ label: tick.textContent, left: (tick as HTMLElement).style.left }),
  );
}

/** Feeds the sizes a layout engine would report; jsdom lays nothing out. */
async function resize(widths: { timeline?: number; track?: number }) {
  const timeline = container.querySelector(".user-activity-timeline");
  const axis = container.querySelector(".user-activity-timeline-axis");
  if (!timeline || !axis) throw new Error("Missing timeline");
  const observer = observers.find((o) => o.targets.includes(timeline) && o.targets.includes(axis));
  if (!observer) throw new Error("The timeline is not observed for size changes");
  const entries: FakeEntry[] = [];
  if (widths.timeline !== undefined)
    entries.push({ target: timeline, contentRect: { width: widths.timeline } });
  if (widths.track !== undefined)
    entries.push({ target: axis, contentRect: { width: widths.track } });
  await act(async () => observer.callback(entries));
}

describe("UserActivityPanel", () => {
  it("tells a touch screen to tap and a pointer to hover", async () => {
    touch = true;
    await render();
    expect(container.querySelector(".user-activity-selection")?.textContent).toBe(
      "Tap a segment for its exact start and end time.",
    );
    await act(async () => root.unmount());
    root = createRoot(container);
    touch = false;
    await render();
    expect(container.querySelector(".user-activity-selection")?.textContent).toBe(
      "Hover or select a segment for its exact start and end time.",
    );
    expect(container.textContent).not.toContain("focus");
  });

  it("spreads the full 24 hours over the measured track with ticks that cannot collide", async () => {
    await render();
    // Unmeasured: the full two-hour axis.
    expect(ticks().map((t) => t.label)).toEqual([
      "00:00",
      "02:00",
      "04:00",
      "06:00",
      "08:00",
      "10:00",
      "12:00",
      "14:00",
      "16:00",
      "18:00",
      "20:00",
      "22:00",
      "24:00",
    ]);
    // A 390px phone leaves the track ~160px: five ticks, and no ":00" at that width.
    await resize({ track: 150 });
    expect(ticks()).toEqual([
      { label: "00", left: "0%" },
      { label: "06", left: "25%" },
      { label: "12", left: "50%" },
      { label: "18", left: "75%" },
      { label: "24", left: "100%" },
    ]);
    // A little more room keeps the five ticks and gives the minutes back.
    await resize({ track: 240 });
    expect(ticks().map((t) => t.label)).toEqual(["00:00", "06:00", "12:00", "18:00", "24:00"]);
    // Tablet: every four hours. Desktop: back to every two.
    await resize({ track: 360 });
    expect(ticks().map((t) => t.label)).toEqual([
      "00:00",
      "04:00",
      "08:00",
      "12:00",
      "16:00",
      "20:00",
      "24:00",
    ]);
    await resize({ track: 900 });
    expect(ticks()).toHaveLength(13);
    expect(container.querySelector(".user-activity-timeline")?.getAttribute("style")).toContain(
      "--activity-grid-step",
    );
  });

  it("narrows the date column and drops bar labels that no longer fit when the box is compact", async () => {
    await render();
    const dates = () =>
      Array.from(container.querySelectorAll(".user-activity-timeline-date")).map((d) => ({
        text: d.textContent,
        title: d.getAttribute("title"),
      }));
    const segments = () =>
      Array.from(container.querySelectorAll(".user-activity-timeline-segment")).map(
        (s) => s.textContent,
      );
    expect(dates()[0]).toEqual({ text: "Thu, 17 Sept 2026", title: null });
    // Percent alone decides before any measurement: the 8h20m bar carries its start, the 5m one does not.
    expect(segments()).toEqual(["10:00", ""]);

    await resize({ timeline: 250, track: 150 });
    expect(dates()).toEqual([
      { text: "Thu 17", title: "Thu, 17 Sept 2026" },
      { text: "Wed 16", title: "Wed, 16 Sept 2026" },
    ]);
    expect(container.querySelector(".user-activity-timeline")?.className).toContain("is-compact");
    // 34.7% of 150px is 52px: still room for "10:00".
    expect(segments()).toEqual(["10:00", ""]);

    await resize({ track: 90 });
    // 34.7% of 90px is 31px: the digits would clip, so the bar stays plain.
    expect(segments()).toEqual(["", ""]);

    await resize({ timeline: 900, track: 700 });
    expect(dates()[0]).toEqual({ text: "Thu, 17 Sept 2026", title: null });
    expect(container.querySelector(".user-activity-timeline")?.className).not.toContain(
      "is-compact",
    );
  });

  it("shortens the selected segment's date and clocks when the box is compact", async () => {
    await render();
    const selection = () => container.querySelector(".user-activity-selection");
    const bar = container.querySelector<HTMLButtonElement>(".user-activity-timeline-segment");
    if (!bar) throw new Error("Missing segment");
    await act(async () => bar.click());
    expect(selection()?.textContent).toBe("Thu, 17 Sept 202610:00:00–18:20:00 · 8h 20m");
    expect(selection()?.querySelector("strong")?.getAttribute("title")).toBeNull();

    // A 390px phone: "Thu 17 · 10:00–18:20 · 8h 20m" is one line; the full date on the title.
    await resize({ timeline: 250, track: 150 });
    expect(selection()?.textContent).toBe("Thu 1710:00–18:20 · 8h 20m");
    expect(selection()?.querySelector("strong")?.getAttribute("title")).toBe("Thu, 17 Sept 2026");

    await resize({ timeline: 900, track: 700 });
    expect(selection()?.textContent).toBe("Thu, 17 Sept 202610:00:00–18:20:00 · 8h 20m");
  });

  it("keeps the figures as a definition list in sentence case", async () => {
    await render();
    const labels = Array.from(container.querySelectorAll(".user-activity-stats dt")).map(
      (dt) => dt.textContent,
    );
    expect(labels).toEqual([
      "Recorded online",
      "Sessions",
      "Avg session",
      "First seen",
      "Timezone",
    ]);
    expect(container.querySelector(".user-activity-stats dd")?.textContent).toBe("8h 25m");
  });
});
