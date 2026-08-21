import { error } from "./http";

/**
 * Fixed-window rate limiter for the public Pages routes.
 *
 * State is a per-isolate in-memory map — Cloudflare may run many isolates, each with its own
 * counters, so the effective limit is "per isolate", not global. That is a documented limitation:
 * the real WAF limits arrive with the zone (W3). This guard still stops the cheap abuse — a single
 * caller hammering one isolate — and costs no I/O on the hot path.
 */
export interface RateLimitRule {
  /** Stable route name used in the bucket key, e.g. `"license/validate"`. */
  route: string;
  /** Calls allowed per window (the `limit + 1`-th call inside a window is rejected). */
  limit: number;
  windowSeconds: number;
  /** Bucket key; defaults to the caller's `cf-connecting-ip`, or `"unknown"` when absent. */
  key?: string;
}

interface Bucket {
  windowStart: number;
  count: number;
  windowMs: number;
}

const MAX_ENTRIES = 10_000;
const MIN_PRUNE_INTERVAL_MS = 1_000;
const TOO_MANY_REQUESTS = "Too many requests.";

const buckets = new Map<string, Bucket>();
let lastPruneAt = Number.NEGATIVE_INFINITY;

/** `null` when the call is allowed, otherwise a 429 JSON response with a `retry-after` header. */
export function enforceRateLimit(
  request: Request,
  rule: RateLimitRule,
  nowMs: number = Date.now(),
): Response | null {
  const windowMs = Math.max(1, Math.floor(rule.windowSeconds * 1000));
  const bucketKey = `${rule.route}|${rule.key ?? clientKey(request)}`;

  let bucket = buckets.get(bucketKey);
  if (!bucket || nowMs - bucket.windowStart >= windowMs) {
    if (!bucket && buckets.size > MAX_ENTRIES) {
      pruneStale(nowMs);
    }
    bucket = { windowStart: nowMs, count: 0, windowMs };
    buckets.set(bucketKey, bucket);
  }

  bucket.count += 1;
  if (bucket.count <= rule.limit) {
    return null;
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.windowStart + windowMs - nowMs) / 1000));
  return error(429, TOO_MANY_REQUESTS, undefined, { "retry-after": String(retryAfterSeconds) });
}

export function resetRateLimitsForTests(): void {
  buckets.clear();
  lastPruneAt = Number.NEGATIVE_INFINITY;
}

function clientKey(request: Request): string {
  return request.headers.get("cf-connecting-ip")?.trim() || "unknown";
}

/**
 * Drops buckets whose window ended at least one full window ago (i.e. older than two windows).
 * Rate-limited to once a second so a flood of distinct keys can't turn every insert into an
 * O(n) sweep.
 */
function pruneStale(nowMs: number): void {
  if (nowMs - lastPruneAt < MIN_PRUNE_INTERVAL_MS) {
    return;
  }
  lastPruneAt = nowMs;
  for (const [key, bucket] of buckets) {
    if (nowMs - bucket.windowStart >= 2 * bucket.windowMs) {
      buckets.delete(key);
    }
  }
}
