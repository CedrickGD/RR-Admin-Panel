/**
 * `POST /api/admin/releases/workflows/:id/dispatch` — running an arbitrary workflow from the
 * panel. Design: docs/release-management-design.md §4, §6 and §11.
 *
 * This is **`releases.files`, not `releases.write`** (decision 2, §4): "Dispatching an _arbitrary_
 * workflow is remote code execution on a runner holding the release token, so it sits with files;
 * the draft's own `…/drafts/:id/build` dispatch stays `releases.write` because its inputs are the
 * draft, not free text." `routePermissions` already branches on the `…/workflows` prefix for the
 * write direction, so an admin seat never reaches this handler — the confirm route refuses to mint
 * a `dispatch` token for one either, so the modal cannot even be opened.
 *
 * `:id` is whatever GitHub accepts: the numeric workflow id or the file name. It is passed through
 * as the confirm token's subject, so the token names the workflow the modal described.
 */
import { requireDashboardAccess } from "../../../../../_lib/admin";
import { createGithubClient } from "../../../../../_lib/github-release";
import {
  decodeKeyParam,
  error,
  isObject,
  json,
  jsonBodyErrorMessage,
  readJsonBody,
} from "../../../../../_lib/http";
import { releaseFailure } from "../../../../../_lib/releases-route";
import { ensureReleasesSchema } from "../../../../../_lib/releases-store";
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

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
  params: { id: string };
};

/** A workflow id or a file name, never a path out of `.github/workflows`. */
const WORKFLOW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** A git ref: a branch or a tag, the same shape the tag routes accept. */
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+/-]{0,127}$/;

const MAX_INPUTS = 25;
const MAX_INPUT_NAME = 64;
const MAX_INPUT_VALUE = 1_000;

type InputsResult = { ok: true; inputs: Record<string, string> } | { ok: false; error: string };

/**
 * `workflow_dispatch` inputs are strings on the wire, and GitHub refuses anything else. Numbers and
 * booleans are accepted from the form and stringified here so a checkbox does not have to know it.
 */
function readInputs(raw: unknown): InputsResult {
  if (raw === undefined) return { ok: true, inputs: {} };
  if (!isObject(raw)) return { ok: false, error: "inputs must be an object of named values." };
  const entries = Object.entries(raw);
  if (entries.length > MAX_INPUTS) return { ok: false, error: "That is too many inputs." };

  const inputs: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (name.length > MAX_INPUT_NAME) return { ok: false, error: `${name} is not an input name.` };
    const text =
      typeof value === "string"
        ? value
        : typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : null;
    if (text === null) return { ok: false, error: `${name} must be text, a number or a flag.` };
    if (text.length > MAX_INPUT_VALUE) return { ok: false, error: `${name} is too long.` };
    inputs[name] = text;
  }
  return { ok: true, inputs };
}

export async function onRequestPost(context: HandlerContext): Promise<Response> {
  const access = await requireDashboardAccess(context.request, context.env);
  if (!access.ok) return access.response;

  const db = context.env.DB;
  if (!db) return error(500, "Database not available");
  const actor = access.access.user.email;

  const workflowId = decodeKeyParam(context.params.id).trim();
  if (!WORKFLOW_ID_PATTERN.test(workflowId)) return error(400, "That is not a workflow.");

  const limited = limitByActor(context.request, RELEASE_LIMITS.dispatch, actor);
  if (limited) return limited;

  try {
    const client = createGithubClient(context.env);
    const tokenRefusal = refuseWithoutWriteToken(client);
    if (tokenRefusal) return tokenRefusal;

    let body: unknown;
    try {
      body = await readJsonBody<unknown>(context.request, 32 * 1024);
    } catch (cause) {
      return error(400, jsonBodyErrorMessage(cause));
    }
    if (!isObject(body)) return error(400, "A dispatch request is required.");

    const ref = typeof body.ref === "string" && body.ref.trim() ? body.ref.trim() : client.branch;
    if (!REF_PATTERN.test(ref)) return error(400, "That is not a branch or tag name.");

    const inputs = readInputs(body.inputs);
    if (!inputs.ok) return error(400, inputs.error);

    const confirmed = await requireConfirm(context.env, body.confirmToken, {
      action: "dispatch",
      subject: workflowId,
      actor,
    });
    if (!confirmed.ok) return confirmed.response;

    await ensureReleasesSchema(context.env);
    await client.dispatchWorkflow(workflowId, { ref, inputs: inputs.inputs });

    await recordWrite(context.env, db, {
      draftId: null,
      kind: "workflow_dispatched",
      actor,
      // Input *names* only: a value is free text an operator typed, and it has no business in an
      // audit line that §11 keeps short and free of secrets.
      detail: `${workflowId} dispatched on ${ref}${
        Object.keys(inputs.inputs).length > 0
          ? ` with ${Object.keys(inputs.inputs).sort().join(", ")}`
          : ""
      }.`,
      target: workflowId,
      action: RELEASE_AUDIT.dispatch,
    });

    return json({ ok: true, workflowId, ref });
  } catch (err) {
    await recordGithubFailure(db, null, actor, err);
    return releaseFailure(context.request, err);
  }
}
