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

export async function downloadSessionExport(): Promise<void> {
  const url = new URL(apiUrl("/api/admin/sessions-export"), window.location.origin);
  url.searchParams.set("_ts", String(Date.now()));

  const res = await fetch(url.toString(), {
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

  const match = contentDisposition.match(/filename="?([^"]+)"?/i);
  return match?.[1]?.trim() || null;
}

function defaultExportName(): string {
  return `rr-sessions-${new Date().toISOString().replaceAll(":", "-")}.txt`;
}
