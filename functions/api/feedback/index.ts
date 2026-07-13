import { ensureFeedbackSchema } from "../../_lib/content";
import { error, json, nowIso, readJsonBody } from "../../_lib/http";
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
 * Public, unauthenticated endpoint the desktop app POSTs user feedback to — same access model as
 * /api/license/*. Identity fields are best-effort context supplied by the client so the admin can
 * follow up; only `message` is required. readJsonBody's byte cap is the basic abuse guard.
 */
export async function onRequestPost(context: HandlerContext): Promise<Response> {
  const db = context.env.DB;
  if (!db) return error(500, "Database not available");

  try {
    await ensureFeedbackSchema(context.env);

    const body = await readJsonBody<{
      message?: string;
      contact?: string;
      hwid?: string;
      install_id?: string;
      license_key?: string;
      machine_name?: string;
      app_version?: string;
      platform?: string;
    }>(context.request);

    const message = body.message?.trim() ?? "";
    if (!message) return error(400, "Feedback message is required.");
    if (message.length > MAX_MESSAGE_LENGTH) {
      return error(400, `Feedback must be <= ${MAX_MESSAGE_LENGTH} characters.`);
    }

    await db
      .prepare(
        `INSERT INTO feedback
          (message, contact, hwid, install_id, license_key, machine_name, app_version, platform, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`
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
        nowIso()
      )
      .run();

    return json({ ok: true, message: "Feedback received. Thank you!" }, 201);
  } catch (err) {
    return error(500, "Failed to submit feedback.", err instanceof Error ? err.message : null);
  }
}
