/**
 * `GET /api/admin/releases/commits?since=<tag>` — what has landed on master since a tag, so the
 * draft editor can show the work a release covers beside the notes the customer will read.
 * Design: docs/release-management-design.md §6.
 *
 * `since` defaults to the latest published tag. These are the raw commit subjects: they are an
 * aid for whoever writes the notes and are never the notes themselves — §1 is explicit that a
 * commit message must not reach a customer, and nothing here copies one into a draft.
 */
import { requireDashboardAccess } from "../../../_lib/admin";
import { createGithubClient } from "../../../_lib/github-release";
import { error, json } from "../../../_lib/http";
import { releaseFailure } from "../../../_lib/releases-route";
import type { RuntimeEnv } from "../../../_lib/types";
import type { CommitsSinceResponse, GithubRelease } from "../../../../shared/releases-contract";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

/** §6 caps the comparison at 100 commits and sets `truncated` when master is further ahead. */
const COMMIT_LIMIT = 100;
const MEMOISE_MS = 60_000;

/** A git ref, not a path: letters, digits and the punctuation a tag name may carry. */
const TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+/-]{0,127}$/;

function latestPublishedTag(releases: readonly GithubRelease[]): string | null {
  return releases.find((release) => release.state === "published")?.tag ?? null;
}

export async function onRequestGet(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;

    const requested = new URL(context.request.url).searchParams.get("since")?.trim() ?? "";
    if (requested && !TAG_PATTERN.test(requested)) return error(400, "That is not a tag name.");

    const client = createGithubClient(context.env);
    const since =
      requested ||
      latestPublishedTag(await client.listReleases({ limit: 30, memoiseMs: MEMOISE_MS }));

    const comparison = await client.compareSinceTag(since || null, client.branch, COMMIT_LIMIT);
    const payload: CommitsSinceResponse = { ok: true, ...comparison };
    return json(payload);
  } catch (err) {
    return releaseFailure(context.request, err);
  }
}
