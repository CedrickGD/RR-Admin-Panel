import { describe, expect, it } from "vitest";

import {
  activityAxisTicks,
  activityGridStep,
  activitySegmentLabelFits,
  activitySegmentPlacement,
  addCalendarDays,
  buildActivityIntervalDays,
  buildActivityTimelineRows,
  formatActivityClock,
  formatActivityDate,
  localDateStartEpoch,
} from "../src/utils/activityTimeline";
import { paginate } from "../src/utils/pagination";

describe("exact activity timeline", () => {
  it("uses the real 23/25-hour duration of DST calendar days", () => {
    const springStart = localDateStartEpoch("2026-03-29", "Europe/Berlin");
    const springEnd = localDateStartEpoch("2026-03-30", "Europe/Berlin");
    const fallStart = localDateStartEpoch("2026-10-25", "Europe/Berlin");
    const fallEnd = localDateStartEpoch("2026-10-26", "Europe/Berlin");

    expect((springEnd - springStart) / 3_600_000).toBe(23);
    expect((fallEnd - fallStart) / 3_600_000).toBe(25);
  });

  it.each([
    ["America/Havana", "2026-03-08"],
    ["America/Santiago", "2026-09-06"],
    ["Atlantic/Azores", "2026-03-29"],
  ])("finds the first instant of %s dates when DST changes at midnight", (timezone, date) => {
    const boundary = localDateStartEpoch(date, timezone);
    const localDate = (epochMs: number) => {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(epochMs);
      const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      return `${values.year}-${values.month}-${values.day}`;
    };

    expect(localDate(boundary)).toBe(date);
    expect(localDate(boundary - 1)).toBe(addCalendarDays(date, -1));
  });

  it("keeps exact interval bounds and duration instead of hourly totals", () => {
    const rows = buildActivityTimelineRows(
      [{ date: "2026-08-30", seconds: 5_700, sessions: 1 }],
      [
        {
          startedAt: "2026-08-30T06:07:00.000Z",
          endedAt: "2026-08-30T07:42:00.000Z",
          approximateEnd: false,
        },
      ],
      "Europe/Berlin",
    );

    expect(rows[0].segments).toHaveLength(1);
    expect(rows[0].segments[0]).toMatchObject({
      startedAt: "2026-08-30T06:07:00.000Z",
      endedAt: "2026-08-30T07:42:00.000Z",
      durationSeconds: 5_700,
      approximateEnd: false,
    });
    expect(rows[0].segments[0].leftPercent).toBeCloseTo(((8 * 60 + 7) / (24 * 60)) * 100, 4);
  });

  it("clips a cross-midnight interval into the correct local day rows", () => {
    const rows = buildActivityTimelineRows(
      [
        { date: "2026-08-29", seconds: 1_800, sessions: 1 },
        { date: "2026-08-30", seconds: 2_700, sessions: 0 },
      ],
      [
        {
          startedAt: "2026-08-29T21:30:00.000Z",
          endedAt: "2026-08-29T22:45:00.000Z",
          approximateEnd: true,
        },
      ],
      "Europe/Berlin",
    );

    expect(rows[0].segments[0].durationSeconds).toBe(1_800);
    expect(rows[0].segments[0].approximateEnd).toBe(false);
    expect(rows[1].segments[0].durationSeconds).toBe(2_700);
    expect(rows[1].segments[0].approximateEnd).toBe(true);
  });

  it("keeps lifetime detail bounded to 30 mounted date rows", () => {
    const newest = "2026-08-30";
    const days = Array.from({ length: 3650 }, (_, index) => ({
      date: addCalendarDays(newest, -index),
      seconds: 0,
      sessions: 0,
    }));

    const firstPage = paginate(days, 1, 30);
    const lastPage = paginate(days, 999, 30);

    expect(firstPage.items).toHaveLength(30);
    expect(lastPage.items.length).toBeLessThanOrEqual(30);
    expect(lastPage.page).toBe(lastPage.pageCount);
  });
});

