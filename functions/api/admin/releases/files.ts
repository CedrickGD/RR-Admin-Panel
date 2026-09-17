/**
 * `GET /api/admin/releases/files` — the Files tab's reader: a blob, or the listing of a directory
 * on master. Design: docs/release-management-design.md §6 and §9 ("a path field, a tree browser
 * (Git Trees on master)"). The write half (`PUT`) lives beside this handler and shares its
 * denylist, `functions/_lib/release-files.ts`.
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
import { createGithubClient, type GithubReleaseClient } from "../../../_lib/github-release";
import { error, json } from "../../../_lib/http";
import {
  fileEditRefusal,
  isReadableRepoPath,
  normaliseRepoPath,
} from "../../../_lib/release-files";
import { releaseFailure } from "../../../_lib/releases-route";
import type { RuntimeEnv } from "../../../_lib/types";
import type {
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
