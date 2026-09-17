/**
 * The plumbing every write under `functions/api/admin/releases/` would otherwise repeat. Design:
 * docs/release-management-design.md §6 and §11.
 *
 * Four things happen on the way into a release write, and skipping any one of them is a bug the
 * next handler would repeat:
 *
 *  - **The write-token gate.** §5: with anything but `mode: "write"` a mutating handler answers
 *    `409 { code: "no-write-token" }`, and it answers it before it reads a body or touches GitHub.
 *    The message is the one `tokenStatus` carries, which names the *variable* and never its value.
 *  - **The confirm token.** Minted by `POST …/confirm` with the effect list the modal printed,
 *    120 s, single-use. It is not a second authentication factor — `requireDashboardAccess` has
 *    already run — it is what stops a replayed or cross-tab click.
 *  - **The rate limit**, per actor rather than per IP: §11 fixes dispatch, build and
 *    publish/make-current at 10 an hour each and file commits at 30, and the bucket that matters
 *    is the person clicking, not the address they clicked from.
 *  - **Both audit rows.** §3 is explicit that `release_events` does not replace `auditPanel`, so
 *    `recordWrite` writes the pair and no caller writes one alone.
 */
import { GithubReleaseClient, isGithubApiError } from "./github-release";
import { error, json } from "./http";
import { auditPanel } from "./panel-access";
import { enforceRateLimit, type RateLimitRule } from "./ratelimit";
import {
  CONFIRM_FAILURE_MESSAGES,
  verifyConfirmToken,
  type ConfirmExpectation,
  type ConfirmVerifyOptions,
} from "./release-confirm";
import { appendEvent } from "./releases-store";
import type { D1Database, RuntimeEnv } from "./types";
import type { ApiError, ReleaseEventKind } from "../../shared/releases-contract";

/* ───────────────────────────────── Rate limits ───────────────────────────────── */

const HOUR_SECONDS = 3600;

export type ActorRateLimit = Omit<RateLimitRule, "key">;

/**
 * §11's buckets. `publish` is deliberately shared by publish and make-current — they are the two
 * actions that move what customers are offered, and ten of those in an hour is already generous.
 * `unpublish` gets the same ceiling in a bucket of its own: it is a governed release action §11
 * lists a confirm token for, and it is not one of the two the design pairs.
 *
 * `draft` is not in §11 at all, because draft CRUD writes no repository and no manifest. It still
 * gets a bucket, wide enough that the editor's Save never trips it, because an unlimited write is
 * how a loop in a page becomes a loop in a database.
 */
export const RELEASE_LIMITS = {
  draft: { route: "releases/drafts", limit: 60, windowSeconds: HOUR_SECONDS },
  build: { route: "releases/build", limit: 10, windowSeconds: HOUR_SECONDS },
  publish: { route: "releases/publish", limit: 10, windowSeconds: HOUR_SECONDS },
  unpublish: { route: "releases/unpublish", limit: 10, windowSeconds: HOUR_SECONDS },
  files: { route: "releases/files", limit: 30, windowSeconds: HOUR_SECONDS },
  dispatch: { route: "releases/dispatch", limit: 10, windowSeconds: HOUR_SECONDS },
} satisfies Record<string, ActorRateLimit>;

/**
 * The limit keyed by the panel e-mail, not the address. A `429` from here carries the contract's
 * `code: "rate-limited"`, which `enforceRateLimit`'s own body does not, so the editor can tell a
 * limit apart from any other refusal.
 */
export function limitByActor(
  request: Request,
  rule: ActorRateLimit,
  actor: string,
): Response | null {
  const limited = enforceRateLimit(request, { ...rule, key: actor });
  if (!limited) return null;
  const retryAfter = limited.headers.get("retry-after");
  const body: ApiError = {
    ok: false,
    error: "Too many requests — this action is limited per hour.",
    code: "rate-limited",
  };
  return json(body, 429, retryAfter ? { "retry-after": retryAfter } : undefined);
}

/* ───────────────────────────────── The write token ───────────────────────────────── */

