import { ensureAccessSchema, isSuspensionActive, type SuspensionRow } from "../../_lib/access";
import { toIsoOrNull } from "../../_lib/content";
import {
  loadAccess,
  loadErrors,
  loadFeedback,
  loadInstalls,
  loadLicenses,
  loadSessions,
  mapSession,
  resolveAnchor,
  uniqueText,
  type AnchorSeed,
} from "../../_lib/customer-anchor";
import { isDiscordSnowflake, requireBotSecret } from "../../_lib/discord";
import { buildSupportContext, type SupportContextSources } from "../../_lib/discord-support";
import { ensureFeedbackDiagnosticsSchema } from "../../_lib/feedback-diagnostics";
import { error, json, jsonBodyErrorMessage, readJsonBody } from "../../_lib/http";
import { internalError } from "../../_lib/responses";
import { ensureTelemetrySchema } from "../../_lib/storage";
import type { DiagnosticProvider } from "../../_lib/feedback-diagnostics";
import type { RuntimeEnv } from "../../_lib/types";

type HandlerContext = { request: Request; env: RuntimeEnv };

const REPORT_ID_PATTERN = /^[A-Za-z0-9-]{1,32}$/;
const FALLBACK_REPORT_ID = /^FB-0*(\d{1,12})$/i;

/**
 * What the AI support assistant is told about the member it is answering — the same rows
 * Customer 360 shows, run through the allow-list in `_lib/discord-support.ts`.
 *
 * Anchor: the member's active Discord link (→ license → machine). When a `report_id` is supplied
 * the support report itself anchors instead, and then the license is withheld unless the linked
 * account turns out to be the same machine — a Report ID typed into a ticket is not proof of
 * ownership.
 *
 * Auth is identical to `/api/discord/links`: VERIFY_SHARED_SECRET as a Bearer token.
 */
export async function onRequestPost(context: HandlerContext): Promise<Response> {
  try {
    const denied = requireBotSecret(context.request, context.env);
    if (denied) return denied;

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");

    let body: { discord_id?: unknown; report_id?: unknown; since?: unknown };
    try {
      body = await readJsonBody(context.request);
    } catch (cause) {
      return error(400, jsonBodyErrorMessage(cause));
    }

    const discordId = typeof body.discord_id === "string" ? body.discord_id.trim() : "";
    const reportId = typeof body.report_id === "string" ? body.report_id.trim() : "";
    if (discordId && !isDiscordSnowflake(discordId)) {
      return error(400, "discord_id must be a Discord user id (17-20 digits).");
    }
    if (reportId && !REPORT_ID_PATTERN.test(reportId)) {
      return error(400, "report_id has an unexpected format.");
    }
    if (!discordId && !reportId) return error(400, "discord_id or report_id is required.");
    const since = toIsoOrNull(body.since);

    await ensureTelemetrySchema(db);
    await ensureAccessSchema(context.env);

    const linked = discordId
      ? Boolean(
          await db
            .prepare(`SELECT discord_id FROM discord_links WHERE discord_id = ? AND is_active = 1`)
            .bind(discordId)
            .first(),
        )
      : false;

    const linkAnchor = linked ? await resolveAnchor(context.env, "discord_id", discordId) : null;
    const reportAnchor = reportId ? await anchorByReportId(context.env, reportId) : null;
    const anchor = reportAnchor ?? linkAnchor;
    if (!anchor) return json({ ok: true, linked, found: false, context: null });

    // A report anchored by its id only carries the license when it belongs to the linked account.
    const licenseAllowed =
      anchor === linkAnchor ||
      Boolean(
        linkAnchor &&
        ((linkAnchor.hwid && linkAnchor.hwid === anchor.hwid) ||
          (linkAnchor.installId && linkAnchor.installId === anchor.installId)),
      );

    const sessions = await loadSessions(db, anchor);
    const installs = await loadInstalls(db, anchor);
    const licenses = licenseAllowed ? await loadLicenses(db, anchor, installs) : [];
    const installIds = uniqueText([
      anchor.installId,
      ...installs.map((install) => install.install_id),
      ...sessions.map((session) => session.installId),
    ]);
    const suspensions = await loadAccess(context.env, anchor, installIds);
    const errors = await loadErrors(db, anchor);
    const feedback = await loadFeedback(
      context.env,
      anchor,
      installIds,
      licenses.map((license) => license.license_key),
      {},
    );

    const sources: SupportContextSources = {
      session: sessions[0] ?? (anchor.session ? mapSession(anchor.session) : null),
      installs: installs.length,
      license: licenses[0] ?? null,
      suspended: suspensions.some((row) => isSuspensionActive(row as unknown as SuspensionRow)),
      errors,
      report: pickSupportReport(feedback, since),
    };

    return json({ ok: true, linked, found: true, context: buildSupportContext(sources) });
  } catch (err) {
    return internalError(context.request, "Unable to complete the request.", err);
  }
}

/**
 * The newest "report a problem" submission for this anchor, preferring one the member sent after
 * they were asked for it — that is what `since` is: the moment the bot posted the request.
 */
function pickSupportReport(
  feedback: Array<Record<string, unknown>>,
  since: string | null,
): SupportContextSources["report"] {
  const reports = feedback.filter((row) => row.kind === "support");
  const fresh = since
    ? reports.filter((row) => typeof row.created_at === "string" && row.created_at >= since)
    : [];
  const row = fresh[0] ?? reports[0];
  if (!row) return null;
  const diagnostics = row.diagnostics as { providers?: DiagnosticProvider[] } | null;
  return {
    report_id: String(row.report_id ?? ""),
    created_at: typeof row.created_at === "string" ? row.created_at : null,
    message: typeof row.message === "string" ? row.message : null,
    providers: diagnostics?.providers ?? [],
  };
}

/**
 * Report ID → feedback row. `feedback_report_meta` holds the id the app showed the customer; a
 * report from before that table has the derived `FB-000123` form, whose digits are the row id.
 */
async function anchorByReportId(env: RuntimeEnv, reportId: string): Promise<AnchorSeed | null> {
  const db = env.DB!;
  let feedbackId: number | null = null;
  try {
    await ensureFeedbackDiagnosticsSchema(db);
    const meta = await db
      .prepare(`SELECT feedback_id FROM feedback_report_meta WHERE report_id = ? LIMIT 1`)
      .bind(reportId)
      .first<{ feedback_id: number }>();
    feedbackId = meta ? Number(meta.feedback_id) : null;
  } catch {
    // No metadata table on this database — the derived form below is the only remaining route.
  }
  if (feedbackId === null) {
    const derived = FALLBACK_REPORT_ID.exec(reportId);
    if (!derived) return null;
    feedbackId = Number(derived[1]);
  }
  if (!Number.isInteger(feedbackId) || feedbackId <= 0) return null;
  return resolveAnchor(env, "feedback_id", String(feedbackId));
}
