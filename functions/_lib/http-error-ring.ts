/**
 * In-memory record of 5xx responses served by this process (rr-api only). It is a ring of
 * timestamps, bounded so a flood cannot grow memory, and it starts empty on every restart, so the
 * counts mean "since this process started, within the window". On Cloudflare Pages nothing
 * enables it and the system payload reports null instead of a misleading zero.
 */
const CAPACITY = 2048;
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

let enabled = false;
const stamps: number[] = [];

export function enableServerErrorRing(): void {
  enabled = true;
}

export function recordServerError(now = Date.now()): void {
  if (!enabled) return;
  stamps.push(now);
  if (stamps.length > CAPACITY) stamps.splice(0, stamps.length - CAPACITY);
}

export function serverErrorCounts(
  now = Date.now(),
): { last5Minutes: number; last60Minutes: number } | null {
  if (!enabled) return null;
  let last5Minutes = 0;
  let last60Minutes = 0;
  for (const stamp of stamps) {
    const age = now - stamp;
    if (age < 0 || age > HOUR_MS) continue;
    last60Minutes += 1;
    if (age <= FIVE_MINUTES_MS) last5Minutes += 1;
  }
  return { last5Minutes, last60Minutes };
}

/** Test seam. */
export function resetServerErrorRing(): void {
  enabled = false;
  stamps.length = 0;
}
