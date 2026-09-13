import { useCallback, useSyncExternalStore } from "react";

/**
 * The pages whose list has a search field in its PageToolbar. The value is
 * kept per page in sessionStorage, so a query survives a reload and a search
 * handed over from elsewhere (the retired access page's redirect, see App.tsx)
 * is already in the field when the page opens.
 */
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

/**
 * Drops every stored search except the open page's own. A query filters one
 * list only, so leaving that page leaves the query behind — it can never come
 * back later as a filter nobody remembers setting.
 */
export function clearWorkspaceSearchesExcept(current: string) {
  for (const scope of SEARCH_SCOPES) {
    if (scope !== current && readSearch(scope)) setWorkspaceSearch(scope, "");
  }
}

/** A page's toolbar search field and its list share this single value. */
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
