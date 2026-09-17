import type { UserRollupRecord } from "../types/telemetry";
import { formatDate, formatDay, formatNumber } from "./format";
import { formatCountryLabel, getMacroRegion, resolveCountry } from "./geography";

export type UserDirectorySortKey =
  | "user"
  | "discord"
  | "version"
  | "location"
  | "ip"
  | "lastSeen"
  | "firstSeen"
  | "sessions"
  | "totalTime"
  | "status";
export type DirectorySortDirection = "asc" | "desc";

export interface UserDirectoryFilters {
  version: string | null;
  continent: string | null;
  country: string | null;
}

export interface DirectoryOption {
  value: string;
  label: string;
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function parseTimestamp(value: string | null | undefined): number | null {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) ? timestamp : null;
}

function userName(user: UserRollupRecord): string {
  return user.userLabel?.trim() || user.identity;
}

function discordName(user: UserRollupRecord): string | null {
  const value = user.discordUser?.trim().replace(/^@/, "");
  return value || null;
}

function versionName(user: UserRollupRecord): string | null {
  return user.displayVersion?.trim() || user.appVersion?.trim() || null;
}

function countryKey(value: string | null | undefined): string | null {
  const country = resolveCountry(value);
  if (country) return country.code;
  const raw = value?.trim();
  return raw ? raw.toLocaleLowerCase() : null;
}

function locationName(user: UserRollupRecord): string | null {
  const country = user.country?.trim();
  const city = user.city?.trim();
  if (!country && !city) return null;
  return [city, country].filter(Boolean).join(" · ");
}

/** The newest session's client IP, or null for records that never carried one. */
export function lastIpAddress(user: UserRollupRecord): string | null {
  return user.lastIp?.trim() || null;
}

function compareOptionalText(
  left: string | null,
  right: string | null,
  direction: DirectorySortDirection,
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const compared = collator.compare(left, right);
  return direction === "asc" ? compared : -compared;
}

function compareOptionalNumber(
  left: number | null,
  right: number | null,
  direction: DirectorySortDirection,
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const compared = left - right;
  return direction === "asc" ? compared : -compared;
}

function sortValue(user: UserRollupRecord, key: UserDirectorySortKey): string | number | null {
  switch (key) {
    case "user":
      return userName(user);
    case "discord":
      return discordName(user);
    case "version":
      return versionName(user);
    case "location":
      return locationName(user);
    case "ip":
      // The numeric collator orders dotted quads by octet ("10.0.0.2" before "10.0.0.10").
      return lastIpAddress(user);
    case "lastSeen":
      return parseTimestamp(user.lastSeen);
    case "firstSeen":
      return parseTimestamp(user.firstSeen);
    case "sessions":
      return Number.isFinite(user.sessions) ? user.sessions : null;
    case "totalTime":
      return Number.isFinite(user.totalDurationSeconds) ? user.totalDurationSeconds : null;
    case "status":
      return statusSeverity(user);
  }
}

export function defaultUserSortDirection(key: UserDirectorySortKey): DirectorySortDirection {
  return ["user", "discord", "version", "location", "ip"].includes(key) ? "asc" : "desc";
}

export function buildUserDirectoryOptions(
  users: readonly UserRollupRecord[],
  continent: string | null,
): {
  versions: string[];
  continents: string[];
  countries: DirectoryOption[];
} {
  const versions = new Set<string>();
  const continents = new Set<string>();
  const countries = new Map<string, string>();

  for (const user of users) {
    const version = versionName(user);
    if (version) versions.add(version);

    const macroRegion = getMacroRegion(user.country);
    if (macroRegion !== "Unknown") continents.add(macroRegion);
    if (continent && macroRegion !== continent) continue;

    const key = countryKey(user.country);
    if (key) countries.set(key, formatCountryLabel(user.country));
  }

  return {
    versions: [...versions].sort(collator.compare),
    continents: [...continents].sort(collator.compare),
    countries: [...countries.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => collator.compare(left.label, right.label)),
  };
}

/*
 * ── The directory's Status column ─────────────────────────────────────────
 * One cell says what is wrong with a customer, if anything: their app access (a ban or a
 * suspension, the same record Restrictions lists) and their support state (real errors, or a last
 * status of down or degraded). Nothing wrong reads as a dash; the full wording stays reachable in
 * the cell's title and, on the stacked phone card, as two labelled lines. `errors` sums the
 * sessions' error_count, which counts real errors only — background faults (the RR-E1003 client
 * loop) never flag a customer.
 */

export type DirectoryStatusTone = "danger" | "warning";

export interface DirectoryStatusFlag {
  /** Which line of the full wording the badge stands for. */
  line: "access" | "support";
  /** Badge text: "Banned", "Suspended until 1 Oct 2026", "3 errors", "Down", "Degraded". */
  label: string;
  tone: DirectoryStatusTone;
  /** The fact behind the badge, for its title: "Lifts automatically on …", "Last status down". */
  title: string | null;
}

export interface DirectoryStatus {
  /** At most two badges — the access state, then the support state. Empty when nothing is wrong. */
  flags: DirectoryStatusFlag[];
  /** The App access line in full. */
  access: string;
  /** The Support line in full. */
  support: string;
  /** Both lines, one per line, for the cell's title. */
  summary: string;
  /** Sort weight, worst first — see statusSeverity. */
  severity: number;
}

