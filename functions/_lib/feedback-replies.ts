import { requireDashboardAccess } from "./admin";
import { ensureFeedbackSchema } from "./content";
import { accountForInstall, ensureCustomerAccounts } from "./customer-accounts";
import { ensureFeedbackDiagnosticsSchema } from "./feedback-diagnostics";
import { error, json, nowIso } from "./http";
import { parseJsonObject, requireInstallAuth } from "./install-auth";
import { enforceRateLimit } from "./ratelimit";
import { internalError } from "./responses";
import { readBodyTextLimited } from "../../shared/telemetry-contract";
import type { D1Database, RuntimeEnv } from "./types";

export const FEEDBACK_REPLIES_DDL = [
  `CREATE TABLE IF NOT EXISTS feedback_recipients (
    feedback_id INTEGER PRIMARY KEY REFERENCES feedback(id) ON DELETE CASCADE,
    install_id TEXT NOT NULL, account_id TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_feedback_recipient_install ON feedback_recipients(install_id)`,
  `CREATE INDEX IF NOT EXISTS idx_feedback_recipient_account ON feedback_recipients(account_id)`,
  `CREATE TABLE IF NOT EXISTS feedback_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feedback_id INTEGER NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
    message TEXT NOT NULL, author_email TEXT NOT NULL, request_id TEXT NOT NULL,
    created_at TEXT NOT NULL, read_at TEXT,
    UNIQUE(feedback_id, request_id))`,
  `CREATE INDEX IF NOT EXISTS idx_feedback_reply_thread ON feedback_replies(feedback_id, id)`,
];
const ready = new WeakMap<D1Database, Promise<void>>();
export function ensureFeedbackReplies(env: RuntimeEnv): Promise<void> {
  const db = env.DB!;
  let task = ready.get(db);
  if (!task) {
    task = (async () => {
      await ensureFeedbackSchema(env);
      await ensureFeedbackDiagnosticsSchema(db);
      await ensureCustomerAccounts(db);
      await db.batch(FEEDBACK_REPLIES_DDL.map((sql) => db.prepare(sql)));
      // Historic reports are deliverable only to the cryptographically verified installation.
      // Never infer their recipient from client-supplied HWID, contact or install_id fields.
      await db
        .prepare(
          `INSERT OR IGNORE INTO feedback_recipients(feedback_id, install_id)
        SELECT m.feedback_id, m.verified_install_id FROM feedback_report_meta m
        JOIN feedback f ON f.id=m.feedback_id
        WHERE m.auth_mode='signed' AND m.verified_install_id IS NOT NULL`,
        )
        .run();
    })();
    ready.set(db, task);
    task.catch(() => ready.delete(db));
  }
  return task;
}

export async function saveFeedbackRecipient(db: D1Database, feedbackId: number, installId: string) {
  const account = await accountForInstall(db, installId);
  await db
    .prepare(`INSERT INTO feedback_recipients(feedback_id, install_id, account_id) VALUES(?,?,?)`)
    .bind(feedbackId, installId, account?.id ?? null)
    .run();
}

type Context = { request: Request; env: RuntimeEnv };
const PAGE_SIZE = 50;
const recipientWhere = `((t.account_id IS NOT NULL AND t.account_id=?) OR
  (t.account_id IS NULL AND t.install_id=?))`;
