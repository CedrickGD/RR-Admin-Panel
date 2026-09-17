/**
 * The Releases page's data layer (docs/release-management-design.md §9).
 *
 * Every call the page makes lives here, so `ReleasesPage.tsx` holds presentation and nothing
 * else. Two rules shape the module:
 *
 *  - **One read on load.** §6 says `GET /api/admin/releases` answers the whole page — token
 *    status, releases, drafts, runs, the manifest and adoption — so `useReleases` is the only
 *    thing that fetches when the page mounts. The tabs that need more (workflows, files,
 *    commits, a run) ask for it when they are opened, never before.
 *  - **A mutation is never retried.** `fetchApi` retries an idempotent request once; a confirm
 *    token is single-use, so a retried POST would burn it and the second attempt would fail with
 *    a refusal the operator cannot act on. Mutations therefore pass `{ retry: false }`.
 *
 * A refusal keeps its body: `unpublish` answers `409 { code: "manifest-pinned",
 * makeCurrentCandidates }` and the page renders those candidates inline, so `ReleasesApiError`
 * carries the parsed JSON rather than just a sentence.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl, fetchApi } from "../utils/api";
import { useRefreshSignal } from "../utils/refreshBus";
import {
  RELEASES_API_VERSION,
  type ApiError,
  type BuildRequest,
  type BuildResponse,
  type CommitsSinceResponse,
  type ConfirmAction,
  type ConfirmTokenResponse,
  type FilePutRequest,
  type FilePutResponse,
  type MakeCurrentCandidate,
  type MakeCurrentRequest,
  type MakeCurrentResponse,
  type PublishRequest,
  type PublishResponse,
  type ReleaseDraft,
  type ReleaseDraftInput,
  type ReleaseDraftPatch,
  type ReleasesOverviewResponse,
  type RepoFile,
  type RepoTreeEntry,
  type RunDetailResponse,
  type UnpublishResponse,
  type WorkflowDispatchRequest,
  type WorkflowRunSummary,
  type WorkflowSummary,
} from "../../shared/releases-contract";

const BASE = "/api/admin/releases";
/** Background re-read of the overview. The run panel drives its own, faster poll. */
const OVERVIEW_REFRESH_MS = 60_000;
/** What §6 promises for a running build, and what a failed poll falls back to. */
export const RUN_POLL_SECONDS = 10;

/** A refusal the page has to read, not just print: the body carries the way out of it. */
export class ReleasesApiError extends Error {
  readonly status: number;
  readonly code: ApiError["code"] | undefined;
  readonly body: Record<string, unknown>;

  constructor(status: number, message: string, body: Record<string, unknown>) {
    super(message);
    this.name = "ReleasesApiError";
    this.status = status;
    this.code = typeof body.code === "string" ? (body.code as ApiError["code"]) : undefined;
    this.body = body;
  }
}

/** The candidates a blocked unpublish offers, or an empty list when it was refused for anything else. */
export function makeCurrentCandidatesOf(error: unknown): MakeCurrentCandidate[] {
  if (!(error instanceof ReleasesApiError) || error.code !== "manifest-pinned") return [];
  const candidates = error.body.makeCurrentCandidates;
  return Array.isArray(candidates) ? (candidates as MakeCurrentCandidate[]) : [];
}

export function releasesErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ReleasesApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

async function request<T>(path: string, init: RequestInit = {}, mutating = false): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("x-releases-api", String(RELEASES_API_VERSION));
  const response = await fetchApi(
    apiUrl(`${BASE}${path}`),
    { ...init, headers, credentials: "include", cache: "no-store" },
    mutating ? { retry: false } : undefined,
  );
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  const body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  if (!response.ok || body.ok === false) {
    const message =
      typeof body.error === "string" && body.error
        ? body.error
        : `The release API answered ${response.status}.`;
    throw new ReleasesApiError(response.status, message, body);
  }
  return parsed as T;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) }, true);
}

/* ─────────────────────────────────── The calls ─────────────────────────────────── */

export function fetchOverview(): Promise<ReleasesOverviewResponse> {
  return request<ReleasesOverviewResponse>("");
}

export function fetchCommitsSince(sinceTag: string | null): Promise<CommitsSinceResponse> {
  const query = sinceTag ? `?since=${encodeURIComponent(sinceTag)}` : "";
  return request<CommitsSinceResponse>(`/commits${query}`);
}

/** Mints the token **and** the effect list the modal prints verbatim (§6). */
export function mintConfirmToken(
  action: ConfirmAction,
  subject: string,
): Promise<ConfirmTokenResponse> {
  return post<ConfirmTokenResponse>("/confirm", { action, subject });
}

export function createDraft(input: ReleaseDraftInput): Promise<{ ok: true; draft: ReleaseDraft }> {
  return post<{ ok: true; draft: ReleaseDraft }>("/drafts", input);
}

export function saveDraft(
  id: number,
  patch: ReleaseDraftPatch,
): Promise<{ ok: true; draft: ReleaseDraft }> {
  return request<{ ok: true; draft: ReleaseDraft }>(
    `/drafts/${id}`,
    { method: "PUT", body: JSON.stringify(patch) },
    true,
  );
}

