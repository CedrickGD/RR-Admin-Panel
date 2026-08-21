// Builds the `env` object the Pages Functions and the worker expect: every process env var is
// passed through (so a variable added to the code later is never silently missing), plus the
// bindings Cloudflare used to inject — DB (D1 → SQLite adapter) and the rate-limit bindings.
import type { D1Database, RuntimeEnv } from "../../../../functions/_lib/types";
import { FixedWindowLimiter, readPositiveInt, type RateLimitBinding } from "./ratelimit";

export interface RrApiEnv extends RuntimeEnv {
  DB: D1Database;
  KV: undefined;
  RL_INGEST: RateLimitBinding;
  RL_REGISTER: RateLimitBinding;
  STORAGE_BACKEND: string;
  [key: string]: unknown;
}

export const DEFAULT_INGEST_PER_MINUTE = 60;
export const DEFAULT_REGISTER_PER_MINUTE = 5;

export interface BuildRuntimeEnvOptions {
  now?: () => number;
}

/**
 * `processEnv` is copied as-is (strings only, `undefined` entries dropped); `DB`, `KV`,
 * `RL_INGEST`, `RL_REGISTER` and `STORAGE_BACKEND` are always owned by rr-api. `ORIGIN_BASE` is
 * dropped: rr-api IS the origin, and the embedded worker would otherwise forward its own routes
 * back to itself in an endless loop.
 */
export function buildRuntimeEnv(
  processEnv: NodeJS.ProcessEnv | Record<string, string | undefined>,
  db: D1Database,
  options: BuildRuntimeEnvOptions = {},
): RrApiEnv {
  const passthrough: Record<string, string> = {};
  for (const [key, value] of Object.entries(processEnv)) {
    if (typeof value === "string") {
      passthrough[key] = value;
    }
  }
  delete passthrough.ORIGIN_BASE;

  const ingestPerMinute = readPositiveInt(
    passthrough.RL_INGEST_PER_MINUTE,
    DEFAULT_INGEST_PER_MINUTE,
  );
  const registerPerMinute = readPositiveInt(
    passthrough.RL_REGISTER_PER_MINUTE,
    DEFAULT_REGISTER_PER_MINUTE,
  );

  return {
    ...passthrough,
    DB: db,
    KV: undefined,
    STORAGE_BACKEND: "d1",
    RL_INGEST: new FixedWindowLimiter({ limit: ingestPerMinute, now: options.now }),
    RL_REGISTER: new FixedWindowLimiter({ limit: registerPerMinute, now: options.now }),
  };
}
