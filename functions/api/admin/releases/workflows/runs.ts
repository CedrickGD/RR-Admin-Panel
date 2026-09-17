/**
 * `GET /api/admin/releases/workflows/runs` — the recent-runs table on the Workflows tab. Design:
 * docs/release-management-design.md §6 and §9.
 *
 * The overview already carries the last ten runs for the KPI row; this is the same read with a
 * larger, caller-chosen page, and it is the only difference between the two. A draft's own build
 * is followed through `…/drafts/:id/run`, which adds the jobs and the log tail.
 */
import { requireDashboardAccess } from "../../../../_lib/admin";
import { createGithubClient } from "../../../../_lib/github-release";
import { json } from "../../../../_lib/http";
import { limitFromQuery, releaseFailure } from "../../../../_lib/releases-route";
import type { RuntimeEnv } from "../../../../_lib/types";
import type { WorkflowRunSummary } from "../../../../../shared/releases-contract";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MEMOISE_MS = 60_000;

export async function onRequestGet(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;

    const limit = limitFromQuery(
      new URL(context.request.url).searchParams.get("limit"),
      DEFAULT_LIMIT,
      MAX_LIMIT,
    );

    const client = createGithubClient(context.env);
    const runs: WorkflowRunSummary[] = await client.listRuns({ limit, memoiseMs: MEMOISE_MS });
    return json({ ok: true, runs });
  } catch (err) {
    return releaseFailure(context.request, err);
  }
}
