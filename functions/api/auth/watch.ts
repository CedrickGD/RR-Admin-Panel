import { requireDashboardAccess } from "../../_lib/admin";
import type { RuntimeEnv } from "../../_lib/types";
export async function onRequest({ request, env }: { request: Request; env: RuntimeEnv }) {
  const initial = await requireDashboardAccess(request, env);
  if (!initial.ok) return initial.response;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const encoder = new TextEncoder();
  let previous = JSON.stringify(initial.access.user);
  const started = Date.now();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const stop = () => {
        if (stopped) return;
        stopped = true;
        clearTimeout(timer);
        controller.close();
      };
      request.signal.addEventListener("abort", stop, { once: true });
      controller.enqueue(
        encoder.encode(
          `retry: 2000\n\nevent: access\ndata: ${JSON.stringify({ authenticated: true, user: initial.access.user })}\n\n`,
        ),
      );
      const check = async () => {
        if (stopped) return;
        try {
          const auth = await requireDashboardAccess(request, env);
          if (stopped) return;
          if (!auth.ok) {
            if (auth.response.status < 500)
              controller.enqueue(
                encoder.encode('event: access\ndata: {"authenticated":false}\n\n'),
              );
            stop();
            return;
          }
          const next = JSON.stringify(auth.access.user);
          if (next !== previous) {
            controller.enqueue(
              encoder.encode(
                `event: access\ndata: ${JSON.stringify({ authenticated: true, user: auth.access.user })}\n\n`,
              ),
            );
            previous = next;
          } else controller.enqueue(encoder.encode(": keepalive\n\n"));
          if (Date.now() - started > 55000) {
            stop();
            return;
          }
          timer = setTimeout(check, 2000);
        } catch {
          if (!stopped) stop();
        }
      };
      timer = setTimeout(check, 2000);
    },
    cancel() {
      stopped = true;
      clearTimeout(timer);
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}
