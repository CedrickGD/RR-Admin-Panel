/**
 * Runtime probes shared by the NAS-only system adapters. Nothing here imports a Node module at
 * the top level: the same files are bundled for Cloudflare Pages, where `node:fs` does not exist.
 * `process.getBuiltinModule` (Node >= 22.3) hands out built-ins without any bundler involvement.
 */

type ProcessLike = {
  versions?: { node?: string };
  uptime?: () => number;
  getBuiltinModule?: (id: string) => unknown;
};

function currentProcess(): ProcessLike | null {
  const candidate = (globalThis as { process?: ProcessLike }).process;
  return candidate && typeof candidate === "object" ? candidate : null;
}

/** True on Node (rr-api); false on Workers, even with nodejs_compat's partial `process`. */
export function isNodeRuntime(): boolean {
  const userAgent = (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent;
  if (typeof userAgent === "string" && userAgent.includes("Cloudflare-Workers")) return false;
  return typeof currentProcess()?.versions?.node === "string";
}

export function nodeVersion(): string | null {
  return isNodeRuntime() ? (currentProcess()?.versions?.node ?? null) : null;
}

export function processUptimeSeconds(): number | null {
  const uptime = currentProcess()?.uptime;
  return isNodeRuntime() && typeof uptime === "function" ? Math.round(uptime()) : null;
}

export function nodeBuiltin<T>(id: string): T | null {
  if (!isNodeRuntime()) return null;
  try {
    return (currentProcess()?.getBuiltinModule?.(id) as T | undefined) ?? null;
  } catch {
    return null;
  }
}
