/**
 * `POST /api/admin/releases/:id/unpublish-to-draft` — `PATCH …/releases/{id}` with `draft: true`.
 * Design: docs/release-management-design.md §6.
 *
 * GitHub keeps the tag and the assets, so this is reversible; what it is not is a way out of a
 * live manifest. **It is refused while `update.xml` pins that tag** — unpublishing the release
 * customers are being offered strands every client mid-download — and the refusal is not a dead
 * end: the `409` carries `makeCurrentCandidates`, each a published, non-prerelease release
 * carrying the installer, newest first. The page renders them inline with a _Make current_ button
 * each, the owner points the manifest elsewhere, and the unpublish succeeds on a second click.
 *
 * That second action **is** `make-current`. There is no other way to clear the block and no
 * "unpublish anyway" override, here or anywhere else.
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
import type { RuntimeEnv } from "../../../../_lib/types";
import { UPDATE_XML_PATH, parseUpdateXml } from "../../../../_lib/update-manifest";
import {
  INSTALLER_ASSET_NAME,
  tagForVersion,
  tagFromManifestUrl,
  versionForTag,
  type GithubRelease,
  type MakeCurrentCandidate,
  type UnpublishBlockedResponse,
  type UnpublishResponse,
  type UpdateXmlModel,
} from "../../../../../shared/releases-contract";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
  params: { id: string };
};

/** Enough to cover every release the page lists, which is where the candidates are shown. */
const CANDIDATE_SCAN_LIMIT = 30;

function pinnedTag(manifest: UpdateXmlModel | null): string | null {
  if (!manifest) return null;
  return tagFromManifestUrl(manifest.url) ?? tagForVersion(versionForTag(manifest.version));
}

/**
 * Every release `make-current` would actually accept: published (so neither a draft nor a
 * prerelease) and carrying the installer, minus the one being unpublished. The server filters
 * rather than the page, so a candidate the page offers can never be a button that 409s.
 */
function makeCurrentCandidates(
  releases: readonly GithubRelease[],
  excludeTag: string,
): MakeCurrentCandidate[] {
  return releases
    .filter(
      (release) =>
        release.state === "published" &&
        tagForVersion(release.tag) !== excludeTag &&
        release.assets.some((asset) => asset.name === INSTALLER_ASSET_NAME),
    )
    .map((release) => ({
      releaseId: release.id,
      tag: release.tag,
      version: versionForTag(release.tag),
      publishedAt: release.publishedAt,
      hasInstallerAsset: true,
    }));
}

async function readManifest(client: GithubReleaseClient): Promise<UpdateXmlModel | null> {
  const blob = await client.getContent(UPDATE_XML_PATH, { essential: true, fresh: true });
  return blob?.content ? parseUpdateXml(blob.content) : null;
}

export async function onRequestPost(context: HandlerContext): Promise<Response> {
  const access = await requireDashboardAccess(context.request, context.env);
  if (!access.ok) return access.response;

  const db = context.env.DB;
  if (!db) return error(500, "Database not available");
  const actor = access.access.user.email;

  const releaseId = idFromParam(context.params.id);
  if (releaseId === null) return error(400, "A valid release id is required.");

  const limited = limitByActor(context.request, RELEASE_LIMITS.unpublish, actor);
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
    if (!isObject(body)) return error(400, "An unpublish request is required.");

    await ensureReleasesSchema(context.env);
    const release = await client.getRelease(releaseId);
    const tag = tagForVersion(release.tag);

    if (release.state === "draft") {
      return json({ ok: false, error: `${release.tag} is already a draft.` }, 409);
    }

    // The block is checked before the token is verified: a refusal the operator has to answer with
    // a different action must not also cost them the confirmation they just minted.
    if (pinnedTag(await readManifest(client)) === tag) {
      const releases = await client.listReleases({ limit: CANDIDATE_SCAN_LIMIT, essential: true });
      const blocked: UnpublishBlockedResponse = {
        ok: false,
        error: `update.xml still pins ${release.tag}; unpublishing the release customers are being offered strands every client mid-download. Point the manifest at another release with Make current first.`,
        code: "manifest-pinned",
        blockedBy: "manifest",
        makeCurrentCandidates: makeCurrentCandidates(releases, tag),
      };
      return json(blocked, 409);
    }

    const confirmed = await requireConfirm(context.env, body.confirmToken, {
      action: "unpublish",
      subject: String(releaseId),
      actor,
    });
    if (!confirmed.ok) return confirmed.response;

    const updated = await client.updateRelease(releaseId, { draft: true });

    const draft = await getDraftByTag(db, tag);
    await recordWrite(context.env, db, {
      draftId: draft?.id ?? null,
      kind: "unpublished",
      actor,
      detail: `${tag} is a draft again on GitHub; its tag and assets are untouched.`,
      target: tag,
      action: RELEASE_AUDIT.unpublish,
    });

    const payload: UnpublishResponse = { ok: true, release: updated };
    return json(payload);
  } catch (err) {
    await recordGithubFailure(db, null, actor, err);
    return releaseFailure(context.request, err);
  }
}
