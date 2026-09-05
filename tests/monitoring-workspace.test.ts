import { describe, expect, it } from "vitest";
import {
  buildMonitoringDirectory,
  compareVersionsNewestFirst,
  isSessionLive,
} from "../src/utils/monitoringDirectory";
import { matchesFeedbackStatus } from "../src/utils/feedbackInbox";
import type { AppSessionRecord, UserRollupRecord } from "../src/types/telemetry";
const now = Date.parse("2026-09-05T12:00:00Z");
const user = {
  identity: "device",
  hwid: "device",
  userLabel: "Existing user",
  firstSeen: "2025-01-01",
  lastSeen: "2026-09-04",
  sessions: 120,
  totalDurationSeconds: 90000,
  errors: 2,
  isActive: false,
  appVersion: null,
  displayVersion: null,
  platform: null,
  osVersion: null,
  deviceModel: null,
  country: null,
  city: null,
  timezone: null,
  rpcEnabled: null,
  discordUser: null,
  latitude: null,
  longitude: null,
  lastStatus: null,
  lastEvent: null,
  features: {},
  recentErrors: [],
} as UserRollupRecord;
const session = {
  id: "run",
  installId: "install",
  hwid: "device",
  userLabel: "Existing user",
  startedAt: "2026-09-05T11:00:00Z",
  lastSeenAt: "2026-09-05T11:59:00Z",
  endedAt: null,
  isActive: true,
  durationSeconds: 3540,
  errorCount: 0,
  appVersion: "1.5.0",
  lastStatus: "ok",
} as AppSessionRecord;
describe("unified monitoring directory", () => {
  it("keeps lifetime users and totals while updating current session metadata", () => {
    const old = { ...user, identity: "offline", hwid: "offline" };
    const rows = buildMonitoringDirectory([user, old], [session], now);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      sessions: 120,
      totalDurationSeconds: 90000,
      isActive: true,
      appVersion: "1.5.0",
    });
    expect(rows[1].identity).toBe("offline");
  });
  it("includes a new live user before the lifetime rollup catches up", () => {
    const rows = buildMonitoringDirectory([], [session], now);
    expect(rows[0]).toMatchObject({ identity: "device", sessions: 1, isActive: true });
  });
  it("does not consider stale or ended sessions online", () => {
    expect(isSessionLive({ ...session, lastSeenAt: "2026-09-05T11:50:00Z" }, now)).toBe(false);
    expect(isSessionLive({ ...session, endedAt: "2026-09-05T11:59:00Z" }, now)).toBe(false);
  });
  it("shows newest real versions above legacy and unknown versions", () => {
    expect(
      ["legacy", "1.4.9", "Unknown", "1.5.0", "1.4.10"].sort(compareVersionsNewestFirst),
    ).toEqual(["1.5.0", "1.4.10", "1.4.9", "Unknown", "legacy"]);
  });
});
describe("feedback inbox", () => {
  it("moves archived messages out of Inbox, New and Read, into Archived", () => {
    expect(matchesFeedbackStatus("archived", "all")).toBe(false);
    expect(matchesFeedbackStatus("archived", "new")).toBe(false);
    expect(matchesFeedbackStatus("archived", "read")).toBe(false);
    expect(matchesFeedbackStatus("archived", "archived")).toBe(true);
    expect(matchesFeedbackStatus("new", "all")).toBe(true);
    expect(matchesFeedbackStatus("read", "all")).toBe(true);
  });
});
