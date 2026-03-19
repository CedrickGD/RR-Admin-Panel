import { useEffect, useState } from "react";

const UPDATE_XML_URL = "https://raw.githubusercontent.com/CedrickGD/RazorReaper/master/update.xml";
const FALLBACK_VERSION = "1.4.1";
const CACHE_KEY = "rr-latest-version";
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
  } catch { /* ignore */ }
  return null;
}

function saveCache(version: string) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ version, fetchedAt: Date.now() }));
  } catch { /* ignore */ }
}

function parseVersionFromXml(xml: string): string | null {
  const match = xml.match(/<version>\s*([\d.]+)\s*<\/version>/);
  if (!match) return null;
  // Normalize to 3-part semver: 1.4.1.0 → 1.4.1, 1.4.0.0 → 1.4.0
  const parts = match[1].split(".");
  return parts.slice(0, 3).join(".");
}

export function useLatestVersion(): string {
  const [version, setVersion] = useState(() => loadCached() ?? FALLBACK_VERSION);

  useEffect(() => {
    if (loadCached()) return; // already cached and fresh

    const controller = new AbortController();

    fetch(UPDATE_XML_URL, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((xml) => {
        const parsed = parseVersionFromXml(xml);
        if (parsed) {
          setVersion(parsed);
          saveCache(parsed);
        }
      })
      .catch(() => { /* fallback stays */ });

    return () => controller.abort();
  }, []);

  return version;
}
