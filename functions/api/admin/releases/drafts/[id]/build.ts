/**
 * `POST /api/admin/releases/drafts/:id/build` — the version bump and the dispatch that produces
 * the installer. Design: docs/release-management-design.md §6:
 *
 *   (1) commits the version bump — five `csproj` fields + `MyAppVersion` in the `.iss` — via
 *       `commitFiles` with the draft's `commit_message`, unless master already carries that
 *       version; (2) dispatches `build-installer.yml` with `version`, `notes`, `prerelease`;
 *       (3) resolves the new run id (poll for ≤15 s); status → `building`.
 *
 * The order is the point. `build-installer.yml` **verifies** the two files rather than editing
 * them (§7), so the bump has to be on master before the runner checks out, and
 * `ReleaseReadinessTests` stays true because the manifest is only written later, after the asset
 * exists. One `commitFiles` call moves both files with one ref update: a Contents write per file
 * would leave master carrying a bumped `csproj` and a stale `.iss` if the second call failed.
 *
 * This dispatch is `releases.write`, not `releases.files` (§4): its inputs are the draft, not free
 * text. Dispatching an *arbitrary* workflow is the owner-only route under `…/workflows`.
 */
import { requireDashboardAccess } from "../../../../../_lib/admin";
import { createGithubClient, type GithubReleaseClient } from "../../../../../_lib/github-release";
import {
  error,
  isObject,
  json,
  jsonBodyErrorMessage,
  readJsonBody,
} from "../../../../../_lib/http";
import {
  BUILD_WORKFLOW_FILE,
  CSPROJ_PATH,
  ISS_PATH,
  bumpCsproj,
  bumpIss,
  csprojCarriesVersion,
  issCarriesVersion,
} from "../../../../../_lib/release-version";
import { knownDispatchRunIds, resolveDispatchedRun } from "../../../../../_lib/releases-build";
import { idFromParam, releaseFailure } from "../../../../../_lib/releases-route";
import {
  appendEvent,
  ensureReleasesSchema,
  getDraft,
  updateDraft,
} from "../../../../../_lib/releases-store";
import {
  RELEASE_AUDIT,
  RELEASE_LIMITS,
  limitByActor,
  recordGithubFailure,
  recordWrite,
  refuseWithoutWriteToken,
  requireConfirm,
} from "../../../../../_lib/releases-write";
import type { RuntimeEnv } from "../../../../../_lib/types";
import {
  notesLines,
  type BuildResponse,
  type ReleaseDraft,
} from "../../../../../../shared/releases-contract";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
  params: { id: string };
};

interface BumpPlan {
  /** Empty when master already carries the version — §6's "unless" clause. */
  files: Array<{ path: string; content: string; baseSha: string | null }>;
  applicationVersion: number | null;
}

/**
 * Reads both files fresh and works out what the bump commit has to contain. Fresh on purpose: a
 * memoised `csproj` would decide whether to commit from a copy, and the whole sequence is built
 * on committing against what master carries right now.
 */
async function planBump(client: GithubReleaseClient, draft: ReleaseDraft): Promise<BumpPlan> {
  const [csproj, iss] = await Promise.all([
    client.getContent(CSPROJ_PATH, { essential: true, fresh: true, label: `file ${CSPROJ_PATH}` }),
    client.getContent(ISS_PATH, { essential: true, fresh: true, label: `file ${ISS_PATH}` }),
  ]);
  if (!csproj?.content) throw new BuildRefusal(`${CSPROJ_PATH} could not be read from master.`);
  if (!iss?.content) throw new BuildRefusal(`${ISS_PATH} could not be read from master.`);

  if (
    csprojCarriesVersion(csproj.content, draft.version) &&
    issCarriesVersion(iss.content, draft.version)
  ) {
    return { files: [], applicationVersion: null };
  }

  const bumpedCsproj = bumpCsproj(csproj.content, draft.version);
  const bumpedIss = bumpIss(iss.content, draft.version);
  if (!bumpedCsproj) {
    throw new BuildRefusal(
      `${CSPROJ_PATH} does not carry the five version fields the bump rewrites; fix it on master first.`,
    );
  }
  if (!bumpedIss) {
    throw new BuildRefusal(`${ISS_PATH} does not declare MyAppVersion; fix it on master first.`);
  }

  return {
    files: [
      { path: CSPROJ_PATH, content: bumpedCsproj.content, baseSha: csproj.sha },
      { path: ISS_PATH, content: bumpedIss, baseSha: iss.sha },
    ],
    applicationVersion: bumpedCsproj.applicationVersion,
  };
}

