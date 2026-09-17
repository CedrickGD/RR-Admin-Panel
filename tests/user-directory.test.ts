import { describe, expect, it, vi } from "vitest";

import type { UserRollupRecord } from "../src/types/telemetry";
import { formatDate, formatDay } from "../src/utils/format";
import { paginate } from "../src/utils/pagination";
import {
  buildUserDirectoryOptions,
  defaultUserSortDirection,
  directoryStatus,
  filterAndSortUsers,
  needsAttention,
  statusSeverity,
} from "../src/utils/userDirectory";

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

  it("matches uppercase-I machine names regardless of the browser casing locale", () => {
    const users = [user("device-1", { userLabel: "MSI-CG-MAIN" })];
    const originalToLocaleLowerCase = String.prototype.toLocaleLowerCase;
    const localeLowerCase = vi
      .spyOn(String.prototype, "toLocaleLowerCase")
      .mockImplementation(function (this: string, locales?: Intl.LocalesArgument) {
        return originalToLocaleLowerCase.call(this, locales ?? "tr-TR");
      });

    try {
      for (const query of ["msi", "mSi", "MSI-CG-MAIN"]) {
        expect(filterAndSortUsers(users, query, NO_FILTERS, "user", "asc")).toHaveLength(1);
      }
    } finally {
      localeLowerCase.mockRestore();
    }
  });
});

/** The rollup's suspension summary, as the directory row carries it. */
function suspension(
  mode: "ban" | "suspend",
  bannedUntil: string | null,
): NonNullable<UserRollupRecord["suspension"]> {
  return {
    mode,
    reason: null,
    bannedUntil,
    hadPaidLicense: false,
    createdAt: "2026-09-01T00:00:00Z",
  };
}

const UNTIL = "2026-10-01T00:00:00Z";

describe("directory Status column", () => {
  it("sorts by severity: ban, suspension, down, errors, degraded, then nothing wrong", () => {
    const users = [
      user("clear"),
      user("degraded", { lastStatus: "degraded" }),
      user("two-errors", { errors: 2 }),
      user("nine-errors", { errors: 9, lastStatus: "degraded" }),
      user("down", { lastStatus: "down" }),
      user("suspended", { suspension: suspension("suspend", UNTIL) }),
      user("banned", { suspension: suspension("ban", null) }),
    ];
    const order = (direction: "asc" | "desc") =>
      filterAndSortUsers(users, "", NO_FILTERS, "status", direction).map((entry) => entry.identity);

    // Worst first is the default, as for every other non-text column.
    expect(defaultUserSortDirection("status")).toBe("desc");
    expect(order("desc")).toEqual([
      "banned",
      "suspended",
      "down",
      "nine-errors",
      "two-errors",
      "degraded",
      "clear",
    ]);
    expect(order("asc")).toEqual([
      "clear",
      "degraded",
      "two-errors",
      "nine-errors",
      "down",
      "suspended",
      "banned",
    ]);
    // One ranking on the page: "Needs attention" is exactly what the column would badge.
    expect(users.map(needsAttention)).toEqual([false, true, true, true, true, true, true]);
    expect(users.map((entry) => statusSeverity(entry) > 0)).toEqual(users.map(needsAttention));
    // A ban outranks any error count; within a rank the count decides.
    expect(statusSeverity(user("b", { suspension: suspension("ban", null) }))).toBeGreaterThan(
      statusSeverity(user("e", { errors: 5_000_000 })),
    );
    // The count is capped so no error count can climb into the next rank.
    expect(statusSeverity(user("e", { errors: 5_000_000 }))).toBe(
      statusSeverity(user("e", { errors: 999_999 })),
    );
    expect(statusSeverity(user("e", { errors: 999_999 }))).toBeLessThan(
      statusSeverity(user("d", { lastStatus: "down" })),
    );
  });

  it("words the cell: a badge for what is wrong, the two full lines behind it", () => {
    expect(directoryStatus(user("clear"))).toMatchObject({
      flags: [],
      access: "No restriction reported",
      support: "No errors reported",
      summary: "App access: No restriction reported\nSupport: No errors reported",
      severity: 0,
    });
    // No access information in the rollup at all is not "no restriction".
    expect(directoryStatus(user("unknown", { suspension: undefined })).access).toBe("Not reported");

    const banned = directoryStatus(
      user("banned", { suspension: suspension("ban", null), errors: 1, lastStatus: "down" }),
    );
    expect(banned.flags).toEqual([
      { line: "access", label: "Banned", tone: "danger", title: null },
      { line: "support", label: "1 error", tone: "warning", title: "Last status down" },
    ]);
    expect(banned.summary).toBe("App access: Banned\nSupport: 1 error, last status down");

    const timed = directoryStatus(
      user("timed", { suspension: suspension("suspend", UNTIL), lastStatus: "degraded" }),
    );
    expect(timed.flags.map((flag) => [flag.label, flag.tone])).toEqual([
      [`Suspended until ${formatDay(UNTIL)}`, "warning"],
      ["Degraded", "warning"],
    ]);
    expect(timed.flags[0]?.title).toBe(`Lifts automatically on ${formatDate(UNTIL)}`);
    expect(timed.support).toBe("Last status degraded");

    expect(
      directoryStatus(user("open", { suspension: suspension("suspend", null) })).flags,
    ).toEqual([{ line: "access", label: "Suspended", tone: "warning", title: null }]);
    expect(directoryStatus(user("down", { lastStatus: "down" })).flags).toEqual([
      { line: "support", label: "Down", tone: "danger", title: null },
    ]);
    expect(directoryStatus(user("many", { errors: 1234 })).flags[0]?.label).toBe("1,234 errors");
  });
});
