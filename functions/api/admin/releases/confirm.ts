/**
 * `POST /api/admin/releases/confirm` — mints the short-lived token the governed actions demand,
 * together with **the effect list the modal prints**. Design: docs/release-management-design.md
 * §6 ("Confirm effects are server-generated, always") and §11.
 *
 * The token itself is `functions/_lib/release-confirm.ts`' business: an HMAC over `JWT_SECRET`,
 * 120 s, single-use, and a digest of the effects signed alongside so a write route can assert the
 * modal showed what it now recomputes. What lives here is the other half — reading live state and
 * turning it into the lines an operator sees before they click:
 *
 *  - the current manifest, for the version the change moves away from;
 *  - the target release and its assets, for what GitHub will do and for what it will refuse;
 *  - the adoption query the KPI row uses, for how many installs the change reaches;
 *  - `.github/workflows/discord-release.yml`, for whether a post goes out.
 *
 * No line is composed anywhere else. `ReleasesPage.tsx` renders `effects` verbatim and in order
 * and carries no effect copy of its own, which is what makes the modal an account of what the
 * server is about to do rather than a description someone wrote once and stopped maintaining.
 *
 * Three refusals happen **at mint**, because a modal whose confirm button cannot succeed is worse
 * than an early error: a `make-current` onto a draft, a prerelease, an asset-less release or the
 * tag already pinned, and a `commit` to a denylisted path. The `unpublish` block is deliberately
 * *not* one of them — its `409` carries the `makeCurrentCandidates` the page offers inline, and
 * that refusal has to come from the action itself.
 */
import { requireDashboardAccess } from "../../../_lib/admin";
import { createGithubClient, type GithubReleaseClient } from "../../../_lib/github-release";
import { error, isObject, json, jsonBodyErrorMessage, readJsonBody } from "../../../_lib/http";
import {
  ConfirmSecretError,
  discordEffectForMakeCurrent,
  discordEffectForPublish,
  mintConfirmToken,
} from "../../../_lib/release-confirm";
import { fileEditRefusal, isWorkflowPath, normaliseRepoPath } from "../../../_lib/release-files";
import { CSPROJ_PATH, ISS_PATH } from "../../../_lib/release-version";
import { adoptionForVersion } from "../../../_lib/releases-adoption";
import { releaseFailure } from "../../../_lib/releases-route";
import { ensureReleasesSchema, getDraft } from "../../../_lib/releases-store";
import type { D1Database, RuntimeEnv } from "../../../_lib/types";
import { UPDATE_XML_PATH, parseUpdateXml } from "../../../_lib/update-manifest";
import {
  INSTALLER_ASSET_NAME,
  tagForVersion,
  tagFromManifestUrl,
  versionForTag,
  type ConfirmAction,
  type ConfirmEffect,
  type GithubRelease,
  type ReleaseDraft,
  type UpdateXmlModel,
} from "../../../../shared/releases-contract";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

const ACTIONS: readonly ConfirmAction[] = [
  "publish",
  "make-current",
  "unpublish",
  "build",
  "commit",
  "dispatch",
];

const MAX_SUBJECT_LENGTH = 256;

function isConfirmAction(value: unknown): value is ConfirmAction {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value);
}

/** `{ ok: false, … }` with the contract's code, for the two refusals that carry one. */
function refuse(status: number, message: string, code?: "denied-path" | "stale"): Response {
  return json(code ? { ok: false, error: message, code } : { ok: false, error: message }, status);
}

function hasInstaller(release: GithubRelease): boolean {
  return release.assets.some((asset) => asset.name === INSTALLER_ASSET_NAME);
}

/** The manifest as it stands, for the "from" half of every version change. */
async function readManifest(client: GithubReleaseClient): Promise<UpdateXmlModel | null> {
  const blob = await client.getContent(UPDATE_XML_PATH, { essential: false });
  return blob?.content ? parseUpdateXml(blob.content) : null;
}

function manifestVersionLabel(manifest: UpdateXmlModel | null): string | null {
  return manifest ? versionForTag(manifest.version) : null;
}

/**
 * The tag the manifest actually pins — the `/releases/download/<tag>/` segment of its `<url>`,
 * because that is the tag `/update/download` resolves, falling back to `v` + the 3-part
 * `<version>` exactly as `backend-worker/index.js` does. `<version>` is the 4-part number, so
 * prefixing it with a `v` would compare `v1.5.2.0` against `v1.5.2` and never match.
 */
function pinnedTag(manifest: UpdateXmlModel | null): string | null {
  if (!manifest) return null;
  return tagFromManifestUrl(manifest.url) ?? tagForVersion(versionForTag(manifest.version));
}

/**
 * "829 installs are on 1.5.4" — the sentence §6 spells out for make-current, and the same count
 * for a publish that rewrites the manifest. Null when nothing is pinned yet or no install has been
 * seen: an effect line claiming "0 installs" would read as a fact when it is an absence of data.
 */