/*
 * Worst first when the Status column is sorted: a ban, then a suspension, then a client whose last
 * status was down, then real errors, then a degraded last status; nothing wrong sorts last. Rows
 * of one rank order by their error count. The one ranking on the page — needsAttention() is
 * "severity above zero".
 */
const STATUS_RANK = { banned: 5, suspended: 4, down: 3, errors: 2, degraded: 1, clear: 0 } as const;
const ERROR_WEIGHT_CAP = 999_999;

function realErrors(user: UserRollupRecord): number {
  return Number.isFinite(user.errors) && user.errors > 0 ? user.errors : 0;
}

export function statusSeverity(user: UserRollupRecord): number {
  const errors = Math.min(realErrors(user), ERROR_WEIGHT_CAP);
  const rank = user.suspension
    ? user.suspension.mode === "ban"
      ? STATUS_RANK.banned
      : STATUS_RANK.suspended
    : user.lastStatus === "down"
      ? STATUS_RANK.down
      : errors > 0
        ? STATUS_RANK.errors
        : user.lastStatus === "degraded"
          ? STATUS_RANK.degraded
          : STATUS_RANK.clear;
  return rank * (ERROR_WEIGHT_CAP + 1) + errors;
}

/** Customers "Needs attention": anything the Status column would badge. */
export function needsAttention(user: UserRollupRecord): boolean {
  return statusSeverity(user) > 0;
}

function errorCount(errors: number): string {
  return `${formatNumber(errors)} ${errors === 1 ? "error" : "errors"}`;
}

export function directoryStatus(user: UserRollupRecord): DirectoryStatus {
  const flags: DirectoryStatusFlag[] = [];
  const { suspension } = user;
  let access: string;
  if (suspension) {
    access =
      suspension.mode === "ban"
        ? "Banned"
        : suspension.bannedUntil
          ? `Suspended until ${formatDay(suspension.bannedUntil)}`
          : "Suspended";
    flags.push({
      line: "access",
      label: access,
      tone: suspension.mode === "ban" ? "danger" : "warning",
      title:
        suspension.mode !== "ban" && suspension.bannedUntil
          ? `Lifts automatically on ${formatDate(suspension.bannedUntil)}`
          : null,
    });
  } else {
    // undefined: the rollup carried no access information at all (no access.read, an older API).
    access = suspension === undefined ? "Not reported" : "No restriction reported";
  }

  const errors = realErrors(user);
  const health =
    user.lastStatus === "down" || user.lastStatus === "degraded" ? user.lastStatus : null;
  let support: string;
  if (errors > 0) {
    // Errors are the actionable fact; the last status, when it is also off, rides in the title.
    const note = health ? `Last status ${health}` : null;
    flags.push({ line: "support", label: errorCount(errors), tone: "warning", title: note });
    support = note ? `${errorCount(errors)}, last status ${health}` : errorCount(errors);
  } else if (health) {
    flags.push({
      line: "support",
      label: health === "down" ? "Down" : "Degraded",
      tone: health === "down" ? "danger" : "warning",
      title: null,
    });
    support = `Last status ${health}`;
  } else {
    support = "No errors reported";
  }

  return {
    flags,
    access,
    support,
    summary: `App access: ${access}
Support: ${support}`,
    severity: statusSeverity(user),
  };
}

export function filterAndSortUsers(
  users: readonly UserRollupRecord[],
  query: string,
  filters: UserDirectoryFilters,
  sortKey: UserDirectorySortKey,
  sortDirection: DirectorySortDirection,
): UserRollupRecord[] {
  const byIdentity = new Map<string, UserRollupRecord>();
  for (const user of users) {
    const identityKey = user.identity.trim().toLocaleLowerCase();
    const existing = byIdentity.get(identityKey);
    if (
      !existing ||
      (parseTimestamp(user.lastSeen) ?? 0) > (parseTimestamp(existing.lastSeen) ?? 0)
    ) {
      byIdentity.set(identityKey, user);
    }
  }

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = [...byIdentity.values()].filter((user) => {
    if (filters.version && versionName(user) !== filters.version) return false;
    if (filters.continent && getMacroRegion(user.country) !== filters.continent) {
      return false;
    }
    if (filters.country && countryKey(user.country) !== filters.country) {
      return false;
    }
    if (!normalizedQuery) return true;

    return [
      userName(user),
      user.identity,
      user.hwid ?? "",
      lastIpAddress(user) ?? "",
      discordName(user) ?? "",
      versionName(user) ?? "",
      user.city ?? "",
      user.country ?? "",
      formatCountryLabel(user.country),
      getMacroRegion(user.country),
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  });

  return filtered.sort((left, right) => {
    const leftValue = sortValue(left, sortKey);
    const rightValue = sortValue(right, sortKey);
    const compared =
      typeof leftValue === "number" || typeof rightValue === "number"
        ? compareOptionalNumber(
            typeof leftValue === "number" ? leftValue : null,
            typeof rightValue === "number" ? rightValue : null,
            sortDirection,
          )
        : compareOptionalText(leftValue, rightValue, sortDirection);
    return compared || collator.compare(left.identity, right.identity);
  });
}
