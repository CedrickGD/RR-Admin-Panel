// Type surface of the standalone worker module for the vitest suite (tests/worker/*).
// The runtime is plain ESM JS in index.js; wrangler ignores this file.

export interface WorkerExecutionContext {
  waitUntil: (promise: Promise<unknown>) => void;
}

export interface WorkerModule {
  fetch(request: Request, env: unknown, ctx: WorkerExecutionContext): Promise<Response>;
  scheduled(event: unknown, env: unknown, ctx: WorkerExecutionContext): Promise<void>;
}

/** Forgets the per-isolate schema flag so each test starts from a cold isolate. */
export function resetWorkerStateForTests(): void;

declare const worker: WorkerModule;
export default worker;