/** A refusal this route answers 409 with, written here and safe to return. */
class BuildRefusal extends Error {}

export async function onRequestPost(context: HandlerContext): Promise<Response> {
  const access = await requireDashboardAccess(context.request, context.env);
  if (!access.ok) return access.response;

  const db = context.env.DB;
  if (!db) return error(500, "Database not available");
  const actor = access.access.user.email;

  const id = idFromParam(context.params.id);
  if (id === null) return error(400, "A valid draft id is required.");

  const limited = limitByActor(context.request, RELEASE_LIMITS.build, actor);
  if (limited) return limited;

  try {
    const client = createGithubClient(context.env);
    const refusal = refuseWithoutWriteToken(client);
    if (refusal) return refusal;

    let body: unknown;
    try {
      body = await readJsonBody<unknown>(context.request);
    } catch (cause) {
      return error(400, jsonBodyErrorMessage(cause));
    }
    if (!isObject(body)) return error(400, "A build request is required.");
    const rebuild = body.rebuild === true;

    await ensureReleasesSchema(context.env);
    let draft = await getDraft(db, id);
    if (!draft) return error(404, "Release draft not found.");

    if (draft.status === "published") {
      return json(
        {
          ok: false,
          error: `${draft.tag} is published; build a new draft instead of rebuilding this one.`,
          code: "status-mismatch",
        },
        409,
      );
    }
    if (draft.status === "building" && !rebuild) {
      return json(
        {
          ok: false,
          error: `A build for ${draft.tag} is already running. Send rebuild: true to start another.`,
          code: "status-mismatch",
        },
        409,
      );
    }

    const confirmed = await requireConfirm(context.env, body.confirmToken, {
      action: "build",
      subject: String(id),
      actor,
    });
    if (!confirmed.ok) return confirmed.response;

    /* 1 — the version bump, unless master already carries it. */
    const plan = await planBump(client, draft);
    let bumped = false;
    if (plan.files.length > 0) {
      const commit = await client.commitFiles({ files: plan.files, message: draft.commitMessage });
      bumped = true;
      await appendEvent(db, {
        draftId: draft.id,
        kind: "version_bumped",
        actor,
        detail: `${draft.version} written to ${CSPROJ_PATH} and ${ISS_PATH} (${commit.commitSha.slice(0, 7)}).`,
      });
    }

    /* 2 — the dispatch. The run ids are read first, so step 3 knows which one is new. */
    const knownRunIds = await knownDispatchRunIds(client);
    await client.dispatchWorkflow(BUILD_WORKFLOW_FILE, {
      ref: client.branch,
      inputs: {
        version: draft.version,
        notes: notesLines(draft.notesCustomer).join("\n"),
        prerelease: draft.prerelease ? "true" : "false",
      },
    });

    /* 3 — the run id, if it turns up inside the deadline. */
    const runId = await resolveDispatchedRun(client, { knownRunIds });

    const updated = await updateDraft(db, draft.id, { status: "building", githubRunId: runId });
    if (updated.ok) draft = updated.draft;

    await recordWrite(context.env, db, {
      draftId: draft.id,
      kind: "build_dispatched",
      actor,
      detail: runId
        ? `${BUILD_WORKFLOW_FILE} dispatched for ${draft.version} (run ${runId}).`
        : `${BUILD_WORKFLOW_FILE} dispatched for ${draft.version}; the run id did not resolve in time.`,
      target: draft.tag,
      action: RELEASE_AUDIT.build,
    });

    const payload: BuildResponse = { ok: true, draft, runId, bumped };
    return json(payload);
  } catch (err) {
    if (err instanceof BuildRefusal) return json({ ok: false, error: err.message }, 409);
    await recordGithubFailure(db, id, actor, err);
    return releaseFailure(context.request, err);
  }
}