export function deleteDraft(id: number): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/drafts/${id}`, { method: "DELETE" }, true);
}

export function buildDraft(id: number, body: BuildRequest): Promise<BuildResponse> {
  return post<BuildResponse>(`/drafts/${id}/build`, body);
}

export function publishDraft(id: number, body: PublishRequest): Promise<PublishResponse> {
  return post<PublishResponse>(`/drafts/${id}/publish`, body);
}

export function fetchRun(id: number): Promise<RunDetailResponse> {
  return request<RunDetailResponse>(`/drafts/${id}/run`);
}

export function makeCurrent(
  releaseId: number,
  body: MakeCurrentRequest,
): Promise<MakeCurrentResponse> {
  return post<MakeCurrentResponse>(`/${releaseId}/make-current`, body);
}

export function unpublishRelease(
  releaseId: number,
  confirmToken: string,
): Promise<UnpublishResponse> {
  return post<UnpublishResponse>(`/${releaseId}/unpublish-to-draft`, { confirmToken });
}

/** A path is a blob or a directory; nothing else distinguishes the two answers. */
export type RepoPathResponse =
  | { ok: true; ref: string; path: string; file: RepoFile; entries?: undefined }
  | { ok: true; ref: string; path: string; entries: RepoTreeEntry[]; file?: undefined };

export function fetchRepoPath(path: string): Promise<RepoPathResponse> {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  return request<RepoPathResponse>(`/files${query}`);
}

export function commitRepoFile(body: FilePutRequest): Promise<FilePutResponse> {
  return request<FilePutResponse>("/files", { method: "PUT", body: JSON.stringify(body) }, true);
}

export function dispatchWorkflow(
  workflowId: number,
  body: WorkflowDispatchRequest,
): Promise<{ ok: true }> {
  return post<{ ok: true }>(`/workflows/${workflowId}/dispatch`, body);
}

/* ─────────────────────────────────── The hooks ─────────────────────────────────── */

export interface ReleasesOverviewState {
  data: ReleasesOverviewResponse | null;
  loading: boolean;
  error: string | null;
  /** Re-read without blanking what is on screen. */
  refresh: () => void;
}

/**
 * The one load the page makes. A background re-read never clears the visible payload: the page
 * is a console for a slow, deliberate operation, and a blink on every minute would be worse than
 * a value that is up to a minute old.
 */
export function useReleases(): ReleasesOverviewState {
  const [data, setData] = useState<ReleasesOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const mounted = useRef(true);

  const load = useCallback(async (silent: boolean) => {
    const ticket = ++seq.current;
    if (!silent) setLoading(true);
    try {
      const payload = await fetchOverview();
      if (ticket !== seq.current || !mounted.current) return;
      setData(payload);
      setError(null);
    } catch (cause) {
      if (ticket !== seq.current || !mounted.current) return;
      setError(releasesErrorMessage(cause, "The releases overview could not be loaded."));
    } finally {
      if (ticket === seq.current && mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load(false);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, OVERVIEW_REFRESH_MS);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
    };
  }, [load]);

  useRefreshSignal(() => void load(true));

  return { data, loading, error, refresh: useCallback(() => void load(true), [load]) };
}

export interface RunState {
  detail: RunDetailResponse | null;
  error: string | null;
}

/**
 * The run panel's poll. `pollAfterSeconds` is the server's own cadence — 10 while the build
 * runs, 0 once it is finished — so the loop stops by itself and `onFinished` lets the page
 * re-read the overview once, where the draft has just become `built` or `failed`.
 */
export function useRunStatus(
  draftId: number | null,
  active: boolean,
  onFinished?: () => void,
): RunState {
  const [detail, setDetail] = useState<RunDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Kept in a ref so a fresh callback identity on every render cannot restart the poll.
  const finished = useRef(onFinished);
  finished.current = onFinished;

  useEffect(() => {
    if (draftId === null || !active) {
      setDetail(null);
      setError(null);
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    let sawRunning = false;

    const tick = async () => {
      try {
        const next = await fetchRun(draftId);
        if (cancelled) return;
        setDetail(next);
        setError(null);
        if (next.pollAfterSeconds > 0) {
          sawRunning = true;
          timer = window.setTimeout(() => void tick(), next.pollAfterSeconds * 1000);
        } else if (sawRunning) {
          sawRunning = false;
          finished.current?.();
        }
      } catch (cause) {
        if (cancelled) return;
        setError(releasesErrorMessage(cause, "The build status could not be read."));
        timer = window.setTimeout(() => void tick(), RUN_POLL_SECONDS * 1000);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [draftId, active]);

  return { detail, error };
}

export interface WorkflowsState {
  workflows: WorkflowSummary[];
  runs: WorkflowRunSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/** The Workflows tab's two lists, read only once the tab is opened. */
export function useWorkflows(enabled: boolean): WorkflowsState {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [runs, setRuns] = useState<WorkflowRunSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, recent] = await Promise.all([
        request<{ ok: true; workflows: WorkflowSummary[] }>("/workflows"),
        request<{ ok: true; runs: WorkflowRunSummary[] }>("/workflows/runs"),
      ]);
      if (!mounted.current) return;
      setWorkflows(list.workflows ?? []);
      setRuns(recent.runs ?? []);
      setError(null);
    } catch (cause) {
      if (!mounted.current) return;
      setError(releasesErrorMessage(cause, "The workflows could not be loaded."));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (enabled) void load();
    return () => {
      mounted.current = false;
    };
  }, [enabled, load]);

  return { workflows, runs, loading, error, refresh: useCallback(() => void load(), [load]) };
}