const NO_WRITE_TOKEN_FALLBACK =
  "Releases are read-only until GITHUB_RELEASE_TOKEN carries a fine-grained token with Contents, Actions and Workflows write access.";

/**
 * §5: every mutating handler refuses with `409 { code: "no-write-token" }` unless the resolved
 * token is in `write` mode — the `"placeholder"` the NAS env carries today included (decision 8).
 */
export function refuseWithoutWriteToken(client: GithubReleaseClient): Response | null {
  const status = client.tokenStatus();
  if (status.canWrite) return null;
  const body: ApiError = {
    ok: false,
    error: status.message ?? NO_WRITE_TOKEN_FALLBACK,
    code: "no-write-token",
  };
  return json(body, 409);
}

/* ─────────────────────────────── The confirm token ─────────────────────────────── */

export type ConfirmGate = { ok: true } | { ok: false; response: Response };

/**
 * Verifies the token the modal's button sent back. A missing one is a `400` (the client never
 * built the dialog), a bad one a `403` with the sentence `release-confirm.ts` wrote, and a
 * deployment with no `JWT_SECRET` a `500` saying exactly that.
 */
export async function requireConfirm(
  env: RuntimeEnv,
  token: unknown,
  expectation: ConfirmExpectation,
  options: ConfirmVerifyOptions = {},
): Promise<ConfirmGate> {
  if (typeof token !== "string" || !token.trim()) {
    return { ok: false, response: error(400, "A confirmation is required for this action.") };
  }
  const verified = await verifyConfirmToken(env, token, expectation, options);
  if (verified.ok) return { ok: true };
  const message = CONFIRM_FAILURE_MESSAGES[verified.reason];
  return {
    ok: false,
    response:
      verified.reason === "no-secret"
        ? error(500, message)
        : json({ ok: false, error: message }, 403),
  };
}

/* ──────────────────────────────── Audit, both rows ──────────────────────────────── */

/** `panel_audit.action` per governed write, so one grep finds every release action. */
export const RELEASE_AUDIT = {
  draftCreated: "release.draft.create",
  draftUpdated: "release.draft.update",
  draftDeleted: "release.draft.delete",
  build: "release.build",
  publish: "release.publish",
  makeCurrent: "release.make-current",
  unpublish: "release.unpublish",
  fileCommit: "release.file.commit",
  dispatch: "release.workflow.dispatch",
} as const;

export interface WriteRecord {
  /** Null for a repo-wide write — a Files-tab commit or a free-form dispatch. */
  draftId?: number | null;
  kind: ReleaseEventKind;
  /** Panel e-mail. */
  actor: string;
  /** One short line. Never a token, never a customer identifier. */
  detail: string;
  /** `panel_audit.target`: the tag, the draft id or the path the write names. */
  target: string;
  /** One of `RELEASE_AUDIT`. */
  action: string;
}

/** The `release_events` row **and** the `panel_audit` row §3 asks for, in that order. */
export async function recordWrite(
  env: RuntimeEnv,
  db: D1Database,
  record: WriteRecord,
): Promise<void> {
  await appendEvent(db, {
    draftId: record.draftId ?? null,
    kind: record.kind,
    actor: record.actor,
    detail: record.detail,
  });
  await auditPanel(env, record.actor, record.target, record.action, record.detail);
}

/**
 * §5: a `401`/`403` from GitHub becomes a `502` **plus a `release_events` `error` row**, so a
 * token the owner has to fix leaves a trace in the timeline rather than only in a toast. Anything
 * else is left to the route's own failure path; a failed insert is swallowed, because the request
 * has already failed and a second failure would only replace the useful message with a worse one.
 */
export async function recordGithubFailure(
  db: D1Database,
  draftId: number | null,
  actor: string,
  cause: unknown,
): Promise<void> {
  if (!isGithubApiError(cause)) return;
  if (cause.githubStatus !== 401 && cause.githubStatus !== 403) return;
  try {
    await appendEvent(db, { draftId, kind: "error", actor, detail: cause.message });
  } catch (err) {
    console.error("releases: error event not written", err);
  }
}
