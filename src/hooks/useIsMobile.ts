import { useEffect, useState } from "react";

/**
 * Auto-detects a phone-sized / touch device and keeps the answer live as the
 * viewport changes (rotation, resize, desktop dev-tools device toolbar).
 *
 * "Phone" = a narrow viewport OR a coarse pointer on a not-wide screen. The
 * width query is the robust signal (a phone is always < ~860 CSS px in
 * portrait); the coarse-pointer clause also catches touch tablets held
 * narrow. Consumers use it to swap the horizontal navbar for a burger drawer.
 */
const PHONE_QUERY = "(max-width: 860px), (pointer: coarse) and (max-width: 1024px)";

function readMatch(query: string): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(query).matches;
}

export function useIsMobile(query: string = PHONE_QUERY): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => readMatch(query));

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = () => setIsMobile(mql.matches);
    onChange(); // sync in case the query changed between render and effect
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return isMobile;
}
