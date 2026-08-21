// HTTP front door: Hono on @hono/node-server hands us WHATWG Request/Response objects, so the
// unchanged worker (`backend-worker/index.js`) and the Pages Functions (generated route table)
// are called exactly the way Cloudflare calls them — no body re-parsing, no header rewriting.
import { Hono } from "hono";

import type { WorkerModule } from "../../../../backend-worker/index.js";
import { attachCloudflareContext } from "./cf-request";
import { installWorkersGlobals } from "./cf-polyfills";
import type { RrApiEnv } from "./env";
import { routes as generatedRoutes } from "./routes.generated";
import { matchRoute, type GeneratedRoute, type PagesFunctionContext } from "./router";

export const SERVICE_NAME = "rr-api";

/** Exact paths the standalone worker owns (same handler code as backend.*.workers.dev). */
export const WORKER_EXACT_PATHS: ReadonlySet<string> = new Set([
  "/api/ingest",
  "/v1/telemetry/event",
  "/api/install/register",
  "/api/health",
  "/healthz",
]);

/** Path prefixes the worker owns (media CDN proxy, updater proxy). */
export const WORKER_PREFIXES: readonly string[] = ["/media/", "/update/"];

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export interface CreateAppOptions {
  env: RrApiEnv;
  worker: WorkerModule;
  routes?: readonly GeneratedRoute[];
  /** Receives background-task failures (worker `ctx.waitUntil`); defaults to console.error. */
  onBackgroundError?: (error: unknown) => void;
}

export function isWorkerPath(pathname: string): boolean {
  if (WORKER_EXACT_PATHS.has(pathname)) return true;
  return WORKER_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function notFound(): Response {
  return Response.json({ ok: false, error: "Route not found." }, { status: 404 });
}

function createExecutionContext(
  onBackgroundError: (error: unknown) => void,
  pending: Set<Promise<unknown>>,
): ExecutionContextLike {
  return {
    waitUntil(promise: Promise<unknown>): void {
      const tracked = Promise.resolve(promise)
        .catch(onBackgroundError)
        .finally(() => {
          pending.delete(tracked);
        });
      pending.add(tracked);
    },
    passThroughOnException(): void {
      // Nothing to pass through to on the origin itself.
    },
  };
}

export interface RrApiApp {
  app: Hono;
  /** `fetch`-style entry used by tests and by @hono/node-server. */
  fetch(request: Request): Promise<Response>;
  /** Awaits every outstanding waitUntil() promise (graceful shutdown / tests). */
  drain(): Promise<void>;
  routeCount: number;
}

export function createApp(options: CreateAppOptions): RrApiApp {
  installWorkersGlobals();

  const { env, worker } = options;
  const routes = options.routes ?? generatedRoutes;
  const onBackgroundError =
    options.onBackgroundError ??
    ((error: unknown) => {
      console.error("background_task_failed", error);
    });
  const pending = new Set<Promise<unknown>>();
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, service: SERVICE_NAME }));

  app.all("*", async (c) => {
    const request = attachCloudflareContext(c.req.raw);
    const url = new URL(request.url);
    const ctx = createExecutionContext(onBackgroundError, pending);

    if (isWorkerPath(url.pathname)) {
      return worker.fetch(request, env, ctx);
    }

    const match = matchRoute(routes, request.method, url.pathname);
    if (!match) {
      return notFound();
    }

    const context: Required<PagesFunctionContext> = {
      request,
      env,
      params: match.params,
      data: {},
      functionPath: url.pathname,
      waitUntil: ctx.waitUntil,
      passThroughOnException: ctx.passThroughOnException,
      next: async () => notFound(),
    };
    return match.route.handler(context);
  });

  app.notFound(() => notFound());
  app.onError((error) => {
    console.error("unhandled_request_error", error);
    return Response.json({ ok: false, error: "Internal server error." }, { status: 500 });
  });

  return {
    app,
    fetch: async (request: Request) => app.fetch(request),
    async drain() {
      while (pending.size > 0) {
        await Promise.allSettled([...pending]);
      }
    },
    routeCount: routes.length,
  };
}
