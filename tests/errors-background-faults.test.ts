import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadErrorsByUser, parseErrorsRange } from "../functions/_lib/errors";
import { MAX_FAULTS_PER_REPORT, readBackgroundFaultReport } from "../shared/telemetry-contract";
import {
  backgroundFault,
  backgroundReport,
  createTelemetryTestDb,
  realError,
  type TelemetryTestDb,
} from "./helpers/telemetry-db";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const range = (key: string) => parseErrorsRange(new URL(`http://panel.test/?range=${key}`));

/** What every group from a client before 1.5.3 looks like: no frame, no source, one fault per row. */
const LEGACY_GROUP = {
  code: "RR-E1003",
  faultSource: "unobserved_task",
  topFrame: null,
  topFrames: null,
  stoppedSessions: 0,
};

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
        ...LEGACY_GROUP,
        exceptionType: "System.NullReferenceException",
        events: 4,
        reports: 4,
        installs: 2,
        sessions: 3,
        versions: ["1.5.2", "1.4.9", "1.4.8.11"],
        firstSeen: ago(3 * HOUR),
        lastSeen: ago(30 * MINUTE),
      },
      {
        ...LEGACY_GROUP,
        exceptionType: "System.Net.Sockets.SocketException",
        events: 1,
        reports: 1,
        installs: 1,
        sessions: 1,
        versions: ["1.5.2"],
        firstSeen: ago(10 * MINUTE),
        lastSeen: ago(10 * MINUTE),
      },
      {
        ...LEGACY_GROUP,
        exceptionType: "System.IO.IOException",
        events: 1,
        reports: 1,
        installs: 1,
        sessions: 1,
        versions: ["1.5.2"],
        firstSeen: ago(40 * MINUTE),
        lastSeen: ago(40 * MINUTE),
      },
    ]);
    expect(payload.backgroundFaultsTruncated).toBe(false);
    expect(payload.totals.backgroundErrors).toBe(6);
    expect(payload.totals.backgroundSuppressed).toBe(0);

    // Real errors stay separate: one customer, one error, no background rows attached.
    expect(payload.totals.errors).toBe(1);
    expect(payload.totals.affectedUsers).toBe(1);
    expect(payload.users.map((user) => user.identity)).toEqual(["HW-D"]);
    expect(payload.users[0].events.map((event) => event.kind)).toEqual(["unhandled"]);
  });

  /*
   * The client from 1.5.3 (shared/telemetry-contract.ts): one row per distinct fault and
   * session, 5-minute rollups with the true count in `occurrences`, suppressed Discord-pipe I/O
   * on a row of its own, and the top RazorReaper frame plus fault source on every row. Counting
   * rows would read the change as a 99 % fix on day one.
   */
  it("counts faults as SUM(occurrences) and groups by fault source and top frame", async () => {
    const TASK_FRAME = "RazorReaper.Components.Pages.Home.UpdateResources (Home.razor:1394)";
    const TASK_CHAIN_OLDER =
      "Home.UpdateResources (Home.razor:1394) > Home.OnInitializedAsync (Home.razor:889)";
    const TASK_CHAIN_NEWEST =
      "Home.UpdateResources (Home.razor:1394) > Home.RefreshAsync (Home.razor:901)";
    const RENDER_FRAME =
      "RazorReaper.Components.Pages.Server.RefreshVisibleServersAsync (Server.razor:496)";
    const render = (metrics: Record<string, unknown>) => ({
      fault_source: "render_dispatch",
      // The render gate already unwrapped, so exception_type is the leaf type.
      exception_type: "System.NullReferenceException",
      top_frame: RENDER_FRAME,
      top_frames: RENDER_FRAME,
      render_owner: "Server",
      render_origin: "RefreshVisibleServers",
      ...metrics,
    });

    db.insertEvents([
      // Two rows from a client before 1.5.3: no report keys, one fault each.
      backgroundFault(ago(5 * HOUR), {
        base_exception_type: "System.NullReferenceException",
        hwid: "HW-OLD",
        session_id: "s-old",
        app_version: "1.5.2",
      }),
      backgroundFault(ago(4 * HOUR), {
        base_exception_type: "System.NullReferenceException",
        hwid: "HW-OLD",
        session_id: "s-old",
        app_version: "1.5.2",
      }),
      // An unobserved-task fault: first sighting, then a rollup of 412 repeats. The first row
      // also carries 5 suppressed aborted-I/O faults from the same flush — a separate count.
      backgroundReport(ago(3 * HOUR), "first", {
        top_frame: TASK_FRAME,
        top_frames: TASK_CHAIN_OLDER,
        occurrences: 3,
        suppressed_aborted_io: 5,
        hwid: "HW-A",
        session_id: "s-a",
      }),
      backgroundReport(ago(2 * HOUR), "rollup", {
        top_frame: TASK_FRAME,
        top_frames: TASK_CHAIN_NEWEST,
        occurrences: 412,
        hwid: "HW-A",
        session_id: "s-a",
      }),
      // Render-dispatch faults on the same base type: two sessions, one of which tripped the
      // breaker (render_stopped) in its rollup.
      backgroundReport(
        ago(90 * MINUTE),
        "first",
        render({ render_stopped: false, hwid: "HW-B", session_id: "s-b" }),
      ),
      backgroundReport(
        ago(80 * MINUTE),
        "rollup",
        render({ occurrences: 9, render_stopped: true, hwid: "HW-B", session_id: "s-b" }),
      ),
      backgroundReport(
        ago(70 * MINUTE),
        "first",
        render({ render_stopped: false, hwid: "HW-C", session_id: "s-c" }),
      ),
      // Suppressed Discord-pipe I/O: occurrences equals suppressed_aborted_io, and it is not a
      // fault — neither a group of its own nor part of the legacy no-frame group.
      backgroundReport(ago(60 * MINUTE), "suppressed", {
        occurrences: 17,
        suppressed_aborted_io: 17,
        hwid: "HW-A",
        session_id: "s-a",
      }),
    ]);

    const payload = await loadErrorsByUser(db.env, range("24h"));

    expect(payload.backgroundFaults).toEqual([
      {
        code: "RR-E1003",
        exceptionType: "System.NullReferenceException",
        faultSource: "unobserved_task",
        topFrame: TASK_FRAME,
        // The chain of the group's newest row.
        topFrames: TASK_CHAIN_NEWEST,
        events: 415,
        reports: 2,
        installs: 1,
        sessions: 1,
        stoppedSessions: 0,
        versions: ["1.5.3"],
        firstSeen: ago(3 * HOUR),
        lastSeen: ago(2 * HOUR),
      },
      {
        code: "RR-E1003",
        exceptionType: "System.NullReferenceException",
        faultSource: "render_dispatch",
        topFrame: RENDER_FRAME,
        topFrames: RENDER_FRAME,
        events: 11,
        reports: 3,
        installs: 2,
        sessions: 2,
        stoppedSessions: 1,
        versions: ["1.5.3"],
        firstSeen: ago(90 * MINUTE),
        lastSeen: ago(70 * MINUTE),
      },
      {
        ...LEGACY_GROUP,
        exceptionType: "System.NullReferenceException",
        events: 2,
        reports: 2,
        installs: 1,
        sessions: 1,
        versions: ["1.5.2"],
        firstSeen: ago(5 * HOUR),
        lastSeen: ago(4 * HOUR),
      },
    ]);
    // 415 + 11 + 2. The suppressed row's 17 are not in it.
    expect(payload.totals.backgroundErrors).toBe(428);
    // 5 piggybacked on the first sighting + 17 on the suppressed row.
    expect(payload.totals.backgroundSuppressed).toBe(22);
    expect(payload.totals.errors).toBe(0);
    expect(payload.users).toEqual([]);
  });

  it("reports suppressed I/O even when the range holds nothing else", async () => {
    db.insertEvents([
      backgroundReport(ago(10 * MINUTE), "suppressed", {
        occurrences: 17,
        suppressed_aborted_io: 17,
        hwid: "HW-A",
        session_id: "s-a",
      }),
    ]);

    const payload = await loadErrorsByUser(db.env, range("24h"));

    expect(payload.backgroundFaults).toEqual([]);
    expect(payload.totals.backgroundErrors).toBe(0);
    expect(payload.totals.backgroundSuppressed).toBe(17);
  });

  it("holds a row's occurrences within [1, MAX_FAULTS_PER_REPORT], like the shared reader", async () => {
    const values: unknown[] = [0, -5, "412", "lots", MAX_FAULTS_PER_REPORT * 10];
    db.insertEvents(
      values.map((occurrences, index) =>
        backgroundReport(ago((index + 1) * MINUTE), "rollup", {
          occurrences,
          hwid: "HW-Z",
          session_id: "s-z",
        }),
      ),
    );

    const payload = await loadErrorsByUser(db.env, range("24h"));

    expect(payload.backgroundFaults).toHaveLength(1);
    // 1 + 1 + 412 + 1 + the cap: a row stands for at least the fault it reports, never more
    // than the bound.
    expect(payload.backgroundFaults[0]).toMatchObject({
      events: 415 + MAX_FAULTS_PER_REPORT,
      reports: 5,
    });
    expect(
      values.map((occurrences) => readBackgroundFaultReport({ occurrences }).occurrences),
    ).toEqual([1, 1, 412, 1, MAX_FAULTS_PER_REPORT]);
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
      backgroundSuppressed: 0,
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
