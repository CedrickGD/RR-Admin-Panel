import { useEffect, useState } from "react";

const RELEASES_URL = "https://api.github.com/repos/CedrickGD/RazorReaper/releases";
const CACHE_KEY = "rr-release-versions";
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

interface CachedReleases {
  versions: string[];
  fetchedAt: number;
}

function normalizeTag(tag: string): string {
  return tag.replace(/^v/i, "").trim();
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
  } catch { /* ignore */ }
  return null;
}

function saveCache(versions: string[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ versions, fetchedAt: Date.now() }));
  } catch { /* ignore */ }
}

/** Returns all known release versions from GitHub (normalized, e.g. "1.4.1") */
export function useReleaseVersions(): string[] {
  const [versions, setVersions] = useState<string[]>(() => loadCached() ?? []);

  useEffect(() => {
    if (loadCached()) return;

    const controller = new AbortController();

    fetch(RELEASES_URL, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((releases: Array<{ tag_name: string; draft: boolean; prerelease: boolean }>) => {
        const parsed = releases
          .filter((r) => !r.draft)
          .map((r) => stripTrailingZeros(normalizeTag(r.tag_name)))
          .filter((v) => /^\d+\.\d+/.test(v));
        setVersions(parsed);
        saveCache(parsed);
      })
      .catch(() => { /* fallback stays */ });

    return () => controller.abort();
  }, []);

  return versions;
}

/** Check if a session-reported version matches any known GitHub release */
export function matchReleaseVersion(sessionVersion: string, knownVersions: string[]): string | null {
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
