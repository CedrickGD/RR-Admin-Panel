import { requireDashboardAccess } from "../../_lib/admin";
import { error } from "../../_lib/http";
import { loadSessionExportText } from "../../_lib/storage";
import type { RuntimeEnv } from "../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

export async function onRequest(context: HandlerContext): Promise<Response> {
  if (context.request.method !== "GET") {
    return error(405, "Method not allowed. Use GET.");
  }

  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) {
      return access.response;
    }

    const text = await loadSessionExportText(context.env);
    const filename = `rr-sessions-${new Date().toISOString().replaceAll(":", "-")}.txt`;

    return new Response(text, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (exportError) {
    return error(
      500,
      "Failed to export session log.",
      exportError instanceof Error ? exportError.message : null,
    );
  }
}
