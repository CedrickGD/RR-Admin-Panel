import { describe, expect, it } from "vitest";

import {
  addCalendarDays,
  buildActivityTimelineRows,
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