async function installsOnCurrent(
  db: D1Database,
  currentVersion: string | null,
): Promise<{ version: string; installs: number; windowDays: number } | null> {
  if (!currentVersion) return null;
  const adoption = await adoptionForVersion(db, currentVersion);
  if (adoption.totalInstalls === 0) return null;
  return {
    version: adoption.version,
    installs: adoption.installs,
    windowDays: adoption.windowDays,
  };
}

/* ─────────────────────────────── The effect lists ─────────────────────────────── */

async function publishEffects(
  client: GithubReleaseClient,
  db: D1Database,
  draft: ReleaseDraft,
): Promise<ConfirmEffect[]> {
  const [release, manifest] = await Promise.all([
    client.findReleaseByTag(draft.tag).catch(() => null),
    readManifest(client),
  ]);
  const effects: ConfirmEffect[] = [];

  effects.push({
    kind: "github",
    text: release
      ? `GitHub: the ${release.state} release ${draft.tag} gets ${draft.title || draft.tag} as its title, the notes as its body, and is then published.`
      : `GitHub: a draft release ${draft.tag} is created, gets the notes as its body, and is then published.`,
  });

  if (!release || !hasInstaller(release)) {
    effects.push({
      kind: "note",
      text: `Publishing stops before it publishes: ${draft.tag} carries no ${INSTALLER_ASSET_NAME} yet, and a release without an installer strands every client. Build first.`,
    });
  }

  if (draft.prerelease) {
    effects.push({
      kind: "manifest",
      text: "update.xml: not rewritten — a prerelease is never offered to a customer, so the manifest step is skipped.",
    });
  } else {
    const current = manifestVersionLabel(manifest);
    effects.push({
      kind: "manifest",
      text: current
        ? `update.xml: ${current} → ${draft.version}; every install's next update check resolves ${draft.tag}.`
        : `update.xml: rewritten to ${draft.version}; every install's next update check resolves ${draft.tag}.`,
    });
    const installs = await installsOnCurrent(db, current);
    if (installs) {
      effects.push({
        kind: "installs",
        text: `${installs.installs} of the installs seen in the last ${installs.windowDays} days are on ${installs.version}; they are offered ${draft.version} at their next check.`,
      });
    }
  }

  effects.push(await discordEffectForPublish(client, draft.tag));
  return effects;
}

async function makeCurrentEffects(
  client: GithubReleaseClient,
  db: D1Database,
  release: GithubRelease,
  manifest: UpdateXmlModel | null,
): Promise<ConfirmEffect[]> {
  const current = manifestVersionLabel(manifest);
  const target = versionForTag(release.tag);
  const effects: ConfirmEffect[] = [
    {
      kind: "manifest",
      text: current ? `update.xml: ${current} → ${target}.` : `update.xml: pinned to ${target}.`,
    },
  ];

  const installs = await installsOnCurrent(db, current);
  if (installs) {
    effects.push({
      kind: "installs",
      text: `${installs.installs} installs are on ${installs.version}; they are not downgraded, but every new check now resolves ${target}.`,
    });
  }

  effects.push(discordEffectForMakeCurrent());
  return effects;
}

function unpublishEffects(
  release: GithubRelease,
  manifest: UpdateXmlModel | null,
): ConfirmEffect[] {
  const effects: ConfirmEffect[] = [
    {
      kind: "github",
      text: `GitHub: ${release.tag} goes back to a draft. The tag and its assets stay, so it can be published again.`,
    },
  ];
  const pinned = pinnedTag(manifest);
  if (pinned && pinned === tagForVersion(release.tag)) {
    effects.push({
      kind: "note",
      text: `Refused while it stands: update.xml still pins ${release.tag}, and unpublishing the release customers are being offered strands every client mid-download. Point the manifest at another release with Make current first.`,
    });
  }
  return effects;
}

async function buildEffects(
  client: GithubReleaseClient,
  draft: ReleaseDraft,
): Promise<ConfirmEffect[]> {
  const csproj = await client.getContent(CSPROJ_PATH, { essential: false }).catch(() => null);
  const alreadyBumped = Boolean(
    csproj?.content?.includes(`<ApplicationDisplayVersion>${draft.version}<`),
  );

  return [
    {
      kind: "github",
      text: alreadyBumped
        ? `GitHub: no version-bump commit — ${client.branch} already carries ${draft.version} in ${CSPROJ_PATH}.`
        : `GitHub: one commit on ${client.branch} sets ${draft.version} in ${CSPROJ_PATH} and ${ISS_PATH}, with the message "${draft.commitMessage}".`,
    },
    {
      kind: "github",
      text: `GitHub Actions: build-installer.yml is dispatched on ${client.branch} with version ${draft.version} and prerelease ${draft.prerelease ? "true" : "false"}.`,
    },
  ];
}

