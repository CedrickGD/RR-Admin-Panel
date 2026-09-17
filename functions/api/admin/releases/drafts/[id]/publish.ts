/**
 * `POST /api/admin/releases/drafts/:id/publish` — the five-step, resumable publish. Design:
 * docs/release-management-design.md §6 ("Publish, step by step") and §12.
 *
 * The sequence itself lives in `functions/_lib/releases-publish.ts`; what this route owns is the
 * gate around it: the write token, the rate limit publish shares with `make-current` (§11), the
 * `expectedStatus` the panel believed, and the confirm token.
 *
 * **The confirm token is verified without being burnt**, for every attempt but the last. §6 says a
 * retry with the same token resumes at `failedStep`, and a token burnt at step 1 would make that
 * impossible; it is burnt once the run reaches `recorded`, and the 120 s TTL is what bounds a
 * replay in the meantime.
 *
 * A stopped run is still a `200`: `PublishResponse` is an `ok: true` shape carrying
 * `completedSteps` and `failedStep`, because "three of five steps are done and here is where to
 * resume" is an answer, not an error. The refusals that come *before* the sequence — a status
 * mismatch, a spent token, no write token — are the 4xx ones.
 */
import { requireDashboardAccess } from "../../../../../_lib/admin";
import { createGithubClient } from "../../../../../_lib/github-release";
import {
  error,
  isObject,
  json,
  jsonBodyErrorMessage,
  readJsonBody,
} from "../../../../../_lib/http";
import { burnConfirmToken } from "../../../../../_lib/release-confirm";
import { runPublish } from "../../../../../_lib/releases-publish";
import { idFromParam, releaseFailure } from "../../../../../_lib/releases-route";
import { ensureReleasesSchema, getDraft } from "../../../../../_lib/releases-store";
import {
  RELEASE_LIMITS,
  limitByActor,
  recordGithubFailure,
  refuseWithoutWriteToken,
  requireConfirm,
} from "../../../../../_lib/releases-write";
import type { RuntimeEnv } from "../../../../../_lib/types";
import {
  isReleaseDraftStatus,
  type PublishResponse,
} from "../../../../../../shared/releases-contract";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
  params: { id: string };
};

export async function onRequestPost(context: HandlerContext): Promise<Response> {
  const access = await requireDashboardAccess(context.request, context.env);
  if (!access.ok) return access.response;

  const db = context.env.DB;
  if (!db) return error(500, "Database not available");
  const actor = access.access.user.email;

  const id = idFromParam(context.params.id);
  if (id === null) return error(400, "A valid draft id is required.");

  const limited = limitByActor(context.request, RELEASE_LIMITS.publish, actor);
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
    if (!isObject(body)) return error(400, "A publish request is required.");
    if (!isReleaseDraftStatus(body.expectedStatus)) {
      return error(400, "expectedStatus must be the status the editor loaded.");
    }
    const confirmToken = body.confirmToken;

    await ensureReleasesSchema(context.env);
    const draft = await getDraft(db, id);
    if (!draft) return error(404, "Release draft not found.");
    if (draft.status !== body.expectedStatus) {
      return json(
        {
          ok: false,
          error: `${draft.tag} is ${draft.status}, not ${body.expectedStatus} — reload and try again.`,
          code: "status-mismatch",
          draft,
        },
        409,
      );
    }

    // burn: false — the resume in §6 depends on this token still being usable.
    const confirmed = await requireConfirm(
      context.env,
      confirmToken,
      { action: "publish", subject: String(id), actor },
      { burn: false },
    );
    if (!confirmed.ok) return confirmed.response;

    const outcome = await runPublish({
      env: context.env,
      db,
      client,
      draft,
      actor,
      skipManifest: body.skipManifest === true,
    });

    if (!outcome.failedStep && typeof confirmToken === "string") burnConfirmToken(confirmToken);

    const payload: PublishResponse = {
      ok: true,
      draft: outcome.draft,
      completedSteps: outcome.completedSteps,
      release: outcome.release,
      manifest: outcome.manifest,
    };
    if (outcome.failedStep) {
      payload.failedStep = outcome.failedStep;
      payload.failureReason = outcome.failureReason;
    }
    return json(payload);
  } catch (err) {
    await recordGithubFailure(db, id, actor, err);
    return releaseFailure(context.request, err);
  }
}
