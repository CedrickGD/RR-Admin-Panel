/**
 * `GET /api/admin/releases/drafts/:id/events` — one draft's timeline, newest first, for the
 * drawer beside the editor. Design: docs/release-management-design.md §3 and §6.
 *
 * `release_events` is the feature's own narrative ("version bumped", "build failed", "manifest
 * committed"); it does not replace `panel_audit`, which every write also inserts into. A detail
 * line is one short sentence and carries neither a token nor a customer identifier.
 */
import { requireDashboardAccess } from "../../../../../_lib/admin";
import { error, json } from "../../../../../_lib/http";
import { idFromParam, releaseFailure } from "../../../../../_lib/releases-route";
import { ensureReleasesSchema, getDraft, listEvents } from "../../../../../_lib/releases-store";
import type { RuntimeEnv } from "../../../../../_lib/types";
import type { ReleaseEventsResponse } from "../../../../../../shared/releases-contract";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
  params: { id: string };
};

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

    const payload: ReleaseEventsResponse = {
      ok: true,
      events: await listEvents(db, { draftId: id }),
    };
    return json(payload);
  } catch (err) {
    return releaseFailure(context.request, err);
  }
}
