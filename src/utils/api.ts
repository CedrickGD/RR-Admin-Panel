import type {
  AdminDataPayload,
  AuthActionPayload,
  ErrorsPayload,
  InstallRecord,
  SessionPayload,
  StatsFilters,
  StatsPayload,
  SuspensionRecord,
  UserActivityPayload,
  UserRollupRecord,
} from "../types/telemetry";
import type {
  Customer360Response,
  Customer360Selector,
  IssueLicenseInput,
  LicenseOperationResponse,
  LicenseSearchResponse,
} from "../types/customer360";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");

const REQUEST_TIMEOUT_MS = 12_000;
const RETRY_DELAY_MS = 400;
const JSON_MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// A full-page reload renews the Cloudflare Access session via silent SSO. Guard
// it so a misbehaving edge can never put the app into a reload loop.
const AUTH_RELOAD_GUARD_KEY = "rr:auth-reload-at";
const AUTH_RELOAD_MIN_INTERVAL_MS = 2 * 60 * 1000;

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

/**
 * The dashboard sits behind Cloudflare Access. When the Access session expires,
 * the edge intercepts every /api call with a 302 to cloudflareaccess.com — the
 * Function never runs, fetch can't follow cross-origin, and without handling the
 * whole app just goes dead until a manual page reload. `redirect: "manual"`
 * makes that state detectable (an opaqueredirect: same-origin /api routes never
 * legitimately redirect), and a guarded full reload lets Access re-authenticate
 * silently and the dashboard come back on its own.
 */
function isAuthRedirect(res: Response): boolean {
  return res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400);
}

