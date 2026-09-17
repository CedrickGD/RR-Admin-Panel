/**
 * `GET /api/admin/releases/versions` — the release versions and the current one, for the Versions
 * page and for announcement targeting. Design: docs/release-management-design.md §6 and §10.
 *
 * This route exists to take the last two GitHub calls out of the browser (`useLatestVersion` and
 * `useReleaseVersions` read `api.github.com` and `raw.githubusercontent.com` today), which is what
 * lets the source repo go private. It therefore keeps **their** semantics, not the release page's:
 * every non-draft tag, prereleases included, normalised to the 3-part number and filtered to
 * plausible semantic versions so a date-style tag like `26.12.2025` never reaches a version
 * dropdown.
 *
 * `monitoring.read`, not `releases.read` (§4): support and viewer seats read the Versions page,
 * and nothing here says anything about tokens, drafts or builds.
 *
 * **Cached 15 minutes**, per repository and per isolate — the documented limitation
 * `functions/_lib/ratelimit.ts` carries, and harmless here: a stale entry costs a version list a
 * quarter of an hour out of date, and `ageSeconds` says exactly how old it is.
 */
import { requireDashboardAccess } from "../../../_lib/admin";
import { createGithubClient } from "../../../_lib/github-release";
import { json } from "../../../_lib/http";
import { releaseFailure } from "../../../_lib/releases-route";
import type { RuntimeEnv } from "../../../_lib/types";
import { UPDATE_XML_PATH, parseUpdateXml } from "../../../_lib/update-manifest";
import {
  compareVersions,
  versionForTag,
  type GithubRelease,
  type VersionsResponse,
} from "../../../../shared/releases-contract";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

const CACHE_TTL_MS = 15 * 60_000;
const RELEASE_LIMIT = 100;

/** Two or three numeric parts, each at most three digits — the filter the browser hook uses. */
const PLAUSIBLE_VERSION = /^\d+\.\d+(\.\d+)?$/;

interface CachedVersions {
  releases: string[];
  latest: string;
  fetchedAtMs: number;
}

const cache = new Map<string, CachedVersions>();

export function resetVersionsCacheForTests(): void {
  cache.clear();
}

function isPlausibleVersion(version: string): boolean {
  return PLAUSIBLE_VERSION.test(version) && version.split(".").every((part) => part.length <= 3);
}

/** Non-draft tags, 3-part, de-duplicated, newest first. A prerelease is a version people run. */
function releaseVersions(releases: readonly GithubRelease[]): string[] {
  const versions = new Set<string>();
  for (const release of releases) {
    if (release.state === "draft") continue;
    const version = versionForTag(release.tag);
    if (isPlausibleVersion(version)) versions.add(version);
  }
  return [...versions].sort((left, right) => compareVersions(right, left));
}

export async function onRequestGet(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;

    const client = createGithubClient(context.env);
    const nowMs = Date.now();
    let entry = cache.get(client.repo);

    if (!entry || nowMs - entry.fetchedAtMs >= CACHE_TTL_MS) {
      const [releases, manifest] = await Promise.all([
        client.listReleases({ limit: RELEASE_LIMIT }),
        client.getContent(UPDATE_XML_PATH, { essential: false }),
      ]);
      const versions = releaseVersions(releases);
      const pinned = manifest?.content ? parseUpdateXml(manifest.content)?.version : null;
      entry = {
        releases: versions,
        // What customers are actually offered is what update.xml says; the newest release is only
        // the fallback for a manifest that could not be read.
        latest: pinned ? versionForTag(pinned) : (versions[0] ?? ""),
        fetchedAtMs: nowMs,
      };
      cache.set(client.repo, entry);
    }

    const payload: VersionsResponse = {
      ok: true,
      releases: entry.releases,
      latest: entry.latest,
      ageSeconds: Math.max(0, Math.floor((nowMs - entry.fetchedAtMs) / 1000)),
    };
    return json(payload);
  } catch (err) {
    return releaseFailure(context.request, err);
  }
}
