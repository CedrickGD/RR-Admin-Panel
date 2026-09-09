/**
 * Which pages the shell can render, and how a raw token — the URL hash, a
 * stored `rr:last-page` — becomes one of them. Pure and free of `window` so the
 * alias rules below can be tested on their own (tests/access-page-retired.test.ts).
 */
import type { PageKey } from "../types/telemetry";

/* ── Page persistence ────────────────────────────────────────────
   The page lives in the URL hash (#/live) and localStorage, so any full
   reload — F5, the guarded Cloudflare Access re-auth reload, a phone tab
   being restored — lands back on the page the admin was on, never on
   Overview. Hash also gives shareable deep links and back/forward nav. */
export const PAGE_KEYS: readonly PageKey[] = [
  "team",
  "overview",
  "live",
  "workers",
  "customers",
  "traffic",
  "versions",
  "heatmap",
  "errors",
  "licenses",
  "feedback",
  "announcements",
  "system",
  "settings",
];

export const LAST_PAGE_STORAGE_KEY = "rr:last-page";

/* ── Retired page: "access" ──────────────────────────────────────
   The App access page was folded into the customer directory (audit F067).
   The directory now lists every restriction in force — including the ones
   the telemetry rollup cannot see — with its reason and who issued it, so a
   second page would only duplicate it.

   "access" is deliberately NOT a PageKey any more: it has no sidebar item,
   no PAGE_META label and no route branch, because nothing should offer it
   as a place to go. It survives here as an alias only — "#/access"
   bookmarks, tabs whose stored rr:last-page is still "access", and the
   rr:access-search hand-off are all out there in the wild, and every one of
   them has to land on the directory that took the page over. */
// A Map, not an object literal: a hand-typed "#/toString" must resolve to
// nothing, not to something inherited from Object.prototype.
const RETIRED_PAGE_ALIASES = new Map<string, PageKey>([["access", "customers"]]);

/** One-shot search term written by whoever jumped to the retired page. */
export const ACCESS_SEARCH_STORAGE_KEY = "rr:access-search";

export function isPageKey(value: string | null | undefined): value is PageKey {
  return typeof value === "string" && (PAGE_KEYS as readonly string[]).includes(value);
}

/** `"#/access"` → `"access"`, `"#/"` and `""` → `""`. */
export function hashPageToken(hash: string): string {
  return hash.replace(/^#\/?/, "").trim();
}

/**
 * A live page key, or the page a retired key resolves to. `null` for anything
 * the shell cannot render — the caller then falls back to its own default.
 */
export function resolvePageKey(value: string | null | undefined): PageKey | null {
  if (isPageKey(value)) return value;
  if (typeof value !== "string") return null;
  return RETIRED_PAGE_ALIASES.get(value) ?? null;
}

/**
 * Reads and clears the search term handed to the retired App access page. The
 * directory is that surface now, so the term belongs in its search field.
 * Storage is injected: the caller owns the `sessionStorage` access that a
 * cookie-blocking browser can make throw.
 */
export function takeAccessSearch(storage: Pick<Storage, "getItem" | "removeItem">): string | null {
  const value = storage.getItem(ACCESS_SEARCH_STORAGE_KEY);
  if (!value) return null;
  storage.removeItem(ACCESS_SEARCH_STORAGE_KEY);
  return value;
}
