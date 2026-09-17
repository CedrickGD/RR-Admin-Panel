/**
 * The three lines every route under `functions/api/admin/releases/` would otherwise repeat.
 *
 * The important one is `releaseFailure`: a `GithubApiError` already carries the status this panel
 * answers with and a sentence written in `github-release.ts`, so it is returned as-is — while
 * anything unrecognised goes through `internalError`, which redacts the cause and never lets an
 * internal message reach the browser. Neither path can carry a token: the client never puts one in
 * an error, and no GitHub response body is read (§5, §11).
 */
import { apiErrorBody, isGithubApiError } from "./github-release";
import { decodeKeyParam, json } from "./http";
import { internalError } from "./responses";

export function releaseFailure(request: Request, cause: unknown): Response {
  if (isGithubApiError(cause)) {
    const { body, status } = apiErrorBody(cause);
    return json(body, status);
  }
  return internalError(request, "Unable to complete the request.", cause);
}

/** A positive integer route parameter — a draft id or a GitHub release id — or null. */
export function idFromParam(raw: string | undefined | null): number | null {
  const id = Number.parseInt(decodeKeyParam(raw), 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Bounded, integral `limit` query parameter. */
export function limitFromQuery(raw: string | null, fallback: number, max: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(parsed, max));
}
