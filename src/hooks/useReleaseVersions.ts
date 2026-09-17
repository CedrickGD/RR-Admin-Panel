import { useEffect, useState } from "react";
import type { VersionsResponse } from "../../shared/releases-contract";
import { apiUrl, fetchApi } from "../utils/api";

// v3: reads GET /api/admin/releases/versions through the panel's own API instead of listing
// releases straight from GitHub (design §10) — the cache key changed because the data source did.
// The server already normalizes tags to 3-part semantic versions and drops date-style ones (§6),
// so the client no longer needs to.
const CACHE_KEY = "rr-release-versions-v3";
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

interface CachedReleases {
  versions: string[];
  fetchedAt: number;
}

/** Strip trailing .0 segments: "1.4.1.0" → "1.4.1" */
function stripTrailingZeros(version: string): string {
  const parts = version.split(".");
  while (parts.length > 1 && parts[parts.length - 1] === "0") {
    parts.pop();
  }
  return parts.join(".");
}

function loadCached(): string[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached: CachedReleases = JSON.parse(raw);
    if (Date.now() - cached.fetchedAt < CACHE_TTL) return cached.versions;
  } catch {
    /* ignore */
  }
  return null;
}

function saveCache(versions: string[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ versions, fetchedAt: Date.now() }));
  } catch {
    /* ignore */
  }
}

/** Returns all known release versions from the panel API (normalized, e.g. "1.4.1") */
export function useReleaseVersions(): string[] {
  const [versions, setVersions] = useState<string[]>(() => loadCached() ?? []);

  useEffect(() => {
    if (loadCached()) return;

    let cancelled = false;

    fetchApi(apiUrl("/api/admin/releases/versions"), {
      method: "GET",
      cache: "no-store",
      credentials: "include",
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<VersionsResponse>;
      })
      .then((body) => {
        if (cancelled) return;
        const parsed = Array.isArray(body?.releases) ? body.releases : [];
        setVersions(parsed);
        saveCache(parsed);
      })
      .catch(() => {
        /* fallback stays */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return versions;
}

/** Check if a session-reported version matches any known GitHub release */
export function matchReleaseVersion(
  sessionVersion: string,
  knownVersions: string[],
): string | null {
  const stripped = stripTrailingZeros(sessionVersion);
  // Direct match
  if (knownVersions.includes(stripped)) return stripped;
  // Try 3-part match: "1.0.0.1" → check "1.0.0"
  const parts = sessionVersion.split(".");
  if (parts.length >= 3) {
    const threePart = parts.slice(0, 3).join(".");
    if (knownVersions.includes(threePart)) return threePart;
  }
  return null;
}
