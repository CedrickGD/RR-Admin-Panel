/**
 * `POST /api/admin/releases/drafts` — creates the row a release is shaped in. Design:
 * docs/release-management-design.md §6: "`version` required and > the latest published version;
 * `tag` defaults to `v{version}`, `title` to `RazorReaper {version}`, `commit_message` to
 * `release: {version}`. 409 on duplicate."
 *
 * The version check is the one that needs GitHub, and it needs it for a reason: after publish
 * GitHub is the source of truth for what exists (§3), so "newer than the latest published" is a
 * question only GitHub can answer. It is an `essential` read — a draft is the first step of a
 * write sequence, and the rate-limit floor must starve the overview, not this.
 *
 * No confirm token: §11 lists tokens for publish, make-current, unpublish, build, commit and
 * dispatch, and `ConfirmAction` carries exactly those six. A draft writes no repository, no
 * manifest and nothing a customer sees — the governed actions it leads to are each confirmed on
 * their own. The write-token gate still applies, because §5 puts it on every mutating handler.
 */
import { requireDashboardAccess } from "../../../../_lib/admin";
import { createGithubClient } from "../../../../_lib/github-release";
import { error, isObject, json, jsonBodyErrorMessage, readJsonBody } from "../../../../_lib/http";
import { readDraftInput } from "../../../../_lib/releases-draft-input";
import { releaseFailure } from "../../../../_lib/releases-route";
import { createDraft, ensureReleasesSchema } from "../../../../_lib/releases-store";
import {
  RELEASE_AUDIT,
  RELEASE_LIMITS,
  limitByActor,
  recordGithubFailure,
  recordWrite,
  refuseWithoutWriteToken,
} from "../../../../_lib/releases-write";
import type { RuntimeEnv } from "../../../../_lib/types";
import {
  compareVersions,
  tagForVersion,
  versionForTag,
  type GithubRelease,
  type ReleaseDraftInput,
} from "../../../../../shared/releases-contract";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

/** The releases page shows 30; the newest published one of them is what a version must beat. */
const RELEASE_LIMIT = 30;

function latestPublished(releases: readonly GithubRelease[]): GithubRelease | null {
  return releases.find((release) => release.state === "published") ?? null;
}

export async function onRequestPost(context: HandlerContext): Promise<Response> {
  const access = await requireDashboardAccess(context.request, context.env);
  if (!access.ok) return access.response;

  const db = context.env.DB;
  if (!db) return error(500, "Database not available");
  const actor = access.access.user.email;

  const limited = limitByActor(context.request, RELEASE_LIMITS.draft, actor);
  if (limited) return limited;

  try {
    const client = createGithubClient(context.env);
    const refusal = refuseWithoutWriteToken(client);
    if (refusal) return refusal;

    let body: unknown;
    try {
      body = await readJsonBody<unknown>(context.request, 64 * 1024);
    } catch (cause) {
      return error(400, jsonBodyErrorMessage(cause));
    }
    if (!isObject(body)) return error(400, "A draft is required.");

    const parsed = readDraftInput(body, { versionRequired: true });
    if (!parsed.ok) return error(400, parsed.error);
    const input = parsed.input as ReleaseDraftInput;
    const version = versionForTag(input.version);

    await ensureReleasesSchema(context.env);

    const previous = latestPublished(
      await client.listReleases({ limit: RELEASE_LIMIT, essential: true }),
    );
    if (previous && compareVersions(version, versionForTag(previous.tag)) <= 0) {
      return error(
        400,
        `${version} is not newer than the latest published release, ${versionForTag(previous.tag)}.`,
      );
    }

    const created = await createDraft(db, { ...input, version }, actor);
    if (!created.ok) {
      return json(
        { ok: false, error: `A draft already exists for ${tagForVersion(input.tag ?? version)}.` },
        409,
      );
    }

    const draft = created.draft;
    await recordWrite(context.env, db, {
      draftId: draft.id,
      kind: "draft_created",
      actor,
      detail: `Draft ${draft.tag} created.`,
      target: draft.tag,
      action: RELEASE_AUDIT.draftCreated,
    });

    return json({ ok: true, draft }, 201);
  } catch (err) {
    await recordGithubFailure(db, null, actor, err);
    return releaseFailure(context.request, err);
  }
}
