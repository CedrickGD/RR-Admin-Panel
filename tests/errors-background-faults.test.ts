import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadErrorsByUser, parseErrorsRange } from "../functions/_lib/errors";
import {
  backgroundFault,
  createTelemetryTestDb,
  realError,
  type TelemetryTestDb,
} from "./helpers/telemetry-db";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const range = (key: string) => parseErrorsRange(new URL(`http://panel.test/?range=${key}`));

let db: TelemetryTestDb;

beforeEach(() => {
  db = createTelemetryTestDb();
});

afterEach(() => {
  db.close();
});

describe("errors payload: background faults", () => {
  it("groups background events by code + base exception type with installs, sessions and versions", async () => {
    db.insertEvents([
      backgroundFault(ago(1 * HOUR), {
        base_exception_type: "System.NullReferenceException",
        hwid: "HW-A",
        install_id: "inst-a",
        session_id: "s-1",
        app_version: "1.4.8.11",
      }),
      backgroundFault(ago(2 * HOUR), {
        base_exception_type: "System.NullReferenceException",
        hwid: "HW-A",
        install_id: "inst-a",
        session_id: "s-1",
        app_version: "1.4.8.11",
      }),
      // No hwid: the install id is the identity, like in the customer rollup.
      backgroundFault(ago(3 * HOUR), {
        base_exception_type: "System.NullReferenceException",
        install_id: "inst-b",
        session_id: "s-2",
        app_version: "1.5.2",
      }),
      backgroundFault(ago(30 * MINUTE), {
        base_exception_type: "System.NullReferenceException",
        hwid: "HW-A",
        install_id: "inst-a2",
        session_id: "s-3",
        app_version: "1.4.9",
      }),
      backgroundFault(ago(10 * MINUTE), {
        base_exception_type: "System.Net.Sockets.SocketException",
        hwid: "HW-C",
        session_id: "s-4",
        app_version: "1.5.2",
      }),
      // No base type: falls back to exception_type.
      backgroundFault(ago(40 * MINUTE), {
        exception_type: "System.IO.IOException",
        hwid: "HW-C",
        session_id: "s-4",
        app_version: "1.5.2",
      }),
      // Outside the 24 h range, and far in the future: both excluded.
      backgroundFault(ago(30 * HOUR), {
        base_exception_type: "System.NullReferenceException",
        hwid: "HW-OLD",
        session_id: "s-old",
      }),
      backgroundFault(new Date(NOW + 5 * 24 * HOUR).toISOString(), {
        base_exception_type: "System.NullReferenceException",
        hwid: "HW-FUTURE",
        session_id: "s-future",
      }),
      realError(ago(20 * MINUTE), { hwid: "HW-D", session_id: "s-5", app_version: "1.5.2" }),
    ]);

    const payload = await loadErrorsByUser(db.env, range("24h"));

    expect(payload.backgroundFaults).toEqual([
      {
        code: "RR-E1003",
        exceptionType: "System.NullReferenceException",
        events: 4,
        installs: 2,
        sessions: 3,
        versions: ["1.5.2", "1.4.9", "1.4.8.11"],
        firstSeen: ago(3 * HOUR),
        lastSeen: ago(30 * MINUTE),
      },
      {
        code: "RR-E1003",
        exceptionType: "System.Net.Sockets.SocketException",
        events: 1,
        installs: 1,
        sessions: 1,
        versions: ["1.5.2"],
        firstSeen: ago(10 * MINUTE),
        lastSeen: ago(10 * MINUTE),
      },
      {
        code: "RR-E1003",
        exceptionType: "System.IO.IOException",
        events: 1,
        installs: 1,
        sessions: 1,
        versions: ["1.5.2"],
        firstSeen: ago(40 * MINUTE),
        lastSeen: ago(40 * MINUTE),
      },
    ]);
    expect(payload.backgroundFaultsTruncated).toBe(false);
    expect(payload.totals.backgroundErrors).toBe(6);

    // Real errors stay separate: one customer, one error, no background rows attached.
    expect(payload.totals.errors).toBe(1);
    expect(payload.totals.affectedUsers).toBe(1);
    expect(payload.users.map((user) => user.identity)).toEqual(["HW-D"]);
    expect(payload.users[0].events.map((event) => event.kind)).toEqual(["unhandled"]);
  });

  it("covers the whole retained history on range=all", async () => {
    db.insertEvents([
      backgroundFault(ago(30 * 24 * HOUR), {
        base_exception_type: "System.IOException",
        hwid: "HW-1",
      }),
      backgroundFault(ago(1 * HOUR), { base_exception_type: "System.IOException", hwid: "HW-2" }),
    ]);

    const payload = await loadErrorsByUser(db.env, range("all"));

    expect(payload.backgroundFaults).toHaveLength(1);
    expect(payload.backgroundFaults[0]).toMatchObject({ events: 2, installs: 2 });
  });

  it("reports calm totals when a range holds background faults only", async () => {
    db.insertEvents(
      Array.from({ length: 30 }, (_, index) =>
        backgroundFault(ago((index + 1) * MINUTE), {
          base_exception_type: "System.NullReferenceException",
          hwid: "HW-LOOP",
          session_id: "s-loop",
        }),
      ),
    );

    const payload = await loadErrorsByUser(db.env, range("24h"));

    expect(payload.users).toEqual([]);
    expect(payload.totals).toEqual({
      errors: 0,
      backgroundErrors: 30,
      affectedUsers: 0,
      lastErrorAt: null,
    });
    expect(payload.scanTruncated).toBe(false);
    expect(payload.backgroundFaults[0]).toMatchObject({ events: 30, installs: 1, sessions: 1 });
  });

  it("caps the shipped groups but keeps the totals over every group", async () => {
    db.insertEvents(
      Array.from({ length: 55 }, (_, index) =>
        backgroundFault(ago((index + 1) * MINUTE), {
          error_code: `RR-E${2000 + index}`,
          base_exception_type: "System.InvalidOperationException",
          hwid: `HW-${index}`,
        }),
      ),
    );

    const payload = await loadErrorsByUser(db.env, range("24h"));

    expect(payload.backgroundFaults).toHaveLength(50);
    expect(payload.backgroundFaultsTruncated).toBe(true);
    expect(payload.totals.backgroundErrors).toBe(55);
  });

  it("binds a JS-computed cutoff instead of SQLite's datetime('now')", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../functions/_lib/errors.ts", import.meta.url)),
      "utf8",
    );
    expect(source).not.toMatch(/datetime\(|strftime\(|'now'/);
  });
});
