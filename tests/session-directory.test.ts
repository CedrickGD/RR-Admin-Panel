import { describe, expect, it } from "vitest";

import type { AppSessionRecord } from "../src/types/telemetry";
import {
  buildSessionDirectoryOptions,
  filterAndSortSessions,
  normalizeRecentSessions,
} from "../src/utils/sessionDirectory";

const NO_FILTERS = { version: null, continent: null, country: null };

function session(id: string, overrides: Partial<AppSessionRecord> = {}): AppSessionRecord {
  return {
    id,
    installId: `install-${id}`,
    hwid: `hwid-${id}`,
    source: "app",
    userLabel: id,
    clientIp: null,
    clientCountry: null,
    clientCity: null,
    clientRegion: null,
    appVersion: "1.4.9",
    displayVersion: "1.4.9",
    platform: "winui",
    rpcEnabled: null,
    discordUser: null,
    startedAt: "2026-08-30T08:00:00.000Z",
    lastSeenAt: "2026-08-30T09:00:00.000Z",
    endedAt: "2026-08-30T09:00:00.000Z",
    durationSeconds: 3_600,
    isActive: false,
    lastEvent: "session_end",
    lastStatus: "ok",
    errorCount: 0,
    ...overrides,
  };
}

describe("recent session directory", () => {
  it("deduplicates to the newest session per user before sorting", () => {
    const old = session("old", {
      hwid: "same-user",
      lastSeenAt: "2026-08-29T09:00:00.000Z",
    });
    const newest = session("new", {
      hwid: "same-user",
      lastSeenAt: "2026-08-30T09:00:00.000Z",
    });

    expect(
      filterAndSortSessions([old, newest], "", NO_FILTERS, "lastSeen", "desc").map(
        (entry) => entry.id,
      ),
    ).toEqual(["new"]);
  });

  it("builds dropdown options from the same normalized rows shown in the table", () => {
    const old = session("old", {
      hwid: "same-user",
      displayVersion: "legacy",
      clientCountry: "DE",
      lastSeenAt: "2026-08-29T09:00:00.000Z",
    });
    const newest = session("new", {
      hwid: "same-user",
      displayVersion: "1.4.10",
      clientCountry: "US",
      lastSeenAt: "2026-08-30T09:00:00.000Z",
    });
    const installOnly = session("install:synthetic", {
      displayVersion: "phantom",
      clientCountry: "FR",
    });

    expect(normalizeRecentSessions([old, newest, installOnly]).map((entry) => entry.id)).toEqual([
      "new",
    ]);
    expect(buildSessionDirectoryOptions([old, newest, installOnly], null)).toEqual({
      versions: ["1.4.10"],
      continents: ["North America"],
      countries: [{ value: "US", label: "United States" }],
    });
  });

  it("sorts alphabetically with missing Discord values last", () => {
    const sessions = [
      session("missing", { discordUser: null }),
      session("beta", { discordUser: "@Beta" }),
      session("alpha", { discordUser: "alpha" }),
    ];

    expect(
      filterAndSortSessions(sessions, "", NO_FILTERS, "discord", "asc").map((entry) => entry.id),
    ).toEqual(["alpha", "beta", "missing"]);
  });

  it("sorts locations by the visible city-first label", () => {
    const sessions = [
      session("zurich", {
        clientCity: "Zurich",
        clientRegion: "Zurich",
        clientCountry: "DE",
      }),
      session("austin", {
        clientCity: "Austin",
        clientRegion: "Texas",
        clientCountry: "US",
      }),
    ];

    expect(
      filterAndSortSessions(sessions, "", NO_FILTERS, "location", "asc").map((entry) => entry.id),
    ).toEqual(["austin", "zurich"]);
  });

  it("filters version, continent, canonical country, and broad search fields", () => {
    const sessions = [
      session("berlin", {
        userLabel: "Cedri",
        discordUser: "RPG_01",
        clientCountry: "Germany",
        clientCity: "Berlin",
        displayVersion: "1.4.10",
      }),
      session("austin", {
        clientCountry: "US",
        clientCity: "Austin",
      }),
    ];
    const options = buildSessionDirectoryOptions(sessions, "Europe");

    expect(options.countries).toEqual([{ value: "DE", label: "Germany" }]);
    expect(
      filterAndSortSessions(
        sessions,
        "rpg_01",
        { version: "1.4.10", continent: "Europe", country: "DE" },
        "user",
        "asc",
      ).map((entry) => entry.id),
    ).toEqual(["berlin"]);
  });
});
