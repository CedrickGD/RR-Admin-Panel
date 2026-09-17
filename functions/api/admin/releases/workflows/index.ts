/**
 * `GET /api/admin/releases/workflows` — the workflow list, each with the `workflow_dispatch`
 * inputs it declares, so the Workflows tab can render the right fields instead of a free-text
 * box. Design: docs/release-management-design.md §6 and §9.
 *
 * `releases.read`, like the rest of the read half: §4 puts only the *write* direction of this
 * prefix behind `releases.files`, because dispatching an arbitrary workflow is remote code
 * execution on a runner that holds the release token, while reading the list is not.
 *
 * The Actions API does not carry a workflow's declared inputs, so `withInputs` opens each workflow
 * file as well; a file that cannot be read leaves `inputs` empty rather than failing the list.
 */
import { requireDashboardAccess } from "../../../../_lib/admin";
import { createGithubClient } from "../../../../_lib/github-release";
import { json } from "../../../../_lib/http";
import { releaseFailure } from "../../../../_lib/releases-route";
import type { RuntimeEnv } from "../../../../_lib/types";
import type { WorkflowSummary } from "../../../../../shared/releases-contract";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

export async function onRequestGet(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;

    const client = createGithubClient(context.env);
    const workflows: WorkflowSummary[] = await client.listWorkflows({ withInputs: true });
    return json({ ok: true, workflows });
  } catch (err) {
    return releaseFailure(context.request, err);
  }
}
