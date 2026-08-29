import type { AppSessionRecord } from "../types/telemetry";
import { formatCountryLabel, getMacroRegion, resolveCountry } from "./geography";
import type {
  DirectoryOption,
  DirectorySortDirection,
  UserDirectoryFilters,
} from "./userDirectory";

export type SessionDirectorySortKey =
  | "user"
  | "discord"
  | "location"
  | "version"
  | "duration"
  | "startedAt"
  | "lastSeen"
  | "errors";

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function userName(session: AppSessionRecord): string {
  return session.userLabel?.trim() || session.installId;
}

function discordName(session: AppSessionRecord): string | null {
  const value = session.discordUser?.trim().replace(/^@/, "");
  return value || null;
}

function versionName(session: AppSessionRecord): string | null {
  return session.displayVersion?.trim() || session.appVersion?.trim() || null;
}

function countryKey(value: string | null | undefined): string | null {
  const country = resolveCountry(value);
  if (country) return country.code;
  const raw = value?.trim();
  return raw ? raw.toLocaleLowerCase() : null;
}

function locationName(session: AppSessionRecord): string | null {
  const values = [session.clientCity, session.clientRegion, session.clientCountry].filter(
    (value): value is string => Boolean(value?.trim()),
  );
  return values.length > 0 ? values.join(" · ") : null;
}

function timestamp(value: string | null | undefined): number | null {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

function duration(session: AppSessionRecord): number | null {
  if (session.durationSeconds !== null && Number.isFinite(session.durationSeconds)) {
    return session.durationSeconds;
  }
  const start = timestamp(session.startedAt);
  const end = timestamp(session.endedAt ?? session.lastSeenAt);
  return start !== null && end !== null && end >= start ? (end - start) / 1000 : null;
}

function compareOptional(
  left: string | number | null,
  right: string | number | null,
  direction: DirectorySortDirection,
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const compared =
    typeof left === "number" && typeof right === "number"
      ? left - right
      : collator.compare(String(left), String(right));
  return direction === "asc" ? compared : -compared;
}

function sortValue(
  session: AppSessionRecord,
  key: SessionDirectorySortKey,
): string | number | null {
  switch (key) {
    case "user":
      return userName(session);
    case "discord":
      return discordName(session);
    case "location":
      return locationName(session);
    case "version":
      return versionName(session);
    case "duration":
      return duration(session);
    case "startedAt":
      return timestamp(session.startedAt);
    case "lastSeen":
      return timestamp(session.lastSeenAt);
    case "errors":
      return Number.isFinite(session.errorCount) ? session.errorCount : null;
  }
}

export function defaultSessionSortDirection(key: SessionDirectorySortKey): DirectorySortDirection {
  return ["user", "discord", "location", "version"].includes(key) ? "asc" : "desc";
}

/**
 * Mirrors the Recent Sessions table's retained-window contract: synthetic
 * install rows never appear, and each user is represented by its newest row.
 */
export function normalizeRecentSessions(sessions: readonly AppSessionRecord[]): AppSessionRecord[] {
  const latestPerUser = new Map<string, AppSessionRecord>();
  for (const session of sessions) {
    if (session.id.startsWith("install:")) continue;
    const key = (session.hwid ?? session.installId).trim().toLocaleLowerCase();
    const existing = latestPerUser.get(key);
    if (!existing || (timestamp(session.lastSeenAt) ?? 0) > (timestamp(existing.lastSeenAt) ?? 0)) {
      latestPerUser.set(key, session);
    }
  }
  return [...latestPerUser.values()];
}

export function buildSessionDirectoryOptions(
  sessions: readonly AppSessionRecord[],
  continent: string | null,
): {
  versions: string[];
  continents: string[];
  countries: DirectoryOption[];
} {
  const versions = new Set<string>();
  const continents = new Set<string>();
  const countries = new Map<string, string>();

  for (const session of normalizeRecentSessions(sessions)) {
    const version = versionName(session);
    if (version) versions.add(version);
    const macroRegion = getMacroRegion(session.clientCountry);
    if (macroRegion !== "Unknown") continents.add(macroRegion);
    if (continent && macroRegion !== continent) continue;
    const key = countryKey(session.clientCountry);
    if (key) countries.set(key, formatCountryLabel(session.clientCountry));
  }

  return {
    versions: [...versions].sort(collator.compare),
    continents: [...continents].sort(collator.compare),
    countries: [...countries.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => collator.compare(left.label, right.label)),
  };
}

export function filterAndSortSessions(
  sessions: readonly AppSessionRecord[],
  query: string,
  filters: UserDirectoryFilters,
  sortKey: SessionDirectorySortKey,
  sortDirection: DirectorySortDirection,
): AppSessionRecord[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = normalizeRecentSessions(sessions).filter((session) => {
    if (filters.version && versionName(session) !== filters.version) return false;
    if (filters.continent && getMacroRegion(session.clientCountry) !== filters.continent) {
      return false;
    }
    if (filters.country && countryKey(session.clientCountry) !== filters.country) {
      return false;
    }
    if (!normalizedQuery) return true;

    return [
      userName(session),
      session.installId,
      session.hwid ?? "",
      session.clientIp ?? "",
      discordName(session) ?? "",
      versionName(session) ?? "",
      session.clientCity ?? "",
      session.clientRegion ?? "",
      session.clientCountry ?? "",
      formatCountryLabel(session.clientCountry),
      getMacroRegion(session.clientCountry),
      session.lastEvent ?? "",
    ]
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  });

  return filtered.sort((left, right) => {
    const compared = compareOptional(
      sortValue(left, sortKey),
      sortValue(right, sortKey),
      sortDirection,
    );
    return compared || collator.compare(left.id, right.id);
  });
}
