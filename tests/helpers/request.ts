export interface SyntheticRequestOptions {
  method?: string;
  path?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  headers?: HeadersInit;
  json?: unknown;
}

const SYNTHETIC_ORIGIN = "https://admin.test";

export function accessIdentityHeaders(email: string, initialHeaders?: HeadersInit): Headers {
  const headers = new Headers(initialHeaders);
  headers.set("cf-access-authenticated-user-email", email);
  return headers;
}

export function createSyntheticRequest(options: SyntheticRequestOptions = {}): Request {
  const url = new URL(options.path ?? "/", SYNTHETIC_ORIGIN);
  if (url.origin !== SYNTHETIC_ORIGIN) {
    throw new Error(`Synthetic requests must use the fixed ${SYNTHETIC_ORIGIN} origin.`);
  }

  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== null && value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const headers = new Headers(options.headers);
  const hasJson = options.json !== undefined;
  if (hasJson && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return new Request(url, {
    method: options.method ?? (hasJson ? "POST" : "GET"),
    headers,
    body: hasJson ? JSON.stringify(options.json) : undefined,
  });
}
