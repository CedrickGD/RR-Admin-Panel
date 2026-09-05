import { useCallback, useSyncExternalStore } from "react";

export type SearchScope = "customers" | "licenses" | "workers" | "live";
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
