import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { CustomerWorkspaceTarget } from "../utils/customerNavigation";
import type { AppSessionRecord, UserRollupRecord } from "../types/telemetry";

export type SearchScope = "customers" | "licenses" | "workers" | "live";
export const SEARCH_SCOPES: SearchScope[] = ["customers", "licenses", "workers", "live"];
const keys = {
  customers: "rr:customer-search",
  licenses: "rr:license-search",
  workers: "rr:history-search",
  live: "rr:live-search",
};
const fallback: Partial<Record<SearchScope, string>> = {};

function readSearch(scope: SearchScope): string {
  try {
    return sessionStorage.getItem(keys[scope]) ?? "";
  } catch {
    return fallback[scope] ?? "";
  }
}

export function setWorkspaceSearch(scope: SearchScope, value: string) {
  fallback[scope] = value;
  try {
    sessionStorage.setItem(keys[scope], value);
  } catch {
    // Searching still works when browser storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(keys[scope], { detail: value }));
}

/** The header and its active directory share a single search value. */
export function useWorkspaceSearch(scope: SearchScope) {
  const subscribe = useCallback(
    (notify: () => void) => {
      const changed = () => notify();
      window.addEventListener(keys[scope], changed);
      window.addEventListener("hashchange", changed);
      return () => {
        window.removeEventListener(keys[scope], changed);
        window.removeEventListener("hashchange", changed);
      };
    },
    [scope],
  );
  const getSnapshot = useCallback(() => readSearch(scope), [scope]);
  const value = useSyncExternalStore(subscribe, getSnapshot, () => "");
  const setValue = useCallback((next: string) => setWorkspaceSearch(scope, next), [scope]);
  return [value, setValue] as const;
}

/* ── Search sources ──────────────────────────────────────────────────
   The header field used to be a write-only filter: typing showed nothing until
   Enter, on a page that might not even display what was being searched. It now
   offers matches from the lists the current page has ALREADY loaded — no extra
   request is ever made for a keystroke. Whoever holds a list publishes it here
   (App: customers + live sessions, LicensesPage: the inventory) and the Navbar
   reads whatever happens to be loaded. */

/** One offered row: what it says, what it matches on, and what it opens. */
export interface SearchRecord {
  /** Stable React key and active-descendant id source. */
  id: string;
  /** Group heading in the popover, e.g. "Customers". */
  group: string;
  label: string;
  detail?: string;
  /** Pre-lowercased haystack; the query is tested against this with includes(). */
  terms: string;
  /** Customer 360 anchor this row opens. */
  target: CustomerWorkspaceTarget;
}

export type SearchSources = Partial<Record<SearchScope, SearchRecord[]>>;

const EMPTY_SOURCES: SearchSources = {};
let sources: SearchSources = EMPTY_SOURCES;
const sourceListeners = new Set<() => void>();

/** Publish (or, with null, withdraw) the records a page currently has in memory. */
export function publishSearchRecords(scope: SearchScope, records: SearchRecord[] | null) {
  if ((sources[scope] ?? null) === records) return;
  const next: SearchSources = { ...sources };
  if (records) next[scope] = records;
  else delete next[scope];
  sources = next;
  for (const listener of sourceListeners) listener();
}

function subscribeSources(listener: () => void) {
  sourceListeners.add(listener);
  return () => {
    sourceListeners.delete(listener);
  };
}

/** Every list currently loaded somewhere in the app, keyed by scope. */
export function useSearchRecords(): SearchSources {
  return useSyncExternalStore(
    subscribeSources,
    () => sources,
    () => EMPTY_SOURCES,
  );
}

/** Publishes `records` for as long as the calling component is mounted. */
export function useSearchRecordSource(scope: SearchScope, records: SearchRecord[] | null) {
  useEffect(() => {
    publishSearchRecords(scope, records);
    return () => publishSearchRecords(scope, null);
  }, [scope, records]);
}

/**
 * Matches `query` against the given sources in order and returns at most
 * `limit` rows. Order is the caller's relevance order (the active scope first),
 * so a scope with many matches can fill the list before the next one is read.
 */
export function matchSearchRecords(
  ordered: Array<SearchRecord[] | null | undefined>,
  query: string,
  limit = 8,
): SearchRecord[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const matches: SearchRecord[] = [];
  for (const source of ordered) {
    if (!source) continue;
    for (const record of source) {
      if (!record.terms.includes(needle)) continue;
      matches.push(record);
      if (matches.length >= limit) return matches;
    }
  }
  return matches;
}

function haystack(...parts: Array<string | null | undefined>): string {
  return parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" ")
    .toLowerCase();
}

function joinDetail(...parts: Array<string | null | undefined>): string | undefined {
  const detail = parts.filter((part) => Boolean(part && part.trim())).join(" · ");
  return detail || undefined;
}

function handle(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/^@/, "");
  return normalized ? `@${normalized}` : null;
}

/** All-time customer rollups (useAdminStats users) as offerable rows. */
export function customerSearchRecords(users: UserRollupRecord[] | null): SearchRecord[] | null {
  if (!users) return null;
  return users.map((user) => {
    const label = user.userLabel?.trim() || user.identity;
    const hwid = user.hwid?.trim();
    const detail = joinDetail(
      handle(user.discordUser),
      user.displayVersion?.trim() || user.appVersion?.trim(),
      user.city?.trim() || user.country?.trim(),
    );
    return {
      id: `customer:${user.identity}`,
      group: "Customers",
      label,
      detail,
      terms: haystack(label, user.identity, hwid, user.discordUser, user.city, user.country),
      // Same anchor rule as the directory row action, so both open one workspace.
      target: {
        selector: hwid ? ("hwid" as const) : ("install_id" as const),
        value: hwid || user.identity,
        label,
        detail,
      },
    };
  });
}

/** Live sessions from the shared summary payload. */
export function liveSessionSearchRecords(
  sessions: AppSessionRecord[] | null,
): SearchRecord[] | null {
  if (!sessions) return null;
  return sessions.map((session) => {
    const label = session.userLabel?.trim() || session.installId;
    const detail = joinDetail(
      session.displayVersion?.trim() || session.appVersion?.trim(),
      session.clientCity?.trim() || session.clientCountry?.trim(),
    );
    return {
      id: `live:${session.id}`,
      group: "Live sessions",
      label,
      detail,
      terms: haystack(
        label,
        session.id,
        session.installId,
        session.hwid,
        session.discordUser,
        session.clientCity,
        session.clientCountry,
      ),
      target: { selector: "session_id" as const, value: session.id, label, detail },
    };
  });
}

/** The fields a license row needs to be searchable — structural, so the page keeps its own type. */
export interface LicenseSearchInput {
  license_key: string;
  hwid?: string | null;
  order_id?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_discord?: string | null;
}

/** License inventory rows, offered while the Licenses page holds them. */
export function licenseSearchRecords(
  licenses: LicenseSearchInput[] | null,
): SearchRecord[] | null {
  if (!licenses) return null;
  return licenses.map((license) => {
    const customer = license.customer_name?.trim();
    const label = customer || license.license_key;
    const detail = joinDetail(
      customer ? license.license_key : null,
      license.order_id ? `Order ${license.order_id}` : null,
      license.customer_email?.trim(),
    );
    return {
      id: `license:${license.license_key}`,
      group: "Licenses",
      label,
      detail,
      terms: haystack(
        label,
        license.license_key,
        license.order_id,
        license.customer_email,
        license.customer_discord,
        license.hwid,
      ),
      target: { selector: "license_key" as const, value: license.license_key, label, detail },
    };
  });
}
