/**
 * The `FakeGitHub` design §12 asks for: the seam `functions/_lib/github-release.ts` exposes is its
 * `fetch` option, so a test hands the client `github.fetch` and nothing leaves the process.
 *
 * Every request is recorded as a `"METHOD /path"` key, which is what the commit-sequence tests
 * assert the six calls in order with. An unmatched request is recorded in `unexpected` **and**
 * thrown, because the client's own "GitHub is unreachable" fallback would otherwise swallow a
 * typo in a route key and let a test pass for the wrong reason.
 */
import type { FetchLike } from "../../functions/_lib/github-release";

const ORIGIN = "https://api.github.com";

export interface FakeCall {
  method: string;
  /** Path and query, origin stripped. */
  url: string;
  /** Path only. */
  path: string;
  /** `"GET /repos/o/r/releases"` — what routes and order assertions match on. */
  key: string;
  /** Parsed JSON body, or undefined when the request carried none. */
  body: unknown;
  /** Lower-cased request headers. */
  headers: Record<string, string>;
}

export interface FakeReply {
  status?: number;
  /** Serialised as JSON. Omit for 204/304. */
  body?: unknown;
  /** Plain text, for the job-log endpoint. */
  text?: string;
  headers?: Record<string, string>;
}

export type FakeResponder = (call: FakeCall) => FakeReply | Promise<FakeReply>;

type Matcher = string | RegExp;

function matches(matcher: Matcher, call: FakeCall): boolean {
  if (typeof matcher === "string") return matcher === call.key;
  return matcher.test(`${call.method} ${call.url}`);
}

export class FakeGitHub {
  readonly calls: FakeCall[] = [];
  /** Requests no route claimed — assert this is empty when a test expects full coverage. */
  readonly unexpected: string[] = [];

  private readonly routes = new Map<string, FakeReply | FakeResponder>();
  private readonly patterns: Array<{ matcher: RegExp; reply: FakeReply | FakeResponder }> = [];
  private readonly queue: Array<{ matcher: Matcher; reply: FakeReply | FakeResponder }> = [];

  /** A persistent route. Registering the same string key again replaces it. */
  on(matcher: Matcher, reply: FakeReply | FakeResponder): this {
    if (typeof matcher === "string") this.routes.set(matcher, reply);
    else this.patterns.push({ matcher, reply });
    return this;
  }

  /** A one-shot route, consumed in registration order before any persistent one. */
  once(matcher: Matcher, reply: FakeReply | FakeResponder): this {
    this.queue.push({ matcher, reply });
    return this;
  }

  /** The call keys in order — the commit sequence assertions read this. */
  keys(): string[] {
    return this.calls.map((call) => call.key);
  }

  /** Calls for one key, for asserting a body. */
  callsFor(key: string): FakeCall[] {
    return this.calls.filter((call) => call.key === key);
  }

  reset(): void {
    this.calls.length = 0;
    this.unexpected.length = 0;
  }

  readonly fetch: FetchLike = async (input, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const url = input.startsWith(ORIGIN) ? input.slice(ORIGIN.length) : input;
    const path = url.split("?")[0] ?? url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => {
      headers[name.toLowerCase()] = value;
    });
    const rawBody = init?.body;
    const call: FakeCall = {
      method,
      url,
      path,
      key: `${method} ${path}`,
      body: typeof rawBody === "string" ? JSON.parse(rawBody) : undefined,
      headers,
    };
    this.calls.push(call);

    const queued = this.queue.findIndex((entry) => matches(entry.matcher, call));
    const reply =
      queued >= 0
        ? this.queue.splice(queued, 1)[0]!.reply
        : (this.routes.get(call.key) ??
          this.patterns.find((entry) => matches(entry.matcher, call))?.reply);

    if (!reply) {
      this.unexpected.push(call.key);
      throw new Error(`FakeGitHub: no route for ${call.key}`);
    }

    const spec = typeof reply === "function" ? await reply(call) : reply;
    return toResponse(spec);
  };
}

function toResponse(spec: FakeReply): Response {
  const status = spec.status ?? 200;
  const headers: Record<string, string> = { ...(spec.headers ?? {}) };
  if (status === 204 || status === 304) return new Response(null, { status, headers });
  if (spec.text !== undefined) {
    headers["content-type"] ??= "text/plain; charset=utf-8";
    return new Response(spec.text, { status, headers });
  }
  headers["content-type"] ??= "application/json";
  return new Response(JSON.stringify(spec.body ?? null), { status, headers });
}

/** Base64 for a `contents` reply, the encoding GitHub uses. */
export function base64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}
