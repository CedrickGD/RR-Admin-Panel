/**
 * `GET /api/admin/releases` — the Releases page's whole load. Design:
 * docs/release-management-design.md §6, first row of the table: "One call — the page makes no
 * others on load." Token status, the releases, the drafts, the last runs, what `update.xml` pins
 * and how many installs are on the latest version, in one response.
 *
 * Everything GitHub-side is memoised: 60 s normally, 30 s while a draft is `building`, because a
 * run panel polling every 10 s sits on the same page and a build changes the picture fast (§5).
 * When GitHub is unreachable but a copy is cached, the client serves the copy and the response
 * says so with `stale: true` rather than failing the page.
 */
import { requireDashboardAccess } from "../../../_lib/admin";
import { createGithubClient } from "../../../_lib/github-release";
import { error, json } from "../../../_lib/http";
import { adoptionForVersion } from "../../../_lib/releases-adoption";
import { releaseFailure } from "../../../_lib/releases-route";
import { ensureReleasesSchema, listDrafts } from "../../../_lib/releases-store";
import type { RuntimeEnv } from "../../../_lib/types";
import { UPDATE_XML_PATH, updateXmlState } from "../../../_lib/update-manifest";
import {
  RELEASES_API_VERSION,
  versionForTag,
  type AdoptionSnapshot,
  type GithubRelease,
  type ReleasesOverviewResponse,
} from "../../../../shared/releases-contract";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

/** §6: the releases table shows 30, the runs strip 10. */
const RELEASE_LIMIT = 30;
const RUN_LIMIT = 10;

const MEMOISE_MS = 60_000;
const MEMOISE_WHILE_BUILDING_MS = 30_000;

/** Newest first is GitHub's own order, so the first published entry is the latest one. */
function latestPublishedRelease(releases: readonly GithubRelease[]): GithubRelease | null {
  return releases.find((release) => release.state === "published") ?? null;
}

export async function onRequestGet(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");

    await ensureReleasesSchema(context.env);
    const drafts = await listDrafts(db);

    const client = createGithubClient(context.env);
    const memoiseMs = drafts.some((draft) => draft.status === "building")
      ? MEMOISE_WHILE_BUILDING_MS
      : MEMOISE_MS;

    const [releases, recentRuns, manifestBlob] = await Promise.all([
      client.listReleases({ limit: RELEASE_LIMIT, memoiseMs }),
      client.listRuns({ limit: RUN_LIMIT, memoiseMs }),
      // Not `essential`: the overview is exactly the read §5 wants skipped, and served stale,
      // when the rate limit is nearly spent — a write sequence must never be the one that starves.
      client.getContent(UPDATE_XML_PATH, { memoiseMs, essential: false }),
    ]);

    const latestPublished = latestPublishedRelease(releases);
    const updateXml = updateXmlState(manifestBlob, latestPublished?.tag ?? null);

    let adoption: AdoptionSnapshot | null = null;
    if (latestPublished) {
      adoption = await adoptionForVersion(db, versionForTag(latestPublished.tag));
    }

    const payload: ReleasesOverviewResponse = {
      ok: true,
      apiVersion: RELEASES_API_VERSION,
      token: client.tokenStatus(),
      latestPublished,
      releases,
      drafts,
      recentRuns,
      updateXml,
      adoption,
      stale: client.stale,
    };
    return json(payload);
  } catch (err) {
    return releaseFailure(context.request, err);
  }
}
