/**
 * `GET` and `PUT /api/admin/releases/files` — the Files tab. `GET` is a blob or the listing of a
 * directory on master; `PUT` is one `commitFiles` commit. Design:
 * docs/release-management-design.md §6, §9 ("a path field, a tree browser (Git Trees on master)")
 * and §11. Both halves share one denylist, `functions/_lib/release-files.ts`, because a flag the
 * server does not also enforce is decoration.
 *
 * Two shapes come back, both `{ ok: true, ref, path, … }`: a listing carries `entries`
 * (`RepoTreeResponse`), a blob carries `file` (`RepoFile`). Nothing else distinguishes them and
 * nothing needs to — a path either names a file or it does not.
 *
 * **The denylist is a read guard too.** A `.pfx`, an `.env` or an `appsettings*.json` is refused
 * with `403 { code: "denied-path" }` before a single GitHub call: reading signing material or a
 * secret out of the repo through the panel is the same leak as writing one (§11). `update.xml` is
 * the one governed path that still reads — it is not a secret, and the page shows it read-only
 * with the reason pointing at Publish and Make current.
 *
 * A blob over 512 KB, or one that is not UTF-8, comes back with `content: null` and `unreadable`
 * set. That is the size threshold, and it is the GitHub client's, so the same bound applies to
 * every caller.
 */
import { requireDashboardAccess } from "../../../_lib/admin";
import {
  RELEASE_TOKEN_VAR,
  createGithubClient,
  type GithubReleaseClient,
} from "../../../_lib/github-release";
import { error, isObject, json, jsonBodyErrorMessage, readJsonBody } from "../../../_lib/http";
import {
  MAX_EDITABLE_FILE_BYTES,
  fileEditRefusal,
  isReadableRepoPath,
  isWorkflowPath,
  normaliseRepoPath,
} from "../../../_lib/release-files";
import { releaseFailure } from "../../../_lib/releases-route";
import { ensureReleasesSchema } from "../../../_lib/releases-store";
import {
  RELEASE_AUDIT,
  RELEASE_LIMITS,
  limitByActor,
  recordGithubFailure,
  recordWrite,
  refuseWithoutWriteToken,
  requireConfirm,
} from "../../../_lib/releases-write";
import type { RuntimeEnv } from "../../../_lib/types";
import type {
  FilePutResponse,
  RepoFile,
  RepoTreeEntry,
  RepoTreeResponse,
} from "../../../../shared/releases-contract";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

const TOO_LARGE_REASON = "This file is too large to open in the panel (the limit is 512 KB).";
const BINARY_REASON = "This file is not UTF-8 text, so the panel cannot show or edit it.";

function unreadableReason(unreadable: RepoFile["unreadable"]): string | null {
  if (unreadable === "too-large") return TOO_LARGE_REASON;
  if (unreadable === "binary") return BINARY_REASON;
  return null;
}

function treeEntry(path: string, type: "blob" | "tree", sha: string, size: number | null) {
  const entry: RepoTreeEntry = { path, type, sha, size, editable: fileEditRefusal(path) === null };
  return entry;
}

/** Trees before blobs, then alphabetical — a browser listing, not a repository order. */
function sortEntries(entries: RepoTreeEntry[]): RepoTreeEntry[] {
  return entries.sort((left, right) =>
    left.type === right.type ? left.path.localeCompare(right.path) : left.type === "tree" ? -1 : 1,
  );
}

/**
 * The immediate children of `path`, or of the repository root when it is empty.
 *
 * The root is one non-recursive Git Trees call. A subdirectory takes the recursive tree of master
 * and keeps the entries one level below `path`: the Trees API addresses a subtree by its own sha,
 * which would cost a walk down from the root anyway, and the recursive read is a single
 * ETag-cached response that then serves every further step of the browse.
 */
async function listDirectory(
  client: GithubReleaseClient,
  path: string,
): Promise<RepoTreeEntry[] | null> {
  if (!path) {
    const root = await client.getTree(client.branch);
    return sortEntries(
      root.map((entry) => treeEntry(entry.path, entry.type, entry.sha, entry.size)),
    );
  }

  const prefix = `${path}/`;
  const entries = (await client.getTree(client.branch, { recursive: true }))
    .filter(
      (entry) => entry.path.startsWith(prefix) && !entry.path.slice(prefix.length).includes("/"),
    )
    .map((entry) => treeEntry(entry.path, entry.type, entry.sha, entry.size));
  return entries.length > 0 ? sortEntries(entries) : null;
}

export async function onRequestGet(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;

    const raw = new URL(context.request.url).searchParams.get("path")?.trim() ?? "";
    const path = raw ? normaliseRepoPath(raw) : "";
    if (path === null) return error(400, "Only a path inside the repository can be opened.");
    if (path && !isReadableRepoPath(path)) {
      const reason = fileEditRefusal(path) ?? "That path cannot be opened from the panel.";
      return json({ ok: false, error: reason, code: "denied-path" }, 403);
    }

    const client = createGithubClient(context.env);
    const ref = client.branch;

    // A path is a file first and a directory second: the Contents read is one call and answers
    // for the overwhelmingly common case, and only its miss costs the tree walk.
    const blob = path
      ? await client.getContent(path, { essential: false, label: `file ${path}` })
      : null;

    if (blob) {
      const refusal = fileEditRefusal(blob.path) ?? unreadableReason(blob.unreadable);
      const file: RepoFile = {
        path: blob.path,
        sha: blob.sha,
        size: blob.size,
        content: blob.content,
        editable: refusal === null,
      };
      if (blob.unreadable) file.unreadable = blob.unreadable;
      if (refusal) file.editRefusal = refusal;
      return json({ ok: true, ref, path: blob.path, file });
    }

    const entries = await listDirectory(client, path);
    if (!entries) return error(404, `GitHub has no ${path} on ${ref}.`);

    const payload: RepoTreeResponse = { ok: true, ref, path, entries };
    return json(payload);
  } catch (err) {
    return releaseFailure(context.request, err);
  }
}

