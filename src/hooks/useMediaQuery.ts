import { useEffect, useState } from "react";

const supported = () => typeof window !== "undefined" && typeof window.matchMedia === "function";

/**
 * Live result of a CSS media query, e.g. "(hover: none)" to tell a touch
 * screen from a mouse without user-agent sniffing. False where matchMedia
 * does not exist (jsdom), and it follows changes — a tablet with a mouse
 * plugged in, a window dragged to another display.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => supported() && window.matchMedia(query).matches);
  useEffect(() => {
    if (!supported()) return;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}
