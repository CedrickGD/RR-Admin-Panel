import type {
  AdminDataPayload,
  AuthActionPayload,
  SessionPayload,
} from "../types/telemetry";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${normalized}` : normalized;
}

export async function fetchSession(): Promise<SessionPayload> {
  try {
    const res = await fetch(apiUrl("/api/auth/session"), {
      method: "GET",
      cache: "no-store",
      credentials: "include",
    });
    const body = await parseJson<SessionPayload>(res);
    if (!res.ok || typeof body?.authenticated !== "boolean") {
      return { authenticated: false, hasUsers: true, authMode: "access" };
    }
    return body;
  } catch {
    return { authenticated: false, hasUsers: true, authMode: "access" };
  }
}

export async function fetchAdminData(): Promise<{
  ok: boolean;
  data?: AdminDataPayload;
  status: number;
}> {
  const url = new URL(apiUrl("/api/admin/data"), window.location.origin);
  url.searchParams.set("_ts", String(Date.now()));
  const res = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  });
  const body = await parseJson<AdminDataPayload>(res);
  return { ok: res.ok, data: body, status: res.status };
}

export async function postAuth(
  endpoint: string,
  email: string,
  password: string
): Promise<{ ok: boolean; data?: AuthActionPayload; status: number }> {
  const res = await fetch(apiUrl(endpoint), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
    credentials: "include",
  });
  const body = await parseJson<AuthActionPayload>(res);
  return { ok: res.ok, data: body, status: res.status };
}

export async function postLogout(): Promise<void> {
  try {
    await fetch(apiUrl("/api/auth/logout"), {
      method: "POST",
      credentials: "include",
    });
  } catch {
    // no-op
  }
}