function noStore(response: Response) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}
function validId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export async function customerFeedbackInbox(context: Context): Promise<Response> {
  const limited = enforceRateLimit(context.request, {
    route: "feedback-inbox",
    limit: 120,
    windowSeconds: 60,
  });
  if (limited) return limited;
  const auth = await requireInstallAuth(context, "required");
  if (!auth.ok) return auth.response;
  const body = parseJsonObject(auth.bodyText);
  if (!body || !["list", "read"].includes(String(body.action)))
    return error(400, "Invalid inbox action.");
  try {
    const db = context.env.DB;
    if (!db) return error(500, "Database not available");
    await ensureFeedbackReplies(context.env);
    const account = await accountForInstall(db, auth.installId!);
    const scope = [account?.id ?? null, auth.installId];
    if (body.action === "read") {
      if (!validId(body.id)) return error(400, "A valid reply id is required.");
      const owned = await db
        .prepare(
          `SELECT r.id FROM feedback_replies r
        JOIN feedback_recipients t ON t.feedback_id=r.feedback_id
        WHERE r.id=? AND ${recipientWhere}`,
        )
        .bind(body.id, ...scope)
        .first();
      if (!owned) return error(404, "Reply not found.");
      await db
        .prepare(
          `UPDATE feedback_replies SET read_at=COALESCE(read_at,?) WHERE id=?
        AND feedback_id IN (SELECT t.feedback_id FROM feedback_recipients t WHERE ${recipientWhere})`,
        )
        .bind(nowIso(), body.id, ...scope)
        .run();
      return noStore(json({ ok: true }));
    }
    if (body.before !== undefined && !validId(body.before))
      return error(400, "Invalid inbox cursor.");
    const unread = await db
      .prepare(
        `SELECT COUNT(*) AS count FROM feedback_replies r
      JOIN feedback_recipients t ON t.feedback_id=r.feedback_id WHERE r.read_at IS NULL AND ${recipientWhere}`,
      )
      .bind(...scope)
      .first<{ count: number }>();
    const { results } = await db
      .prepare(
        `SELECT r.id, r.feedback_id, r.message, r.created_at, r.read_at,
      f.message AS original_message, COALESCE(m.report_id, 'FB-' || printf('%06d',f.id)) AS report_id
      FROM feedback_replies r JOIN feedback_recipients t ON t.feedback_id=r.feedback_id
      JOIN feedback f ON f.id=r.feedback_id LEFT JOIN feedback_report_meta m ON m.feedback_id=f.id
      WHERE ${recipientWhere} AND r.id<? ORDER BY r.id DESC LIMIT ?`,
      )
      .bind(...scope, body.before ?? Number.MAX_SAFE_INTEGER, PAGE_SIZE + 1)
      .all<{ id: number }>();
    const replies = results.slice(0, PAGE_SIZE);
    return noStore(
      json({
        ok: true,
        scope: account ? `account:${account.id}` : `install:${auth.installId}`,
        replies,
        unread: unread?.count ?? 0,
        next_before: results.length > PAGE_SIZE ? replies.at(-1)!.id : null,
      }),
    );
  } catch (err) {
    return internalError(context.request, "Unable to load your inbox.", err);
  }
}

export async function adminFeedbackReplies(
  context: Context & { params: { id: string } },
): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;
    const db = context.env.DB;
    if (!db) return error(500, "Database not available");
    const id = Number(context.params.id);
    if (!validId(id)) return error(400, "A valid feedback id is required.");
    await ensureFeedbackReplies(context.env);
    const report = await db
      .prepare(
        `SELECT f.id, t.install_id FROM feedback f
      LEFT JOIN feedback_recipients t ON t.feedback_id=f.id WHERE f.id=?`,
      )
      .bind(id)
      .first<{ id: number; install_id: string | null }>();
    if (!report) return error(404, "Feedback not found.");
    if (context.request.method === "GET") {
      const before = Number(
        new URL(context.request.url).searchParams.get("before") ?? Number.MAX_SAFE_INTEGER,
      );
      if (!validId(before)) return error(400, "Invalid reply cursor.");
      const { results } = await db
        .prepare(
          `SELECT id, message, created_at, read_at FROM feedback_replies
        WHERE feedback_id=? AND id<? ORDER BY id DESC LIMIT ?`,
        )
        .bind(id, before, PAGE_SIZE + 1)
        .all<{ id: number }>();
      const replies = results.slice(0, PAGE_SIZE);
      return noStore(
        json({
          ok: true,
          can_reply: !!report.install_id,
          replies,
          next_before: results.length > PAGE_SIZE ? replies.at(-1)!.id : null,
        }),
      );
    }
    if (!report.install_id)
      return error(
        409,
        "This old report has no verified recipient. An in-app reply cannot be delivered safely.",
      );
    const limited = enforceRateLimit(context.request, {
      route: "feedback-reply",
      limit: 30,
      windowSeconds: 60,
    });
    if (limited) return limited;
    const raw = await readBodyTextLimited(context.request, 20 * 1024);
    if (!raw.ok) return error(raw.status, raw.message);
    const body = parseJsonObject(raw.text);
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!message || message.length > 4000)
      return error(400, "Enter a reply between 1 and 4000 characters.");
    if (typeof body?.request_id !== "string" || !/^[a-zA-Z0-9-]{16,64}$/.test(body.request_id))
      return error(400, "A reply request id is required.");
    await db
      .prepare(
        `INSERT OR IGNORE INTO feedback_replies(feedback_id,message,author_email,request_id,created_at)
      VALUES(?,?,?,?,?)`,
      )
      .bind(id, message, access.access.user.email, body.request_id, nowIso())
      .run();
    const reply = await db
      .prepare(
        `SELECT id,message,created_at,read_at,author_email FROM feedback_replies
      WHERE feedback_id=? AND request_id=?`,
      )
      .bind(id, body.request_id)
      .first<{
        id: number;
        message: string;
        created_at: string;
        read_at: string | null;
        author_email: string;
      }>();
    if (!reply || reply.message !== message || reply.author_email !== access.access.user.email)
      return error(
        409,
        "This reply request was already used. Reopen the conversation to send a new reply.",
      );
    const { author_email: _author, ...publicReply } = reply;
    return noStore(json({ ok: true, reply: publicReply }, 201));
  } catch (err) {
    return internalError(context.request, "Unable to complete the reply request.", err);
  }
}
