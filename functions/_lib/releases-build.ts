/**
 * Resolving the run a dispatch just started. Design: docs/release-management-design.md §6,
 * `POST …/drafts/:id/build` step 3 — "resolves the new run id (poll
 * `GET …/actions/runs?event=workflow_dispatch&branch=master` for ≤15 s)".
 *
 * GitHub's `workflow_dispatch` endpoint answers `204` and tells you nothing about the run it
 * created, so the run has to be found afterwards. A timestamp comparison would be the obvious way
 * and the wrong one — `created_at` has second precision and the panel's clock is not the runner's
 * — so this takes the set of dispatch-triggered run ids **before** the dispatch and waits for one
 * that is not in it. That is exact, and it cannot mistake a run somebody else started an instant
 * earlier for this one.
 *
 * Not finding a run is not a failure: `BuildResponse.runId` is nullable, the dispatch has happened
 * either way, and `…/drafts/:id/run` picks the build up again as soon as the id is known.
 */
import type { GithubReleaseClient } from "./github-release";
import type { WorkflowRunSummary } from "../../shared/releases-contract";

/** §6: at most fifteen seconds of waiting, and no backoff — a build takes minutes anyway. */
export const RUN_RESOLVE_DEADLINE_MS = 15_000;
export const RUN_RESOLVE_INTERVAL_MS = 1_500;

/** One page is plenty: the run this dispatch created is the newest of its kind. */
const RUN_PAGE = 10;

export interface ResolveRunOptions {
  /** The dispatch-triggered run ids that existed before the dispatch. */
  knownRunIds: ReadonlySet<number>;
  deadlineMs?: number;
  intervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The `workflow_dispatch` runs on the client's branch, newest first. A read that fails is an empty
 * page rather than an error: the poll's whole contract is "the id if it turns up in time".
 */
export async function listDispatchRuns(client: GithubReleaseClient): Promise<WorkflowRunSummary[]> {
  return client
    .listRuns({ event: "workflow_dispatch", branch: client.branch, limit: RUN_PAGE })
    .catch(() => []);
}

/** The ids `resolveDispatchedRun` treats as "already there". Read before the dispatch. */
export async function knownDispatchRunIds(client: GithubReleaseClient): Promise<Set<number>> {
  return new Set((await listDispatchRuns(client)).map((run) => run.id));
}

/** The first dispatch-triggered run id that is not already known, or null within the deadline. */
export async function resolveDispatchedRun(
  client: GithubReleaseClient,
  options: ResolveRunOptions,
): Promise<number | null> {
  const deadlineMs = options.deadlineMs ?? RUN_RESOLVE_DEADLINE_MS;
  const intervalMs = options.intervalMs ?? RUN_RESOLVE_INTERVAL_MS;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? defaultSleep;
  const startedAtMs = now();

  for (;;) {
    const fresh = (await listDispatchRuns(client)).find((run) => !options.knownRunIds.has(run.id));
    if (fresh) return fresh.id;
    if (now() - startedAtMs + intervalMs > deadlineMs) return null;
    await sleep(intervalMs);
  }
}