/* ────────────────────────────────── The write half ────────────────────────────────── */

/**
 * The body cap. A file is 512 KB at most (§11), and JSON escaping of a text blob can roughly
 * double it, so the envelope gets room the content itself never has.
 */
const MAX_PUT_BODY_BYTES = 1_100 * 1024;

const OVERSIZED_REASON = `That file is larger than the ${Math.floor(MAX_EDITABLE_FILE_BYTES / 1024)} KB the panel edits.`;

/**
 * §11: `.github/workflows/**` is allowed **only** with `workflowsConfirm: true`, a live Workflows
 * scope and its own modal — a workflow edit is remote code execution on a runner holding the
 * release token.
 *
 * The scope is read off the resolved token rather than probed, because a fine-grained token's
 * permissions cannot be asked for: §5 defines exactly one variable whose token carries Workflows —
 * `GITHUB_RELEASE_TOKEN` — and `tokenStatus().source` names that variable without ever carrying its
 * value. A deployment still running on the read-only `GITHUB_TOKEN` is therefore refused here, with
 * the reason that names the variable, rather than three calls into a commit sequence by a GitHub
 * `403` the panel can only report as "GitHub rejected the panel's token".
 *
 * This runs **before** the write-token gate, so the specific reason wins over the general one.
 */
function workflowRefusal(
  client: GithubReleaseClient,
  path: string,
  workflowsConfirm: unknown,
): string | null {
  if (!isWorkflowPath(path)) return null;
  if (workflowsConfirm !== true) {
    return "Editing a workflow needs its own confirmation: it runs on a GitHub runner that holds the release token.";
  }
  if (client.tokenStatus().source !== RELEASE_TOKEN_VAR) {
    return `Editing a workflow needs the Workflows scope, which only ${RELEASE_TOKEN_VAR} carries.`;
  }
  return null;
}

function deniedPath(message: string): Response {
  return json({ ok: false, error: message, code: "denied-path" }, 403);
}

export async function onRequestPut(context: HandlerContext): Promise<Response> {
  const access = await requireDashboardAccess(context.request, context.env);
  if (!access.ok) return access.response;

  const db = context.env.DB;
  if (!db) return error(500, "Database not available");
  const actor = access.access.user.email;

  const limited = limitByActor(context.request, RELEASE_LIMITS.files, actor);
  if (limited) return limited;

  try {
    const client = createGithubClient(context.env);

    let body: unknown;
    try {
      body = await readJsonBody<unknown>(context.request, MAX_PUT_BODY_BYTES);
    } catch (cause) {
      return error(400, jsonBodyErrorMessage(cause));
    }
    if (!isObject(body)) return error(400, "A file commit is required.");
    if (typeof body.path !== "string") return error(400, "path is required.");
    if (typeof body.content !== "string") return error(400, "content must be text.");
    if (typeof body.commitMessage !== "string" || !body.commitMessage.trim()) {
      return error(400, "commitMessage is required.");
    }
    if (typeof body.baseSha !== "string") {
      return error(400, "baseSha must be the blob sha the editor loaded.");
    }

    const path = normaliseRepoPath(body.path);
    if (!path) return error(400, "Only a path inside the repository can be committed.");

    // The denylist first, and before any GitHub call: §11's paths are refused whether or not the
    // client bothered to read `editable` off the GET.
    const refusal = fileEditRefusal(path);
    if (refusal) return deniedPath(refusal);
    const workflows = workflowRefusal(client, path, body.workflowsConfirm);
    if (workflows) return deniedPath(workflows);

    const tokenRefusal = refuseWithoutWriteToken(client);
    if (tokenRefusal) return tokenRefusal;

    if (new TextEncoder().encode(body.content).byteLength > MAX_EDITABLE_FILE_BYTES) {
      return error(400, OVERSIZED_REASON);
    }

    const confirmed = await requireConfirm(context.env, body.confirmToken, {
      action: "commit",
      subject: path,
      actor,
    });
    if (!confirmed.ok) return confirmed.response;

    await ensureReleasesSchema(context.env);

    // The lost-update guard, checked up front rather than only on `commitFiles`' retry: an editor
    // that loaded a blob and took five minutes must lose to whoever committed meanwhile.
    const baseSha = body.baseSha.trim();
    const current = await client.getContent(path, {
      essential: true,
      fresh: true,
      label: `file ${path}`,
    });
    const currentSha = current?.sha ?? null;
    if (currentSha !== (baseSha || null)) {
      return json(
        {
          ok: false,
          error: currentSha
            ? `${path} changed on ${client.branch} since it was opened — reload and try again.`
            : `${path} no longer exists on ${client.branch} — reload and try again.`,
          code: "stale",
        },
        409,
      );
    }

    const commit = await client.commitFiles({
      files: [{ path, content: body.content, baseSha: baseSha || null }],
      message: body.commitMessage.trim(),
    });

    await recordWrite(context.env, db, {
      draftId: null,
      kind: "file_committed",
      actor,
      detail: `${path} committed on ${client.branch} (${commit.commitSha.slice(0, 7)}).`,
      target: path,
      action: RELEASE_AUDIT.fileCommit,
    });

    const payload: FilePutResponse = {
      ok: true,
      commitSha: commit.commitSha,
      path,
      sha: commit.blobShas[path] ?? "",
    };
    return json(payload);
  } catch (err) {
    await recordGithubFailure(db, null, actor, err);
    return releaseFailure(context.request, err);
  }
}