function triggerAuthReload(): void {
  try {
    const last = Number(sessionStorage.getItem(AUTH_RELOAD_GUARD_KEY));
    if (Number.isFinite(last) && Date.now() - last < AUTH_RELOAD_MIN_INTERVAL_MS) {
      return;
    }
    sessionStorage.setItem(AUTH_RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    // No sessionStorage (private mode edge case): never risk a reload loop.
    return;
  }
  window.location.reload();
}

export class SessionExpiredError extends Error {
  constructor() {
    super("Access session expired; reloading to re-authenticate.");
    this.name = "SessionExpiredError";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchOnce(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, redirect: "manual", signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Dashboard mutations are JSON-only. Add the required content type centrally so bodyless
 * mutations (notably DELETE) still satisfy the server contract after passing through adapters
 * that represent an empty request as a body stream.
 */
export function withJsonMutationHeaders(init: RequestInit): RequestInit {
  const method = (init.method ?? "GET").toUpperCase();
  if (!JSON_MUTATION_METHODS.has(method)) return init;

  const headers = new Headers(init.headers);
  if (headers.has("content-type")) return init;

  headers.set("content-type", "application/json");
  return { ...init, headers };
}

/**
 * Fetch with the failure handling every dashboard call needs:
 * - hard timeout, so a hung request can never wedge a refresh forever;
 * - Access-expiry detection -> guarded self-reload (see isAuthRedirect);
 * - for idempotent requests, one automatic retry on network error, timeout, or
 *   5xx, so a transient D1/edge blip never surfaces to the user at all.
 */
export async function fetchApi(url: string, init: RequestInit, options?: { retry?: boolean }): Promise<Response> {
  const retry = options?.retry ?? true;
  const normalizedInit = withJsonMutationHeaders(init);

  let response: Response | null = null;
  try {
    response = await fetchOnce(url, normalizedInit);
  } catch (err) {
    if (!retry) throw err;
  }

  if (response && isAuthRedirect(response)) {
    triggerAuthReload();
    throw new SessionExpiredError();
  }

  if (!retry || (response && response.status < 500)) {
    if (!response) throw new Error("Request failed.");
    return response;
  }

  await delay(RETRY_DELAY_MS);
  const second = await fetchOnce(url, normalizedInit);
  if (isAuthRedirect(second)) {
    triggerAuthReload();
    throw new SessionExpiredError();
  }
  return second;
}

export function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${normalized}` : normalized;
}

function isSessionPayload(value: unknown): value is SessionPayload {
  if (!value || typeof value !== "object") return false;

  const session = value as Partial<SessionPayload>;
  if (typeof session.authenticated !== "boolean" || typeof session.hasUsers !== "boolean") {
    return false;
  }
  if (
    session.authMode !== undefined &&
    session.authMode !== "access" &&
    session.authMode !== "app"
  ) {
    return false;
  }
  if (!session.authenticated) return true;

  return Boolean(
    session.user &&
    typeof session.user.email === "string" &&
    (session.user.role === "admin" || session.user.role === "viewer"),
  );
}

export async function fetchSession(): Promise<SessionPayload> {
  const res = await fetchApi(apiUrl("/api/auth/session"), {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  });
  const body = await parseJson<unknown>(res);

  // Only a successful, schema-valid response may make an authentication
  // decision. Network failures, timeouts, edge/JWKS 5xx responses and invalid
  // JSON are availability failures, not evidence that the user signed out.
  if (!res.ok) {
    throw new Error(`Session verification failed with status ${res.status}.`);
  }
  if (!isSessionPayload(body)) {
    throw new Error("Session verification returned an invalid response.");
  }

  return body;
}

export async function fetchAdminData(): Promise<{
  ok: boolean;
  data?: AdminDataPayload;
  status: number;
}> {
  const url = new URL(apiUrl("/api/admin/data"), window.location.origin);
  url.searchParams.set("_ts", String(Date.now()));
  const res = await fetchApi(url.toString(), {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  });
  const body = await parseJson<AdminDataPayload>(res);
  return { ok: res.ok, data: body, status: res.status };
}

function applyStatsFilters(url: URL, filters: StatsFilters): void {
  url.searchParams.set("range", filters.range);
  if (filters.version) url.searchParams.set("version", filters.version);
  if (filters.platform) url.searchParams.set("platform", filters.platform);
  if (filters.country) url.searchParams.set("country", filters.country);
  url.searchParams.set("_ts", String(Date.now()));
}

export async function fetchAdminStats(filters: StatsFilters): Promise<{
  ok: boolean;
  stats?: StatsPayload;
  status: number;
}> {
  const url = new URL(apiUrl("/api/admin/stats"), window.location.origin);
  applyStatsFilters(url, filters);
  const res = await fetchApi(url.toString(), {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  });
  const body = await parseJson<{ ok?: boolean; stats?: StatsPayload }>(res);
  return { ok: res.ok && Boolean(body?.stats), stats: body?.stats, status: res.status };
}

export async function fetchAdminUsers(filters: StatsFilters): Promise<{
  ok: boolean;
  users?: UserRollupRecord[];
  status: number;
}> {
  const url = new URL(apiUrl("/api/admin/users"), window.location.origin);
  applyStatsFilters(url, filters);
  const res = await fetchApi(url.toString(), {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  });
  const body = await parseJson<{ ok?: boolean; users?: UserRollupRecord[] }>(res);
  return { ok: res.ok && Array.isArray(body?.users), users: body?.users, status: res.status };
}

export async function fetchUserActivity(identity: string, range: string): Promise<{
  ok: boolean;
  activity?: UserActivityPayload;
  status: number;
}> {
  const url = new URL(apiUrl("/api/admin/user-activity"), window.location.origin);
  url.searchParams.set("identity", identity);
  url.searchParams.set("range", range);
  url.searchParams.set("_ts", String(Date.now()));
  const res = await fetchApi(url.toString(), {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  });
  const body = await parseJson<{ ok?: boolean; activity?: UserActivityPayload }>(res);
  return { ok: res.ok && Boolean(body?.activity), activity: body?.activity, status: res.status };
}

export async function fetchAdminErrors(range: string): Promise<{
  ok: boolean;
  errors?: ErrorsPayload;
  status: number;
}> {
  const url = new URL(apiUrl("/api/admin/errors"), window.location.origin);
  url.searchParams.set("range", range);
  url.searchParams.set("_ts", String(Date.now()));
  const res = await fetchApi(url.toString(), {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  });
  const body = await parseJson<{ ok?: boolean; errors?: ErrorsPayload }>(res);
  return { ok: res.ok && Boolean(body?.errors), errors: body?.errors, status: res.status };
}

export async function fetchAdminSuspensions(): Promise<{
  ok: boolean;
  suspensions?: SuspensionRecord[];
  status: number;
}> {
  const url = new URL(apiUrl("/api/admin/access"), window.location.origin);
  url.searchParams.set("_ts", String(Date.now()));
  const res = await fetchApi(url.toString(), {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  });
  const body = await parseJson<{ ok?: boolean; suspensions?: SuspensionRecord[] }>(res);
  return { ok: res.ok && Array.isArray(body?.suspensions), suspensions: body?.suspensions, status: res.status };
}

export interface SuspendInput {
  identity: string;
  hwid?: string | null;
  install_id?: string | null;
  user_label?: string | null;
  mode: "ban" | "suspend";
  reason?: string | null;
  banned_until?: string | null;
}

export interface SuspendResult {
  ok: boolean;
  error?: string;
  had_paid_license?: boolean;
  paid_license_keys?: string[];
}

export async function postSuspend(input: SuspendInput): Promise<{ ok: boolean; data?: SuspendResult; status: number }> {
  // No retry: suspending is a deliberate, non-idempotent-feeling admin action.
  const res = await fetchApi(
    apiUrl("/api/admin/access/suspend"),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      credentials: "include",
    },
    { retry: false },
  );
  const body = await parseJson<SuspendResult>(res);
  return { ok: res.ok && Boolean(body?.ok), data: body, status: res.status };
}

export async function postLiftSuspension(identity: string): Promise<{ ok: boolean; status: number }> {
  const res = await fetchApi(
    apiUrl("/api/admin/access/lift"),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identity }),
      credentials: "include",
    },
    { retry: false },
  );
  const body = await parseJson<{ ok?: boolean }>(res);
  return { ok: res.ok && Boolean(body?.ok), status: res.status };
}

export async function fetchInstalls(hwid: string): Promise<{
  ok: boolean;
  installs?: InstallRecord[];
  status: number;
}> {
  const url = new URL(apiUrl("/api/admin/installs"), window.location.origin);
  url.searchParams.set("hwid", hwid);
  url.searchParams.set("_ts", String(Date.now()));
  const res = await fetchApi(url.toString(), {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  });
  const body = await parseJson<{ ok?: boolean; installs?: InstallRecord[] }>(res);
  return { ok: res.ok && Array.isArray(body?.installs), installs: body?.installs, status: res.status };
}

export async function revokeInstall(installId: string, reason: string | null): Promise<{ ok: boolean; status: number; error?: string }> {
  // No retry: revoking a signing key is a deliberate admin action (the server is idempotent,
  // but an automatic repeat would hide a failed first attempt).
  const res = await fetchApi(
    apiUrl(`/api/admin/installs/${encodeURIComponent(installId)}/revoke`),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
      credentials: "include",
    },
    { retry: false },
  );
  const body = await parseJson<{ ok?: boolean; error?: string }>(res);
  return { ok: res.ok && Boolean(body?.ok), status: res.status, error: body?.error };
}

export async function postAuth(
  endpoint: string,
  email: string,
  password: string
): Promise<{ ok: boolean; data?: AuthActionPayload; status: number }> {
  // No retry: login/bootstrap are not idempotent from the user's point of view.
  const res = await fetchApi(apiUrl(endpoint), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
    credentials: "include",
  }, { retry: false });
  const body = await parseJson<AuthActionPayload>(res);
  return { ok: res.ok, data: body, status: res.status };
}

export async function postLogout(): Promise<void> {
  try {
    await fetchApi(apiUrl("/api/auth/logout"), {
      method: "POST",
      credentials: "include",
    }, { retry: false });
  } catch {
    // no-op
  }
}

export async function fetchCustomer360(
  selector: Customer360Selector,
  value: string,
): Promise<{ ok: boolean; data?: Customer360Response; status: number }> {
  const url = new URL(apiUrl("/api/admin/customer-360"), window.location.origin);
  url.searchParams.set(selector, value);
  const res = await fetchApi(url.toString(), {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  });
  const body = await parseJson<Customer360Response>(res);
  return { ok: res.ok && body.ok === true && Boolean(body.customer), data: body, status: res.status };
}

export async function searchAdminLicenses(
  selector: "order_id" | "customer",
  value: string,
): Promise<{ ok: boolean; data?: LicenseSearchResponse; status: number }> {
  const url = new URL(apiUrl("/api/admin/licenses/search"), window.location.origin);
  url.searchParams.set(selector, value);
  const res = await fetchApi(url.toString(), {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  });
  const body = await parseJson<LicenseSearchResponse>(res);
  return { ok: res.ok && body.ok === true && Array.isArray(body.licenses), data: body, status: res.status };
}

export async function issueAdminLicense(
  input: IssueLicenseInput,
): Promise<{ ok: boolean; data?: LicenseOperationResponse; status: number }> {
  const res = await fetchApi(
    apiUrl("/api/admin/licenses/issue"),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": input.idempotency_key,
      },
      body: JSON.stringify(input),
      credentials: "include",
    },
    { retry: false },
  );
  const body = await parseJson<LicenseOperationResponse>(res);
  return { ok: res.ok && body.ok === true, data: body, status: res.status };
}

export async function activateAdminLicense(
  licenseKey: string,
  input: { install_id: string; reason?: string; idempotency_key: string },
): Promise<{ ok: boolean; data?: LicenseOperationResponse; status: number }> {
  return postLicenseOperation(licenseKey, "activate", input);
}

export async function bindAdminLicense(
  licenseKey: string,
  input: { hwid: string; install_id?: string; reason?: string; idempotency_key: string },
): Promise<{ ok: boolean; data?: LicenseOperationResponse; status: number }> {
  return postLicenseOperation(licenseKey, "bind", input);
}

async function postLicenseOperation(
  licenseKey: string,
  action: "activate" | "bind",
  input: Record<string, string | undefined>,
): Promise<{ ok: boolean; data?: LicenseOperationResponse; status: number }> {
  const idempotencyKey = input.idempotency_key;
  const res = await fetchApi(
    apiUrl(`/api/admin/licenses/${encodeURIComponent(licenseKey)}/${action}`),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify(input),
      credentials: "include",
    },
    { retry: false },
  );
  const body = await parseJson<LicenseOperationResponse>(res);
  return { ok: res.ok && body.ok === true, data: body, status: res.status };
}

export async function downloadSessionExport(): Promise<void> {
  const url = new URL(apiUrl("/api/admin/sessions-export"), window.location.origin);
  url.searchParams.set("_ts", String(Date.now()));

  const res = await fetchApi(url.toString(), {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  });

  if (!res.ok) {
    const body = await parseJson<{ error?: string }>(res);
    throw new Error(body?.error ?? "Failed to download session export.");
  }

  const blob = await res.blob();
  const objectUrl = window.URL.createObjectURL(blob);
  const filename = readDownloadFilename(res.headers.get("content-disposition")) ?? defaultExportName();

  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => {
    window.URL.revokeObjectURL(objectUrl);
  }, 0);
}

function readDownloadFilename(contentDisposition: string | null): string | null {
  if (!contentDisposition) {
    return null;
  }

  const match = contentDisposition.match(/filename="([^"]+)"|filename=([^\s;]+)/i);
  return (match?.[1] ?? match?.[2])?.trim() || null;
}

function defaultExportName(): string {
  return `rr-sessions-${new Date().toISOString().replaceAll(":", "-")}.txt`;
}
