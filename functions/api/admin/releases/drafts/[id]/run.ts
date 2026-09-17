/**
 * `GET /api/admin/releases/drafts/:id/run` — the run panel the editor polls while a draft is
 * `building`. Design: docs/release-management-design.md §6: "run, jobs, last ~200 log lines. Sets
 * `built` on success (recording `asset_name`/`asset_size`) or `failed`. `pollAfterSeconds` 10
 * while running, 0 when finished."
 *
 * So this read is where a build's outcome lands in the draft row: the panel has no webhook and no
 * queue, and §1 rules out both. The transition is written **once** — it is guarded on the row
 * still being `building` — and it records a `release_events` row rather than calling `auditPanel`,
 * because the actor is the runner that finished, not whoever happened to refresh the page.
 *
 * GitHub masks secrets in job logs before it serves them, and `getJobLogs` never forwards a failed
 * fetch as an error: a log that cannot be read is an empty tail, and the job list still tells the
 * operator where the build stands.
 */
import { requireDashboardAccess } from "../../../../../_lib/admin";
import {
  createGithubClient,
  isGithubApiError,
  type GithubReleaseClient,
} from "../../../../../_lib/github-release";
import { error, json } from "../../../../../_lib/http";
import { idFromParam, releaseFailure } from "../../../../../_lib/releases-route";
import {
  appendEvent,
  ensureReleasesSchema,
  getDraft,
  updateDraft,
} from "../../../../../_lib/releases-store";
import type { D1Database, RuntimeEnv } from "../../../../../_lib/types";
import {
  INSTALLER_ASSET_NAME,
  type ReleaseDraft,
  type RunDetailResponse,
  type WorkflowJobSummary,
  type WorkflowRunSummary,
} from "../../../../../../shared/releases-contract";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
  params: { id: string };
};

/** §6: 10 s while the run is alive, 0 once it is not — the page stops polling on its own. */
const POLL_WHILE_RUNNING_SECONDS = 10;

const EMPTY: RunDetailResponse = {
  ok: true,
  run: null,
  jobs: [],
  logTail: [],
  pollAfterSeconds: 0,
};

/** The job whose tail is worth showing: the one that failed, else the one still going, else last. */
function jobForLogs(jobs: readonly WorkflowJobSummary[]): WorkflowJobSummary | null {
  return (
    jobs.find((job) => job.conclusion === "failure") ??
    jobs.find((job) => job.status === "in_progress") ??
    jobs[jobs.length - 1] ??
    null
  );
}

/**
 * The installer the runner uploaded to the draft release for this tag. `gh release upload` is the
 * build's last step (§7), so the asset is the proof the build produced something publishable.
 */
async function installerAsset(
  client: GithubReleaseClient,
  tag: string,
): Promise<{ name: string; size: number } | null> {
  const release = await client.findReleaseByTag(tag).catch(() => null);
  const asset = release?.assets.find((candidate) => candidate.name === INSTALLER_ASSET_NAME);
  return asset ? { name: asset.name, size: asset.size } : null;
}

/**
 * Writes the outcome into the draft, once. A row that is no longer `building` has already been
 * moved on — by an earlier poll, or by the operator deleting and recreating the draft — and this
 * must not move it back.
 */
async function recordOutcome(
  db: D1Database,
  client: GithubReleaseClient,
  draft: ReleaseDraft,
  run: WorkflowRunSummary,
  actor: string,
): Promise<void> {
  if (draft.status !== "building" || run.status !== "completed") return;

  if (run.conclusion === "success") {
    const asset = await installerAsset(client, draft.tag);
    await updateDraft(db, draft.id, {
      status: "built",
      assetName: asset?.name ?? null,
      assetSize: asset?.size ?? null,
    });
    await appendEvent(db, {
      draftId: draft.id,
      kind: "build_succeeded",
      actor,
      detail: asset
        ? `Run ${run.runNumber} produced ${asset.name} (${asset.size} bytes).`
        : `Run ${run.runNumber} succeeded, but no ${INSTALLER_ASSET_NAME} is attached to ${draft.tag} yet.`,
    });
    return;
  }

  await updateDraft(db, draft.id, { status: "failed" });
  await appendEvent(db, {
    draftId: draft.id,
    kind: "build_failed",
    actor,
    detail: `Run ${run.runNumber} finished as ${run.conclusion ?? "incomplete"}.`,
  });
}

export async function onRequestGet(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");

    const id = idFromParam(context.params.id);
    if (id === null) return error(400, "A valid draft id is required.");

    await ensureReleasesSchema(context.env);
    const draft = await getDraft(db, id);
    if (!draft) return error(404, "Release draft not found.");
    if (draft.githubRunId === null) return json(EMPTY);

    const client = createGithubClient(context.env);
    let run: WorkflowRunSummary;
    try {
      run = await client.getRun(draft.githubRunId);
    } catch (cause) {
      // A run GitHub no longer has (log retention drops old ones) must not brick the draft's
      // panel for good: there is simply nothing to show.
      if (isGithubApiError(cause) && cause.status === 404) return json(EMPTY);
      throw cause;
    }

    const jobs = await client.listJobs(run.id);
    const job = jobForLogs(jobs);
    const logTail = job ? await client.getJobLogs(job.id) : [];

    await recordOutcome(db, client, draft, run, access.access.user.email);

    const payload: RunDetailResponse = {
      ok: true,
      run,
      jobs,
      logTail,
      pollAfterSeconds: run.status === "completed" ? 0 : POLL_WHILE_RUNNING_SECONDS,
    };
    return json(payload);
  } catch (err) {
    return releaseFailure(context.request, err);
  }
}
