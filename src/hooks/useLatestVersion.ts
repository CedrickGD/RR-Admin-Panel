import { useEffect, useState } from "react";
import type { VersionsResponse } from "../../shared/releases-contract";
import { apiUrl, fetchApi } from "../utils/api";

/** Shown while nothing is cached yet and the first fetch hasn't resolved — never a guess. */
const UNKNOWN_VERSION = "unknown";
// v2: reads GET /api/admin/releases/versions through the panel's own API instead of fetching
// update.xml straight from GitHub (design §10) — the cache key changed because the data source did.
const CACHE_KEY = "rr-latest-version-v2";
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

interface CachedVersion {
  version: string;
  fetchedAt: number;
}

function loadCached(): string | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached: CachedVersion = JSON.parse(raw);
    if (Date.now() - cached.fetchedAt < CACHE_TTL) return cached.version;
  } catch {
    /* ignore */
  }
  return null;
}

function saveCache(version: string) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ version, fetchedAt: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function useLatestVersion(): string {
  const [version, setVersion] = useState(() => loadCached() ?? UNKNOWN_VERSION);

  useEffect(() => {
    if (loadCached()) return; // already cached and fresh

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
        const latest = typeof body?.latest === "string" ? body.latest.trim() : "";
        if (latest) {
          setVersion(latest);
          saveCache(latest);
        }
      })
      .catch(() => {
        /* fallback stays */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return version;
}
