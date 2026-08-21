import { ensureFeedbackSchema } from "../../_lib/content";
import { error, json, nowIso } from "../../_lib/http";
import { parseJsonObject, requireInstallAuth } from "../../_lib/install-auth";
import { enforceRateLimit } from "../../_lib/ratelimit";
import type { RuntimeEnv } from "../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

const MAX_MESSAGE_LENGTH = 4000;
const MAX_FIELD_LENGTH = 256;

function trimField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_FIELD_LENGTH);
}

/**
 * Public endpoint the desktop app POSTs user feedback to — same access model as /api/license/*:
 * an install signature is verified when present and unsigned calls stay allowed for legacy
 * clients until REQUIRE_INSTALL_SIGNATURE=true. Identity fields are best-effort context supplied
 * by the client so the admin can follow up; only `message` is required. The per-IP rate limit
 * and the middleware byte cap are the basic abuse guards.
 */
export async function onRequestPost(context: HandlerContext): Promise<Response> {
  const limited = enforceRateLimit(context.request, {
    route: "feedback",
    limit: 5,
    windowSeconds: 60,
  });
  if (limited) return limited;

  const auth = await requireInstallAuth(context, "optional");
  if (!auth.ok) return auth.response;

  const db = context.env.DB;
  if (!db) return error(500, "Database not available");

  const body = parseJsonObject(auth.bodyText);
  if (!body) return error(400, "Request body must be a JSON object.");

  try {
    await ensureFeedbackSchema(context.env);

    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) return error(400, "Feedback message is required.");
    if (message.length > MAX_MESSAGE_LENGTH) {
      return error(400, `Feedback must be <= ${MAX_MESSAGE_LENGTH} characters.`);
    }

    await db
      .prepare(
        `INSERT INTO feedback
          (message, contact, hwid, install_id, license_key, machine_name, app_version, platform, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`,
      )
      .bind(
        message.slice(0, MAX_MESSAGE_LENGTH),
        trimField(body.contact),
        trimField(body.hwid),
        trimField(body.install_id),
        trimField(body.license_key),
        trimField(body.machine_name),
        trimField(body.app_version),
        trimField(body.platform),
        nowIso(),
      )
      .run();

    return json({ ok: true, message: "Feedback received. Thank you!" }, 201);
  } catch (err) {
    return error(500, "Failed to submit feedback.", err instanceof Error ? err.message : null);
  }
}
