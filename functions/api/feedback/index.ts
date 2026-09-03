import { ensureFeedbackSchema } from "../../_lib/content";
import { error, json, nowIso } from "../../_lib/http";
import { internalError } from "../../_lib/responses";
import { parseJsonObject, requireInstallAuth } from "../../_lib/install-auth";
import { enforceRateLimit } from "../../_lib/ratelimit";
import {
  ensureFeedbackDiagnosticsSchema,
  fallbackFeedbackReportId,
  storeFeedbackDiagnostics,
  storeFeedbackReportMeta,
  validateFeedbackDiagnostics,
} from "../../_lib/feedback-diagnostics";
import type { D1RunResult, RuntimeEnv } from "../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

const MAX_MESSAGE_LENGTH = 4000;
const MAX_FIELD_LENGTH = 256;
// The diagnostic object is capped independently at 12 KiB. Leave transport room for a valid
// 4,000-character (potentially multibyte) message plus the established context fields.
const MAX_FEEDBACK_BODY_BYTES = 48 * 1024;

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

  const auth = await requireInstallAuth(context, "optional", {
    maxBodyBytes: MAX_FEEDBACK_BODY_BYTES,
  });
  if (!auth.ok) return auth.response;

  const db = context.env.DB;
  if (!db) return error(500, "Database not available");

  const body = parseJsonObject(auth.bodyText);
  if (!body) return error(400, "Request body must be a JSON object.");

  const diagnosticsResult = validateFeedbackDiagnostics(body.diagnostics);
  if (!diagnosticsResult.ok) return error(400, diagnosticsResult.message);
  // Rich diagnostics are a modern-client feature. Requiring the already-deployed install
  // signature here prevents an unsigned legacy caller from attaching a forged device report,
  // while the original message-only legacy behaviour remains untouched.
  if (diagnosticsResult.value && !auth.installId) {
    return error(401, "Install signature required for diagnostics.");
  }

  try {
    await ensureFeedbackSchema(context.env);

    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) return error(400, "Feedback message is required.");
    if (message.length > MAX_MESSAGE_LENGTH) {
      return error(400, `Feedback must be <= ${MAX_MESSAGE_LENGTH} characters.`);
    }

    const createdAt = nowIso();
    const insert = await db
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
        createdAt,
      )
      .run<D1RunResult>();

    const feedbackId = Number(insert.meta?.last_row_id);
    if (!Number.isInteger(feedbackId) || feedbackId <= 0) {
      throw new Error("Feedback insert did not return its row id.");
    }
    const reportId = fallbackFeedbackReportId(feedbackId);
    const authMode = auth.installId ? "signed" : "legacy_unsigned";

    if (diagnosticsResult.value) {
      try {
        await ensureFeedbackDiagnosticsSchema(db);
        await storeFeedbackDiagnostics(
          db,
          feedbackId,
          reportId,
          authMode,
          auth.installId,
          diagnosticsResult.value,
          createdAt,
        );
      } catch (diagnosticsError) {
        // Do not leave a message that claims diagnostics were accepted when the isolated
        // provider batch failed. This only removes the row created by this request.
        try {
          await db.prepare(`DELETE FROM feedback WHERE id = ?`).bind(feedbackId).run();
        } catch {
          // Preserve the original storage failure for the internal error handler.
        }
        throw diagnosticsError;
      }
    } else {
      // Metadata enriches modern reads, but the long-standing message-only endpoint must remain
      // available even during a migration rollout or a temporary failure in the additive tables.
      try {
        await ensureFeedbackDiagnosticsSchema(db);
        await storeFeedbackReportMeta(
          db,
          feedbackId,
          reportId,
          authMode,
          auth.installId,
          createdAt,
        );
      } catch {
        // The deterministic fallback report id remains stable for this feedback row.
      }
    }

    return json({ ok: true, message: "Feedback received. Thank you!", report_id: reportId }, 201);
  } catch (err) {
    return internalError(context.request, "Unable to complete the request.", err);
  }
}
