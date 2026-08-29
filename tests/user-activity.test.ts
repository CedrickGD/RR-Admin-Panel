import { afterEach, describe, expect, it, vi } from "vitest";

import { loadUserActivity } from "../functions/_lib/activity";
import type { RuntimeEnv } from "../functions/_lib/types";
import { createMockD1 } from "./helpers/mock-d1";

const IDENTITY = "activity-user";

function session(
  startedAt: string,
  endedAt: string | null,
  timezone = "Europe/Berlin",
  lastEvent = endedAt ? "session_end" : "heartbeat",
) {
  return {
    started_at: startedAt,
    ended_at: endedAt,
    last_seen_at: endedAt ?? startedAt,
    is_active: endedAt ? 0 : 1,
    last_event: lastEvent,
    client_timezone: timezone,
  };
}

function identitySummary(
  firstSeen: string | null = null,
  legacyRows = 0,
  legacyLastSeen: string | null = null,
) {
  return {
    legacy_rows: legacyRows,
    first_seen: firstSeen,
    legacy_last_seen: legacyLastSeen,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("user activity payload", () => {
  it("uses local calendar-day boundaries and returns exact intervals", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T12:00:00.000Z"));

    const mock = createMockD1({
      all: [
        {
          match: /ORDER BY started_at DESC LIMIT 20001/,
          result: {
            // The DB query is newest-first.
            results: [
              session("2026-08-30T06:07:00.000Z", "2026-08-30T07:42:00.000Z"),
              session("2026-08-29T21:30:00.000Z", "2026-08-29T22:30:00.000Z"),
              // 22:00Z is local midnight; this one is outside today.
              session("2026-08-29T20:00:00.000Z", "2026-08-29T21:00:00.000Z"),
            ],
          },
        },
      ],
      first: [
        {
          match: /SUM\(CASE WHEN session_id LIKE 'install:%'/,
          result: identitySummary(),
        },
      ],
    });

    const payload = await loadUserActivity({ DB: mock.db } satisfies RuntimeEnv, IDENTITY, 1);

    expect(payload.timezone).toBe("Europe/Berlin");
    expect(payload.days).toEqual([{ date: "2026-08-30", seconds: 7_500, sessions: 2 }]);
    expect(payload.totalSeconds).toBe(7_500);
    expect(payload.totalSeconds).toBe(payload.days.reduce((sum, day) => sum + day.seconds, 0));
    expect(payload.intervals).toEqual([
      {
        startedAt: "2026-08-29T22:00:00.000Z",
        endedAt: "2026-08-29T22:30:00.000Z",
        approximateEnd: false,
      },
      {
        startedAt: "2026-08-30T06:07:00.000Z",
        endedAt: "2026-08-30T07:42:00.000Z",
        approximateEnd: false,
      },
    ]);
  });

  it("merges overlaps and marks a heartbeat-derived end as approximate", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T18:00:00.000Z"));

    const mock = createMockD1({
      all: [
        {
          match: /ORDER BY started_at DESC LIMIT 20001/,
          result: {
            results: [
              {
                ...session("2026-08-30T10:30:00.000Z", null),
                last_seen_at: "2026-08-30T11:30:00.000Z",
              },
              session("2026-08-30T10:00:00.000Z", "2026-08-30T11:00:00.000Z"),
            ],
          },
        },
      ],
      first: [
        {
          match: /SUM\(CASE WHEN session_id LIKE 'install:%'/,
          result: identitySummary(),
        },
      ],
    });

    const payload = await loadUserActivity({ DB: mock.db } satisfies RuntimeEnv, IDENTITY, 7);

    expect(payload.intervals).toEqual([
      {
        startedAt: "2026-08-30T10:00:00.000Z",
        endedAt: "2026-08-30T11:30:00.000Z",
        approximateEnd: true,
      },
    ]);
    expect(payload.totalSeconds).toBe(5_400);
  });

  it("falls back from an invalid latest timezone to the next valid one", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T18:00:00.000Z"));

    const mock = createMockD1({
      all: [
        {
          match: /ORDER BY started_at DESC LIMIT 20001/,
          result: {
            results: [
              session("2026-08-30T12:00:00.000Z", "2026-08-30T13:00:00.000Z", "Not/A_Timezone"),
              session("2026-08-29T12:00:00.000Z", "2026-08-29T13:00:00.000Z", "Asia/Kathmandu"),
            ],
          },
        },
      ],
      first: [
        {
          match: /SUM\(CASE WHEN session_id LIKE 'install:%'/,
          result: identitySummary(),
        },
      ],
    });

    const payload = await loadUserActivity({ DB: mock.db } satisfies RuntimeEnv, IDENTITY, 7);

    expect(payload.timezone).toBe("Asia/Kathmandu");
  });

  it("distinguishes a lazily expired crash from an explicit session end", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T18:00:00.000Z"));

    const autoExpired = {
      ...session("2026-08-30T08:00:00.000Z", "2026-08-30T09:00:00.000Z", "UTC", "heartbeat"),
      // expireStaleSessionsD1 copies last_seen_at into ended_at while leaving
      // the actual last telemetry event untouched.
      last_seen_at: "2026-08-30T09:00:00.000Z",
      is_active: 0,
    };
    const explicitEnd = session(
      "2026-08-30T10:00:00.000Z",
      "2026-08-30T11:00:00.000Z",
      "UTC",
      "session_end",
    );
    const explicitEndWithLateEvent = {
      ...session("2026-08-30T12:00:00.000Z", "2026-08-30T13:00:00.000Z", "UTC", "app_error"),
      // A late non-end event can advance last_seen_at while the recorded
      // explicit end remains unchanged. That endpoint is still exact.
      last_seen_at: "2026-08-30T13:05:00.000Z",
    };
    const mock = createMockD1({
      all: [
        {
          match: /ORDER BY started_at DESC LIMIT 20001/,
          result: { results: [explicitEndWithLateEvent, explicitEnd, autoExpired] },
        },
      ],
      first: [
        {
          match: /SUM\(CASE WHEN session_id LIKE 'install:%'/,
          result: identitySummary("2026-08-30T08:00:00.000Z"),
        },
      ],
    });

    const payload = await loadUserActivity({ DB: mock.db } satisfies RuntimeEnv, IDENTITY, 1);

    expect(payload.intervals).toEqual([
      {
        startedAt: "2026-08-30T08:00:00.000Z",
        endedAt: "2026-08-30T09:00:00.000Z",
        approximateEnd: true,
      },
      {
        startedAt: "2026-08-30T10:00:00.000Z",
        endedAt: "2026-08-30T11:00:00.000Z",
        approximateEnd: false,
      },
      {
        startedAt: "2026-08-30T12:00:00.000Z",
        endedAt: "2026-08-30T13:00:00.000Z",
        approximateEnd: false,
      },
    ]);
  });

  it.each([
    ["America/Havana", "2026-03-08", "2026-03-08T05:00:00.000Z"],
    ["America/Santiago", "2026-09-06", "2026-09-06T04:00:00.000Z"],
    ["Atlantic/Azores", "2026-03-29", "2026-03-29T01:00:00.000Z"],
  ])(
    "clips %s activity at the first valid instant of its midnight-DST date",
    async (timezone, localDate, boundary) => {
      vi.useFakeTimers();
      const boundaryMs = Date.parse(boundary);
      vi.setSystemTime(new Date(boundaryMs + 12 * 60 * 60 * 1000));
      const start = new Date(boundaryMs - 60 * 60 * 1000).toISOString();
      const end = new Date(boundaryMs + 60 * 60 * 1000).toISOString();
      const mock = createMockD1({
        all: [
          {
            match: /ORDER BY started_at DESC LIMIT 20001/,
            result: { results: [session(start, end, timezone)] },
          },
        ],
        first: [
          {
            match: /SUM\(CASE WHEN session_id LIKE 'install:%'/,
            result: identitySummary(start),
          },
        ],
      });

      const payload = await loadUserActivity({ DB: mock.db } satisfies RuntimeEnv, IDENTITY, 1);

      expect(payload.days).toEqual([{ date: localDate, seconds: 3_600, sessions: 1 }]);
      expect(payload.intervals).toEqual([
        {
          startedAt: boundary,
          endedAt: end,
          approximateEnd: false,
        },
      ]);
    },
  );

  it("keeps true lifetime firstSeen when the interval query reaches its 20k cap", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T18:00:00.000Z"));
    const cappedRows = Array.from({ length: 20_001 }, () =>
      session("2026-08-30T12:00:00.000Z", "2026-08-30T12:00:00.000Z", "UTC"),
    );
    const mock = createMockD1({
      all: [
        {
          match: /ORDER BY started_at DESC LIMIT 20001/,
          result: { results: cappedRows },
        },
      ],
      first: [
        {
          match: /SUM\(CASE WHEN session_id LIKE 'install:%'/,
          result: identitySummary("2024-01-02T03:04:05.000Z"),
        },
      ],
    });

    const payload = await loadUserActivity({ DB: mock.db } satisfies RuntimeEnv, IDENTITY, null);

    expect(payload.intervalsComplete).toBe(false);
    expect(payload.firstSeen).toBe("2024-01-02T03:04:05.000Z");
    expect(
      mock.operations.some(
        (operation) =>
          operation.kind === "first" &&
          operation.normalizedSql.includes("MIN(started_at) AS first_seen") &&
          !operation.normalizedSql.includes("LIMIT 20001"),
      ),
    ).toBe(true);
  });
});
