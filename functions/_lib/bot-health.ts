import type { SystemBot } from "../../shared/system-status";
import { isNodeRuntime } from "./runtime";
import type { RuntimeEnv } from "./types";

export const DEFAULT_BOT_URL = "http://bot:8080";
export const BOT_TIMEOUT_MS = 1500;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Discord bot liveness through its compose-network `/health` (razorreaper-bot notifier.js:
 * `{ ok, uptime (ms), clients, watching }`). Null when no bot is configured for this runtime;
 * `reachable: false` when it is configured but did not answer ok within the timeout.
 */
export async function loadBotHealth(
  env: RuntimeEnv,
  fetchFn: FetchLike,
  clock: () => number = Date.now,
): Promise<SystemBot | null> {
  const base = env.BOT_URL?.trim() || (isNodeRuntime() ? DEFAULT_BOT_URL : "");
  if (!base) return null;
  const started = clock();
  try {
    const response = await fetchFn(`${base.replace(/\/$/, "")}/health`, {
      signal: AbortSignal.timeout(BOT_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    const latencyMs = Math.max(0, Math.round(clock() - started));
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const uptimeMs = finiteOrNull(body?.uptime);
    return {
      reachable: response.ok && body?.ok === true,
      latencyMs,
      uptimeSeconds: uptimeMs === null ? null : Math.round(uptimeMs / 1000),
      clients: finiteOrNull(body?.clients),
      watching: finiteOrNull(body?.watching),
    };
  } catch {
    return {
      reachable: false,
      latencyMs: null,
      uptimeSeconds: null,
      clients: null,
      watching: null,
    };
  }
}
