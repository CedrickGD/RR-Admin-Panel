import type { UserRollupRecord } from "../types/telemetry";
import { formatCountryLabel, getMacroRegion, resolveCountry } from "./geography";

export type UserDirectorySortKey =
  | "user"
  | "discord"
  | "version"
  | "location"
  | "lastSeen"
  | "firstSeen"
  | "sessions"
  | "totalTime"
  | "errors";
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
    case "lastSeen":
      return parseTimestamp(user.lastSeen);
    case "firstSeen":
      return parseTimestamp(user.firstSeen);
    case "sessions":
      return Number.isFinite(user.sessions) ? user.sessions : null;
    case "totalTime":
      return Number.isFinite(user.totalDurationSeconds) ? user.totalDurationSeconds : null;
    case "errors":
      return Number.isFinite(user.errors) ? user.errors : null;
  }
}

export function defaultUserSortDirection(key: UserDirectorySortKey): DirectorySortDirection {
  return ["user", "discord", "version", "location"].includes(key) ? "asc" : "desc";
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