function commitEffects(client: GithubReleaseClient, path: string): ConfirmEffect[] {
  const effects: ConfirmEffect[] = [
    { kind: "github", text: `GitHub: one commit on ${client.branch} rewrites ${path}.` },
  ];
  if (isWorkflowPath(path)) {
    effects.push({
      kind: "note",
      text: `${path} runs on a GitHub runner that holds the release token, so editing it is remote code execution there.`,
    });
  }
  return effects;
}

async function dispatchEffects(
  client: GithubReleaseClient,
  subject: string,
): Promise<ConfirmEffect[] | null> {
  const workflows = await client.listWorkflows();
  const workflow = workflows.find(
    (candidate) =>
      String(candidate.id) === subject ||
      candidate.path === subject ||
      candidate.path.endsWith(`/${subject}`),
  );
  if (!workflow) return null;
  return [
    {
      kind: "github",
      text: `GitHub Actions: ${workflow.name} (${workflow.path}) is dispatched on ${client.branch}.`,
    },
    {
      kind: "note",
      text: "A dispatched workflow runs on a GitHub runner with this repository's secrets.",
    },
  ];
}

/* ─────────────────────────────────── The handler ─────────────────────────────────── */

export async function onRequestPost(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");

    let body: unknown;
    try {
      body = await readJsonBody<unknown>(context.request);
    } catch (cause) {
      return error(400, jsonBodyErrorMessage(cause));
    }
    if (!isObject(body)) return error(400, "A confirmation request is required.");
    if (!isConfirmAction(body.action)) return error(400, "That is not a confirmable action.");
    const action = body.action;

    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
    if (!subject) return error(400, "A confirmation needs the subject it is for.");
    if (subject.length > MAX_SUBJECT_LENGTH) return error(400, "That subject is too long.");

    // Files and workflows are owner-only in both directions (§4). A seat that could never make
    // the commit or the dispatch must not learn from a minted effect list what is on master.
    const permissions = access.access.user.permissions;
    if ((action === "commit" || action === "dispatch") && permissions) {
      if (!permissions.includes("releases.files")) {
        return error(403, "You do not have permission for this action.");
      }
    }

    await ensureReleasesSchema(context.env);
    const client = createGithubClient(context.env);
    const actor = access.access.user.email;

    let effects: ConfirmEffect[];
    // What the token is signed for. Only `commit` changes it: the token has to name the same path
    // the effect list names, and the write route normalises before it consults the denylist too.
    let tokenSubject = subject;

    if (action === "publish" || action === "build") {
      const draftId = Number.parseInt(subject, 10);
      if (!Number.isSafeInteger(draftId) || draftId <= 0)
        return error(400, "A valid draft id is required.");
      const draft = await getDraft(db, draftId);
      if (!draft) return error(404, "Release draft not found.");
      effects =
        action === "publish"
          ? await publishEffects(client, db, draft)
          : await buildEffects(client, draft);
    } else if (action === "make-current" || action === "unpublish") {
      const releaseId = Number.parseInt(subject, 10);
      if (!Number.isSafeInteger(releaseId) || releaseId <= 0)
        return error(400, "A valid release id is required.");
      const [release, manifest] = await Promise.all([
        client.getRelease(releaseId),
        readManifest(client),
      ]);
      if (action === "unpublish") {
        effects = unpublishEffects(release, manifest);
      } else {
        // The same four checks make-current itself runs before it writes (§6), run here so the
        // modal is never opened on an action that cannot succeed.
        if (release.state === "draft")
          return refuse(
            409,
            `${release.tag} is still a draft — publish it before making it current.`,
          );
        if (release.state === "prerelease")
          return refuse(
            409,
            `${release.tag} is a prerelease, and a prerelease is never offered to a customer.`,
          );
        if (!hasInstaller(release))
          return refuse(
            409,
            `${release.tag} carries no ${INSTALLER_ASSET_NAME}, so pointing update.xml at it would strand every client.`,
          );
        if (pinnedTag(manifest) === tagForVersion(release.tag))
          return refuse(409, `update.xml already pins ${release.tag}.`, "stale");
        effects = await makeCurrentEffects(client, db, release, manifest);
      }
    } else if (action === "commit") {
      const path = normaliseRepoPath(subject);
      if (!path) return error(400, "Only a path inside the repository can be committed.");
      const refusal = fileEditRefusal(path);
      if (refusal) return refuse(403, refusal, "denied-path");
      effects = commitEffects(client, path);
      tokenSubject = path;
    } else {
      const dispatched = await dispatchEffects(client, subject);
      if (!dispatched) return error(404, "GitHub has no such workflow.");
      effects = dispatched;
    }

    return json(
      await mintConfirmToken(context.env, { action, subject: tokenSubject, actor, effects }),
    );
  } catch (err) {
    // A deployment without JWT_SECRET cannot sign anything, and saying so is the only useful
    // answer — the same fixed sentence `requireAppSession` gives, written here rather than taken
    // from the caught error, because no caught error's text may reach a client.
    if (err instanceof ConfirmSecretError) return error(500, "Server is missing JWT_SECRET.");
    return releaseFailure(context.request, err);
  }
}
