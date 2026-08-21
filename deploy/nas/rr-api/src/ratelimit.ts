// In-process stand-in for the Cloudflare rate-limit bindings (`RL_INGEST` / `RL_REGISTER`): the
// worker only ever calls `limit({ key })` and reads `success`. Fixed window per key, bounded map.

export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface Bucket {
  windowStart: number;
  count: number;
}

const MAX_ENTRIES = 10_000;

export interface FixedWindowLimiterOptions {
  /** Calls allowed per window; the `limit + 1`-th call inside a window fails. */
  limit: number;
  windowSeconds?: number;
  now?: () => number;
}

export class FixedWindowLimiter implements RateLimitBinding {
  private readonly buckets = new Map<string, Bucket>();
  private readonly maxPerWindow: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(options: FixedWindowLimiterOptions) {
    this.maxPerWindow = Math.max(1, Math.floor(options.limit));
    this.windowMs = Math.max(1000, Math.floor((options.windowSeconds ?? 60) * 1000));
    this.now = options.now ?? Date.now;
  }

  async limit(options: { key: string }): Promise<{ success: boolean }> {
    return { success: this.hit(options.key) };
  }

  /** Synchronous core: true while the key is inside its allowance for the current window. */
  hit(key: string): boolean {
    const nowMs = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket || nowMs - bucket.windowStart >= this.windowMs) {
      if (!bucket && this.buckets.size >= MAX_ENTRIES) {
        this.prune(nowMs);
      }
      bucket = { windowStart: nowMs, count: 0 };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    return bucket.count <= this.maxPerWindow;
  }

  get size(): number {
    return this.buckets.size;
  }

  reset(): void {
    this.buckets.clear();
  }

  private prune(nowMs: number): void {
    for (const [key, bucket] of this.buckets) {
      if (nowMs - bucket.windowStart >= this.windowMs) {
        this.buckets.delete(key);
      }
    }
    if (this.buckets.size >= MAX_ENTRIES) {
      this.buckets.clear();
    }
  }
}

/** Parses a positive integer env value, falling back when unset/invalid. */
export function readPositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
