import { useEffect, useRef } from "react";

/**
 * Tiny app-wide refresh signal. The header refresh button historically only
 * re-pulled /api/admin/data, so pages that own their data (licenses, feedback,
 * announcements, suspensions, stats) looked dead when clicked — which pushed
 * people toward a full browser reload. Emitting on this bus lets every mounted
 * data source re-pull from the worker in place, no page reload involved.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function emitRefresh(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // One broken subscriber must never stop the rest of the app refreshing.
    }
  }
}

/** Subscribe the latest callback for as long as the component is mounted. */
export function useRefreshSignal(callback: () => void): void {
  const ref = useRef(callback);
  ref.current = callback;

  useEffect(() => {
    const listener = () => ref.current();
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
}
