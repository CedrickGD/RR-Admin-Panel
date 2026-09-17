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

  it("lists every interval by day, and a strip cell jumps to its day", async () => {
    await render();
    expect(container.querySelector(".user-activity-intervals > summary")?.textContent).toBe(
      "Exact online intervals2 intervals · 2 days on this page",
    );
    const days = Array.from(
      container.querySelectorAll<HTMLDetailsElement>(".user-activity-intervals-day"),
    );
    expect(days.map((day) => day.querySelector("summary")?.textContent)).toEqual([
      "Thu, 17 Sept 2026\u00a0·8h 20m\u00a0· 1 interval\u00a0·first 10:00\u00a0· last 18:20",
      "Wed, 16 Sept 2026\u00a0·5m\u00a0· 1 interval\u00a0·first 16:00\u00a0· last 16:05",
    ]);
    expect(days.map((day) => day.open)).toEqual([true, true]);
    expect(
      Array.from(container.querySelectorAll(".user-activity-interval")).map((line) => ({
        text: line.textContent,
        title: line.getAttribute("title"),
      })),
    ).toEqual([
      { text: "10:00 –18:208h 20m", title: "10:00:00–18:20:00 · 8h 20m · Europe/Berlin" },
      { text: "16:00 –16:055m", title: "16:00:00–16:05:00 · 5m 0s · Europe/Berlin" },
    ]);
    // The pager would sit between the legend and the list; with two days there is none.
    expect(container.querySelector(".table-pagination")).toBeNull();

    // The strip's date and Online cells are buttons wired to the day's section.
    const cells = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        "button.user-activity-timeline-date, button.user-activity-timeline-total",
      ),
    );
    expect(cells.map((cell) => cell.textContent)).toEqual([
      "Thu, 17 Sept 2026",
      "8h 20m",
      "Wed, 16 Sept 2026",
      "5m",
    ]);
    expect(cells.map((cell) => cell.getAttribute("aria-controls"))).toEqual([
      days[0].id,
      days[0].id,
      days[1].id,
      days[1].id,
    ]);
    // With the day and the whole box folded, a tap opens both.
    const box = container.querySelector<HTMLDetailsElement>(".user-activity-intervals")!;
    box.open = false;
    days[1].open = false;
    await act(async () => cells[3].click());
    expect(box.open).toBe(true);
    expect(days[1].open).toBe(true);
    expect(days[1].className).toContain("is-flash");
    expect(days[0].className).not.toContain("is-flash");
  });

  it("opens a folded day and selects its line when the day's bar is clicked", async () => {
    await render();
    const box = container.querySelector<HTMLDetailsElement>(".user-activity-intervals")!;
    const days = Array.from(
      container.querySelectorAll<HTMLDetailsElement>(".user-activity-intervals-day"),
    );
    box.open = false;
    days[1].open = false;
    // The second bar is Wed 16's five-minute run.
    const bars = container.querySelectorAll<HTMLButtonElement>(".user-activity-timeline-segment");
    await act(async () => bars[1].click());
    expect(box.open).toBe(true);
    expect(days[1].open).toBe(true);
    const selected = container.querySelectorAll("li.user-activity-interval.is-selected");
    expect(selected).toHaveLength(1);
    expect(days[1].contains(selected[0])).toBe(true);
    expect(selected[0].id).toContain("line-");
    // A bar click reveals; it does not flash the day the way a strip cell does.
    expect(container.querySelector(".is-flash")).toBeNull();
  });

  it("hangs a bar whose centre is past noon from the right edge of the track", async () => {
    await render();
    const [long, short] = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".user-activity-timeline-segment"),
    );
    // 10:00–18:20 centres at 59%: anchored right, 100 − 41.667 − 34.722.
    expect(long.style.left).toBe("");
    expect(parseFloat(long.style.right)).toBeCloseTo(23.611, 2);
    expect(long.style.width).toBe("34.72222222222222%");
    // 16:00–16:05 sits at 66.7%: anchored right, 100 − 66.667 − 0.347.
    expect(short.style.left).toBe("");
    expect(parseFloat(short.style.right)).toBeCloseTo(32.986, 2);
  });

  it("says on each line where local midnight clipped a run of three days", async () => {
    vi.mocked(fetchUserActivity).mockResolvedValue({
      ok: true,
      status: 200,
      activity: {
        ...ACTIVITY,
        days: [
          { date: "2026-09-14", seconds: 3_600, sessions: 1 },
          { date: "2026-09-15", seconds: 3_600, sessions: 0 },
          { date: "2026-09-16", seconds: 3_600, sessions: 0 },
        ],
        intervals: [
          {
            startedAt: "2026-09-14T10:00:00.000Z",
            endedAt: "2026-09-16T12:00:00.000Z",
            approximateEnd: false,
          },
        ],
      },
    });
    await render();
    const notes = Array.from(container.querySelectorAll(".user-activity-interval")).map(
      (line) => line.querySelector(".user-activity-interval-note")?.textContent ?? null,
    );
    // Newest day first: the 16th ends the run, the 15th is a whole middle day, the 14th starts it.
    expect(notes).toEqual([
      "from previous day",
      "from previous day · into next day",
      "into next day",
    ]);
  });

  it("drops the selection and the flash when the page of days changes", async () => {
    const dates = Array.from({ length: 31 }, (_, index) => {
      const day = new Date(Date.UTC(2026, 7, 17 + index));
      return day.toISOString().slice(0, 10);
    });
    vi.mocked(fetchUserActivity).mockResolvedValue({
      ok: true,
      status: 200,
      activity: {
        ...ACTIVITY,
        rangeDays: 0,
        days: dates.map((date) => ({ date, seconds: 600, sessions: 1 })),
        intervals: dates.map((date) => ({
          startedAt: `${date}T10:00:00.000Z`,
          endedAt: `${date}T10:10:00.000Z`,
          approximateEnd: false,
        })),
      },
    });
    await render();
    const hint = () => container.querySelector(".user-activity-selection")?.textContent;
    expect(container.querySelector(".table-pagination")).not.toBeNull();
    const bar = container.querySelector<HTMLButtonElement>(".user-activity-timeline-segment")!;
    const cell = container.querySelector<HTMLButtonElement>("button.user-activity-timeline-date")!;
    await act(async () => bar.click());
    await act(async () => cell.click());
    expect(container.querySelector(".user-activity-interval.is-selected")).not.toBeNull();
    expect(container.querySelector(".user-activity-intervals-day.is-flash")).not.toBeNull();
    expect(hint()).not.toContain("Hover or select");

    const next = container.querySelector<HTMLButtonElement>('button[aria-label="Next page"]')!;
    await act(async () => next.click());
    expect(container.querySelector(".user-activity-interval.is-selected")).toBeNull();
    expect(container.querySelector(".user-activity-intervals-day.is-flash")).toBeNull();
    expect(hint()).toBe("Hover or select a segment for its exact start and end time.");
  });

  it("lets the tapped day's flash fade after a second and a half", async () => {
    await render();
    vi.useFakeTimers();
    try {
      const cell = container.querySelector<HTMLButtonElement>(
        "button.user-activity-timeline-total",
      )!;
      await act(async () => cell.click());
      const day = () => container.querySelector(".user-activity-intervals-day");
      expect(day()?.className).toContain("is-flash");
      await act(async () => {
        vi.advanceTimersByTime(1_499);
      });
      expect(day()?.className).toContain("is-flash");
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(day()?.className).not.toContain("is-flash");
    } finally {
      vi.useRealTimers();
    }
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
