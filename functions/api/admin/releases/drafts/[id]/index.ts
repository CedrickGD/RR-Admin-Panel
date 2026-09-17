/**
 * `PUT` and `DELETE /api/admin/releases/drafts/:id`. Design:
 * docs/release-management-design.md §6: "Partial update with `expectedUpdatedAt`, mismatch →
 * `409 { code: "stale" }`, refused once `published`. Delete only while `draft` or `failed`; it
 * drops the row and never touches GitHub."
 *
 * Both conflicts hand the row back as it stands, because an editor that is told "stale" and
 * nothing else can only guess: `releases-store.ts` returns the current draft with every refusal
 * and this route passes it through.
 *
 * "Never touches GitHub" is literal for `DELETE`: a draft is the source of truth for a version
 * *before* publish (§3), so deleting one deletes a row and a plan, never a tag and never a
 * release. What it does write is the pair of audit rows — the timeline keeps the deleted draft's
 * events and gains a `draft_deleted` on top of them.
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
import { readDraftInput } from "../../../../../_lib/releases-draft-input";
import { idFromParam, releaseFailure } from "../../../../../_lib/releases-route";
import {
  DELETABLE_DRAFT_STATUSES,
  deleteDraft,
  ensureReleasesSchema,
  getDraft,
  updateDraft,
} from "../../../../../_lib/releases-store";
import {
  RELEASE_AUDIT,
  RELEASE_LIMITS,
  limitByActor,
  recordWrite,
  refuseWithoutWriteToken,
} from "../../../../../_lib/releases-write";
import type { RuntimeEnv } from "../../../../../_lib/types";
import type { ApiError } from "../../../../../../shared/releases-contract";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
  params: { id: string };
};

function conflict(message: string, code: ApiError["code"], payload: object = {}): Response {
  return json({ ok: false, error: message, code, ...payload }, 409);
}

export async function onRequestPut(context: HandlerContext): Promise<Response> {
  const access = await requireDashboardAccess(context.request, context.env);
  if (!access.ok) return access.response;

  const db = context.env.DB;
  if (!db) return error(500, "Database not available");
  const actor = access.access.user.email;

  const id = idFromParam(context.params.id);
  if (id === null) return error(400, "A valid draft id is required.");

  const limited = limitByActor(context.request, RELEASE_LIMITS.draft, actor);
  if (limited) return limited;

  try {
    const refusal = refuseWithoutWriteToken(createGithubClient(context.env));
    if (refusal) return refusal;

    let body: unknown;
    try {
      body = await readJsonBody<unknown>(context.request, 64 * 1024);
    } catch (cause) {
      return error(400, jsonBodyErrorMessage(cause));
    }
    if (!isObject(body)) return error(400, "A draft is required.");

    const parsed = readDraftInput(body, { versionRequired: false });
    if (!parsed.ok) return error(400, parsed.error);

    await ensureReleasesSchema(context.env);
    const result = await updateDraft(db, id, parsed.input);
    if (!result.ok) {
      if (result.reason === "not-found") return error(404, "Release draft not found.");
      if (result.reason === "published") {
        return conflict(
          `${result.draft.tag} is published — GitHub is the source of truth for it now.`,
          "status-mismatch",
          { draft: result.draft },
        );
      }
      if (result.reason === "duplicate") {
        return conflict("Another draft already holds that tag.", "stale", { draft: result.draft });
      }
      return conflict("This draft was saved elsewhere — reload and try again.", "stale", {
        draft: result.draft,
      });
    }

    await recordWrite(context.env, db, {
      draftId: result.draft.id,
      kind: "draft_updated",
      actor,
      detail: `Draft ${result.draft.tag} edited.`,
      target: result.draft.tag,
      action: RELEASE_AUDIT.draftUpdated,
    });
    return json({ ok: true, draft: result.draft });
  } catch (err) {
    return releaseFailure(context.request, err);
  }
}

export async function onRequestDelete(context: HandlerContext): Promise<Response> {
  const access = await requireDashboardAccess(context.request, context.env);
  if (!access.ok) return access.response;

  const db = context.env.DB;
  if (!db) return error(500, "Database not available");
  const actor = access.access.user.email;

  const id = idFromParam(context.params.id);
  if (id === null) return error(400, "A valid draft id is required.");

  const limited = limitByActor(context.request, RELEASE_LIMITS.draft, actor);
  if (limited) return limited;

  try {
    const refusal = refuseWithoutWriteToken(createGithubClient(context.env));
    if (refusal) return refusal;

    await ensureReleasesSchema(context.env);
    const existing = await getDraft(db, id);
    if (!existing) return error(404, "Release draft not found.");

    const result = await deleteDraft(db, id);
    if (!result.ok) {
      if (result.reason === "not-found") return error(404, "Release draft not found.");
      return conflict(
        `${result.draft.tag} is ${result.draft.status}; a draft can only be deleted while it is ${DELETABLE_DRAFT_STATUSES.join(" or ")}.`,
        "status-mismatch",
        { draft: result.draft },
      );
    }

    await recordWrite(context.env, db, {
      draftId: result.draft.id,
      kind: "draft_deleted",
      actor,
      detail: `Draft ${result.draft.tag} deleted; nothing on GitHub was touched.`,
      target: result.draft.tag,
      action: RELEASE_AUDIT.draftDeleted,
    });
    return json({ ok: true, deleted: true, draft: result.draft });
  } catch (err) {
    return releaseFailure(context.request, err);
  }
}
