/**
 * `POST /api/admin/releases/:id/make-current` — the governed rollback, and the governed
 * roll-forward. Design: docs/release-management-design.md §6.
 *
 * `:id` is the **GitHub release id**, not a draft id, so this works for any published release with
 * or without a draft row — which is the whole point: a rollback target is usually a release the
 * panel never drafted.
 *
 * **Everything is validated before anything is written**: the release exists, is published (not a
 * draft), is not a prerelease (decision 4), and carries `RazorReaper-Setup.exe`. Any failure is a
 * `400`/`409` naming the reason with nothing committed — pointing `update.xml` at a tag whose
 * asset does not exist is the one failure mode this design exists to make impossible.
 *
 * Then one `commitFiles` commit rewrites `update.xml` to the target tag's `<version>`, `<url>`,
 * `<changelog>`, `<mandatory>` and `<notes>` — the same **github.com** shapes publish step 4
 * writes, because `ReleaseReadinessTests` asserts them and rr-api rewrites them at serving time.
 * No release event fires, so nothing is posted to Discord, and the confirm modal says exactly that.
 */
import { requireDashboardAccess } from "../../../../_lib/admin";
import { createGithubClient, type GithubReleaseClient } from "../../../../_lib/github-release";
import { error, isObject, json, jsonBodyErrorMessage, readJsonBody } from "../../../../_lib/http";
import { idFromParam, releaseFailure } from "../../../../_lib/releases-route";
import { ensureReleasesSchema, getDraftByTag } from "../../../../_lib/releases-store";
import {
  RELEASE_AUDIT,
  RELEASE_LIMITS,
  limitByActor,
  recordGithubFailure,
  recordWrite,
  refuseWithoutWriteToken,
  requireConfirm,
} from "../../../../_lib/releases-write";
import type { D1Database, RuntimeEnv } from "../../../../_lib/types";
import {
  UPDATE_XML_PATH,
  manifestModelForTag,
  parseUpdateXml,
  renderUpdateXml,
} from "../../../../_lib/update-manifest";
import {
  INSTALLER_ASSET_NAME,
  notesLines,
  tagForVersion,
  tagFromManifestUrl,
  versionForTag,
  type GithubRelease,
  type MakeCurrentResponse,
  type UpdateXmlModel,
} from "../../../../../shared/releases-contract";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
  params: { id: string };
};

const MAX_COMMIT_MESSAGE = 500;
/** A release body is prose; only its bullet lines are ever customer notes, and never many. */
const MAX_BODY_BULLETS = 20;

function refuse(status: number, message: string, code?: "stale"): Response {
  return json(code ? { ok: false, error: message, code } : { ok: false, error: message }, status);
}

/** The tag the committed `<url>` pins, the same fallback `backend-worker/index.js` applies. */
function pinnedTag(manifest: UpdateXmlModel | null): string | null {
  if (!manifest) return null;
  return tagFromManifestUrl(manifest.url) ?? tagForVersion(versionForTag(manifest.version));
}

function bulletsFromBody(body: string): string[] {
  return body
    .split(/\r?\n/)
    .filter((line) => /^\s*[-*]\s+/.test(line))
    .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
    .filter((line) => line.length > 0)
    .slice(0, MAX_BODY_BULLETS);
}

/**
 * What the rewritten manifest tells customers about the target. The draft row for that tag is the
 * panel's own record of the bullets and the mandatory flag, so it wins; without one the release
 * body's bullet lines are the best the repo has, and `mandatory` stays false — a rollback must
 * never turn into a forced update nobody asked for.
 */
async function notesForTarget(
  db: D1Database,
  release: GithubRelease,
): Promise<{ notes: string[]; mandatory: boolean }> {
  const draft = await getDraftByTag(db, release.tag);
  if (draft) return { notes: notesLines(draft.notesCustomer), mandatory: draft.mandatory };
  return { notes: bulletsFromBody(release.body), mandatory: false };
}

async function readManifest(
  client: GithubReleaseClient,
): Promise<{ model: UpdateXmlModel | null; sha: string | null }> {
  const blob = await client.getContent(UPDATE_XML_PATH, { essential: true, fresh: true });
  return { model: blob?.content ? parseUpdateXml(blob.content) : null, sha: blob?.sha ?? null };
}