describe("exact interval list", () => {
  const rows = buildActivityTimelineRows(
    [
      { date: "2026-08-30", seconds: 2_700, sessions: 1 },
      { date: "2026-08-29", seconds: 3_240, sessions: 2 },
      { date: "2026-08-28", seconds: 0, sessions: 0 },
    ],
    [
      // 23:30 local, crosses midnight, last heartbeat end.
      {
        startedAt: "2026-08-29T21:30:00.000Z",
        endedAt: "2026-08-29T22:45:00.000Z",
        approximateEnd: true,
      },
      // 09:00–09:24 local, listed after the earlier run even though it comes first in the payload.
      {
        startedAt: "2026-08-29T07:00:00.000Z",
        endedAt: "2026-08-29T07:24:00.000Z",
        approximateEnd: false,
      },
    ],
    "Europe/Berlin",
  );
  const days = buildActivityIntervalDays(rows, "Europe/Berlin");

  it("keeps the strip's page order, drops offline days and sorts a day's lines by clock", () => {
    expect(days.map((day) => day.date)).toEqual(["2026-08-30", "2026-08-29"]);
    expect(days[1].seconds).toBe(3_240);
    expect(days[1].lines.map((line) => `${line.start}–${line.end}`)).toEqual([
      "09:00–09:24",
      "23:30–24:00",
    ]);
    expect(days[1].lines[0]).toMatchObject({
      durationSeconds: 1_440,
      approximateEnd: false,
      fromPreviousDay: false,
      intoNextDay: false,
    });
  });

  it("shows a midnight-crossing run on both days and says so on each half", () => {
    const [before] = days[1].lines.slice(-1);
    const [after] = days[0].lines;
    expect(before).toMatchObject({ end: "24:00", intoNextDay: true, approximateEnd: false });
    expect(after).toMatchObject({
      start: "00:00",
      end: "00:45",
      fromPreviousDay: true,
      approximateEnd: true,
      durationSeconds: 2_700,
    });
    // The line ids are the strip's segment ids, so a tapped bar finds its line.
    expect(rows[0].segments.map((segment) => segment.id)).toContain(after.id);
  });

  it("formats local clock values with an optional seconds part", () => {
    expect(formatActivityClock("2026-08-29T21:30:15.000Z", "Europe/Berlin")).toBe("23:30");
    expect(formatActivityClock("2026-08-29T21:30:15.000Z", "Europe/Berlin", true)).toBe("23:30:15");
    expect(formatActivityClock("2026-08-29T22:05:00.000Z", "America/Chicago")).toBe("17:05");
  });
});

describe("timeline axis for a measured track", () => {
  it("picks the densest tick set whose labels fit, and shortens them on a phone", () => {
    const labels = (width: number | null) => activityAxisTicks(width).map((tick) => tick.label);
    // Not measured yet (or no layout engine): the full two-hour axis.
    expect(labels(null)).toHaveLength(13);
    expect(labels(null)[0]).toBe("00:00");
    expect(labels(900)).toHaveLength(13);
    // A 1440px desktop with the rail open: every two hours, still 13.
    expect(labels(822)).toHaveLength(13);
    expect(labels(822)[12]).toBe("24:00");
    expect(labels(360)).toEqual(["00:00", "04:00", "08:00", "12:00", "16:00", "20:00", "24:00"]);
    // The first and last labels are anchored to the track's ends, not centred on
    // their tick, so a step has to hold one and a half labels plus the gap: at
    // 300px the four-hour step (50px) is too tight for "HH:00" and the axis
    // falls back to six hours; 240px still carries the minutes, 200px does not.
    expect(labels(300)).toEqual(["00:00", "06:00", "12:00", "18:00", "24:00"]);
    expect(labels(240)).toEqual(["00:00", "06:00", "12:00", "18:00", "24:00"]);
    expect(labels(200)).toEqual(["00", "06", "12", "18", "24"]);
    // A 412px phone leaves the track 164px: five full labels would overlap by
    // 8px at the ends ("00:006:00"), so the short form it is.
    expect(labels(164)).toEqual(["00", "06", "12", "18", "24"]);
    expect(labels(150)).toEqual(["00", "06", "12", "18", "24"]);
    expect(activityAxisTicks(150).map((tick) => tick.hour)).toEqual([0, 6, 12, 18, 24]);
    // The track's guide lines follow the ticks.
    expect(activityGridStep(activityAxisTicks(150))).toBe("25%");
    expect(activityGridStep(activityAxisTicks(900))).toBe(`${100 / 12}%`);
  });

  it("only labels a bar that has the pixels for its start time", () => {
    expect(activitySegmentLabelFits(9, null)).toBe(true);
    expect(activitySegmentLabelFits(8, null)).toBe(false);
    expect(activitySegmentLabelFits(30, 100)).toBe(false);
    expect(activitySegmentLabelFits(50, 100)).toBe(true);
  });

  it("hangs a bar from the nearer end of the track so its floor never leaves it", () => {
    // Morning: from the left, as before.
    expect(activitySegmentPlacement({ leftPercent: 10, widthPercent: 20 })).toEqual({
      left: "10%",
      width: "20%",
    });
    // 23:30–00:00: from the right edge, so a 6px floor on a 2.9px bar grows inwards.
    expect(activitySegmentPlacement({ leftPercent: 97.916, widthPercent: 2.084 })).toEqual({
      right: "0%",
      width: "2.084%",
    });
    // 18:00–19:00: right half, hung 20% from the right.
    expect(activitySegmentPlacement({ leftPercent: 75, widthPercent: 5 })).toEqual({
      right: "20%",
      width: "5%",
    });
    // A bar straddling noon keeps its left anchor.
    expect(activitySegmentPlacement({ leftPercent: 40, widthPercent: 20 })).toEqual({
      left: "40%",
      width: "20%",
    });
  });

  it("formats a row date in full or as weekday and day", () => {
    expect(formatActivityDate("2026-09-17")).toBe("Thu, 17 Sept 2026");
    expect(formatActivityDate("2026-09-17", true)).toBe("Thu 17");
    expect(formatActivityDate("2026-10-05", true)).toBe("Mon 05");
  });
});
