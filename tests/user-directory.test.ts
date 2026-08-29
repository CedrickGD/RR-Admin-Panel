import { describe, expect, it } from "vitest";

import type { UserRollupRecord } from "../src/types/telemetry";
import { paginate } from "../src/utils/pagination";
import { buildUserDirectoryOptions, filterAndSortUsers } from "../src/utils/userDirectory";

const NO_FILTERS = { version: null, continent: null, country: null };

function user(identity: string, overrides: Partial<UserRollupRecord> = {}): UserRollupRecord {
  return {
    identity,
    userLabel: identity,
    firstSeen: "2026-01-01T00:00:00.000Z",
    lastSeen: "2026-08-30T00:00:00.000Z",
    sessions: 1,
    totalDurationSeconds: 60,
    errors: 0,
    isActive: false,
    licenseTier: "free",
    paidLicenseKeys: [],
    suspension: null,
    hwid: identity,
    appVersion: "1.4.9",
    displayVersion: "1.4.9",
    platform: "winui",
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
    ...overrides,
  };
}

describe("user directory filters and sorting", () => {
  it("sorts user, Discord, and semantic version text naturally", () => {
    const users = [
      user("id-10", {
        userLabel: "User 10",
        discordUser: null,
        appVersion: "1.4.10",
        displayVersion: "1.4.10",
      }),
      user("id-2", {
        userLabel: "user 2",
        discordUser: "@Beta",
        appVersion: "1.4.9",
        displayVersion: "1.4.9",
      }),
      user("id-1", {
        userLabel: "Alice",
        discordUser: "alpha",
        appVersion: "legacy",
        displayVersion: "legacy",
      }),
    ];

    expect(
      filterAndSortUsers(users, "", NO_FILTERS, "user", "asc").map((entry) => entry.userLabel),
    ).toEqual(["Alice", "user 2", "User 10"]);
    expect(
      filterAndSortUsers(users, "", NO_FILTERS, "discord", "asc").map((entry) => entry.identity),
    ).toEqual(["id-1", "id-2", "id-10"]);
    expect(
      filterAndSortUsers(users, "", NO_FILTERS, "version", "desc").map(
        (entry) => entry.displayVersion,
      ),
    ).toEqual(["legacy", "1.4.10", "1.4.9"]);
  });

  it("keeps missing alphabetical values last in both directions", () => {
    const users = [
      user("missing", { discordUser: null }),
      user("alpha", { discordUser: "alpha" }),
      user("zulu", { discordUser: "zulu" }),
    ];

    expect(
      filterAndSortUsers(users, "", NO_FILTERS, "discord", "asc").map((entry) => entry.identity),
    ).toEqual(["alpha", "zulu", "missing"]);
    expect(
      filterAndSortUsers(users, "", NO_FILTERS, "discord", "desc").map((entry) => entry.identity),
    ).toEqual(["zulu", "alpha", "missing"]);
  });

  it("sorts locations by the visible city-first label", () => {
    const users = [
      user("zurich", { city: "Zurich", country: "DE" }),
      user("austin", { city: "Austin", country: "US" }),
    ];

    expect(
      filterAndSortUsers(users, "", NO_FILTERS, "location", "asc").map((entry) => entry.identity),
    ).toEqual(["austin", "zurich"]);
  });

  it("filters canonical country aliases and continent before pagination", () => {
    const users = [
      user("germany", { country: "DE", city: "Berlin" }),
      user("britain", { country: "United Kingdom", city: "London" }),
      user("usa", { country: "USA", city: "Austin" }),
    ];
    const options = buildUserDirectoryOptions(users, "Europe");

    expect(options.continents).toEqual(["Europe", "North America"]);
    expect(options.countries.map((option) => option.label)).toEqual(["Germany", "United Kingdom"]);

    const filtered = filterAndSortUsers(
      users,
      "",
      { version: null, continent: "Europe", country: "GB" },
      "location",
      "asc",
    );
    expect(filtered.map((entry) => entry.identity)).toEqual(["britain"]);
    expect(paginate(filtered, 1, 100).total).toBe(1);
  });

  it("searches normalized Discord, country labels, continents, and identity", () => {
    const users = [
      user("ABC-123", {
        userLabel: "Cedri",
        discordUser: "@RPG_01",
        country: "DE",
      }),
    ];

    for (const query of ["rpg_01", "germany", "europe", "abc-123"]) {
      expect(filterAndSortUsers(users, query, NO_FILTERS, "user", "asc")).toHaveLength(1);
    }
  });
});