export async function onRequestPost(context: HandlerContext): Promise<Response> {
  const access = await requireDashboardAccess(context.request, context.env);
  if (!access.ok) return access.response;

  const db = context.env.DB;
  if (!db) return error(500, "Database not available");
  const actor = access.access.user.email;

  const releaseId = idFromParam(context.params.id);
  if (releaseId === null) return error(400, "A valid release id is required.");

  // §11: publish and make-current share one bucket — they are the two actions that move what a
  // customer is offered.
  const limited = limitByActor(context.request, RELEASE_LIMITS.publish, actor);
  if (limited) return limited;

  try {
    const client = createGithubClient(context.env);
    const tokenRefusal = refuseWithoutWriteToken(client);
    if (tokenRefusal) return tokenRefusal;

    let body: unknown;
    try {
      body = await readJsonBody<unknown>(context.request);
    } catch (cause) {
      return error(400, jsonBodyErrorMessage(cause));
    }
    if (!isObject(body)) return error(400, "A make-current request is required.");
    if (body.commitMessage !== undefined && typeof body.commitMessage !== "string") {
      return error(400, "commitMessage must be text.");
    }
    const requestedMessage = (body.commitMessage ?? "").toString().trim();
    if (requestedMessage.length > MAX_COMMIT_MESSAGE) {
      return error(400, `commitMessage is longer than ${MAX_COMMIT_MESSAGE} characters.`);
    }

    await ensureReleasesSchema(context.env);
    const release = await client.getRelease(releaseId);
    const manifest = await readManifest(client);
    const tag = tagForVersion(release.tag);
    const previousTag = pinnedTag(manifest.model);

    /* Validated before anything is written (§6). */
    if (release.state === "draft") {
      return refuse(409, `${release.tag} is still a draft — publish it before making it current.`);
    }
    if (release.state === "prerelease") {
      return refuse(
        409,
        `${release.tag} is a prerelease, and a prerelease is never offered to a customer.`,
      );
    }
    if (!release.assets.some((asset) => asset.name === INSTALLER_ASSET_NAME)) {
      return refuse(
        409,
        `${release.tag} carries no ${INSTALLER_ASSET_NAME}, so pointing update.xml at it would strand every client.`,
      );
    }
    if (previousTag !== null && previousTag === tag) {
      return refuse(409, `update.xml already pins ${release.tag}.`, "stale");
    }
    const expected = body.expectedCurrentTag;
    if (typeof expected === "string" && tagForVersion(expected) !== (previousTag ?? "")) {
      return refuse(
        409,
        `update.xml pins ${previousTag ?? "nothing recognisable"}, not ${expected} — reload and try again.`,
        "stale",
      );
    }

    const confirmed = await requireConfirm(context.env, body.confirmToken, {
      action: "make-current",
      subject: String(releaseId),
      actor,
    });
    if (!confirmed.ok) return confirmed.response;

    const { notes, mandatory } = await notesForTarget(db, release);
    const model = manifestModelForTag({
      tag,
      version: versionForTag(tag),
      mandatory,
      notes,
      args: manifest.model?.args,
      repo: client.repo,
    });
    const commitMessage = requestedMessage || `release: point update.xml at ${tag}`;
    const commit = await client.commitFiles({
      files: [{ path: UPDATE_XML_PATH, content: renderUpdateXml(model), baseSha: manifest.sha }],
      message: commitMessage,
    });

    const draft = await getDraftByTag(db, tag);
    await recordWrite(context.env, db, {
      draftId: draft?.id ?? null,
      kind: "manifest_committed",
      actor,
      detail: `update.xml now pins ${tag}${previousTag ? ` (was ${previousTag})` : ""} (${commit.commitSha.slice(0, 7)}).`,
      target: tag,
      action: RELEASE_AUDIT.makeCurrent,
    });

    const payload: MakeCurrentResponse = {
      ok: true,
      tag,
      previousTag,
      commitSha: commit.commitSha,
      manifest: model,
    };
    return json(payload);
  } catch (err) {
    await recordGithubFailure(db, null, actor, err);
    return releaseFailure(context.request, err);
  }
}
