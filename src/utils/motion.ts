/** True when the OS asks for reduced motion. Read live — users toggle it mid-session. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Duration helper for JS-driven motion (MapLibre camera, smooth scroll). */
export function motionDuration(ms: number): number {
  return prefersReducedMotion() ? 0 : ms;
}
