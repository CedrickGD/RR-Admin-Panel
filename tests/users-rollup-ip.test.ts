import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadUsersRollup } from "../functions/_lib/stats";
import { createTelemetryTestDb, type TelemetryTestDb } from "./helpers/telemetry-db";

/*
 * The customer rollup carries the newest session's client IP and how many distinct
 * addresses an identity was seen from — on the real SQLite stack rr-api runs, because
 * the query leans on window functions and COUNT(DISTINCT) that the recorded-SQL mock
 * cannot answer.
 */

const HWID_HOME = "A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1";
const HWID_ROAM = "B2B2B2B2B2B2B2B2B2B2B2B2B2B2B2B2";
const INSTALL_LEGACY = "3d8c2f1a-7b6e-4c5d-9a0f-1e2d3c4b5a69";

const NO_FILTERS = { rangeDays: null, version: null, platform: null, country: null };

let db: TelemetryTestDb;

beforeEach(() => {
  db = createTelemetryTestDb();
});

afterEach(() => {
  db.close();
});

interface SessionSeed {
  hwid?: string | null;
  installId?: string;
  ip: string | null;
  startedAt: string;
  lastSeenAt?: string;
  country?: string | null;
  city?: string | null;
}

let sequence = 0;

function insertSession(seed: SessionSeed) {
  sequence += 1;
  const lastSeen = seed.lastSeenAt ?? seed.startedAt;
  db.handle
    .prepare(
      `INSERT INTO app_sessions (session_id, install_id, hwid, source, client_ip, client_country, client_city,
                                 app_version, started_at, last_seen_at, ended_at, duration_seconds,
                                 is_active, last_event, last_status, error_count, updated_at)
       VALUES (?, ?, ?, 'desktop-app', ?, ?, ?, '1.5.3', ?, ?, ?, 60, 0, 'session_end', 'ok', 0, ?)`,
    )
    .run(
      `s-${sequence}`,
      seed.installId ?? `inst-${seed.hwid ?? sequence}`,
      seed.hwid === undefined ? `HW-${sequence}` : seed.hwid,
      seed.ip,
      seed.country ?? null,
      seed.city ?? null,
      seed.startedAt,
      lastSeen,
      lastSeen,
      lastSeen,
    );
}

describe("customer rollup client IPs", () => {
  it("reports the newest session's IP and the number of distinct addresses", async () => {
    // Three sessions from two addresses; the newest one is from the second address.
    insertSession({ hwid: HWID_HOME, ip: "203.0.113.10", startedAt: "2026-09-01T10:00:00.000Z" });
    insertSession({ hwid: HWID_HOME, ip: "203.0.113.10", startedAt: "2026-09-05T10:00:00.000Z" });
    insertSession({
      hwid: HWID_HOME,
      ip: "198.51.100.7",
      startedAt: "2026-09-12T10:00:00.000Z",
      country: "DE",
      city: "Berlin",
    });
    // A second customer seen from four addresses, IPv6 among them.
    insertSession({ hwid: HWID_ROAM, ip: "192.0.2.1", startedAt: "2026-08-01T10:00:00.000Z" });
    insertSession({ hwid: HWID_ROAM, ip: "192.0.2.2", startedAt: "2026-08-02T10:00:00.000Z" });
    insertSession({ hwid: HWID_ROAM, ip: "192.0.2.3", startedAt: "2026-08-03T10:00:00.000Z" });
    insertSession({
      hwid: HWID_ROAM,
      ip: "2001:db8:85a3::8a2e:370:7334",
      startedAt: "2026-08-04T10:00:00.000Z",
    });

    const users = await loadUsersRollup(db.env, NO_FILTERS);
    const home = users.find((user) => user.identity === HWID_HOME);
    const roam = users.find((user) => user.identity === HWID_ROAM);

    expect(home).toMatchObject({
      lastIp: "198.51.100.7",
      ipCount: 2,
      sessions: 3,
      country: "DE",
      city: "Berlin",
    });
    expect(roam).toMatchObject({
      lastIp: "2001:db8:85a3::8a2e:370:7334",
      ipCount: 4,
      sessions: 4,
    });
  });

  it("keeps the rollup honest for identities that never carried an address", async () => {
    // Legacy rows predate IP capture: NULL, and an empty string from a proxy that sent none.
    insertSession({
      hwid: null,
      installId: INSTALL_LEGACY,
      ip: null,
      startedAt: "2026-03-01T10:00:00.000Z",
    });
    insertSession({
      hwid: null,
      installId: INSTALL_LEGACY,
      ip: "",
      startedAt: "2026-03-02T10:00:00.000Z",
    });

    const users = await loadUsersRollup(db.env, NO_FILTERS);
    const legacy = users.find((user) => user.identity === INSTALL_LEGACY);

    expect(legacy).toMatchObject({ lastIp: null, ipCount: 0, sessions: 2 });
  });

  it("takes the IP from the same newest session the version and location come from", async () => {
    // Rows inserted out of order: last_seen_at decides, not insertion order or started_at.
    insertSession({
      hwid: HWID_HOME,
      ip: "198.51.100.9",
      startedAt: "2026-09-10T10:00:00.000Z",
      lastSeenAt: "2026-09-14T09:00:00.000Z",
      country: "AT",
      city: "Vienna",
    });
    insertSession({
      hwid: HWID_HOME,
      ip: "203.0.113.44",
      startedAt: "2026-09-11T10:00:00.000Z",
      lastSeenAt: "2026-09-11T11:00:00.000Z",
      country: "DE",
      city: "Berlin",
    });

    const [user] = await loadUsersRollup(db.env, NO_FILTERS);
    expect(user).toMatchObject({
      identity: HWID_HOME,
      lastIp: "198.51.100.9",
      country: "AT",
      city: "Vienna",
      lastSeen: "2026-09-14T09:00:00.000Z",
      ipCount: 2,
    });
  });
});
