import { requireDashboardAccess } from "../../../_lib/admin";
import {
  ensureAnnouncementsSchema,
  toIsoOrNull,
  type AnnouncementLevel,
  type AnnouncementRow
} from "../../../_lib/content";
import { error, json, nowIso, readJsonBody } from "../../../_lib/http";
import type { RuntimeEnv } from "../../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

const LEVELS: AnnouncementLevel[] = ["info", "warning", "critical"];
const MAX_TITLE_LENGTH = 200;
const MAX_BODY_LENGTH = 4000;

function normalizeLevel(value: unknown): AnnouncementLevel {
  return typeof value === "string" && LEVELS.includes(value as AnnouncementLevel)
    ? (value as AnnouncementLevel)
    : "info";
}

export async function onRequestGet(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");

    await ensureAnnouncementsSchema(context.env);

    const { results } = await db
      .prepare(`SELECT * FROM announcements ORDER BY id DESC`)
      .all<AnnouncementRow>();

    return json({ ok: true, announcements: results });
  } catch (err) {
    return error(500, "Failed to load announcements.", err instanceof Error ? err.message : null);
  }
}

export async function onRequestPost(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");

    await ensureAnnouncementsSchema(context.env);

    const body = await readJsonBody<{
      title?: string;
      body?: string;
      level?: string;
      is_active?: boolean | number;
      starts_at?: string | null;
      expires_at?: string | null;
    }>(context.request);

    const title = body.title?.trim() ?? "";
    const text = body.body?.trim() ?? "";
    if (!title) return error(400, "Title is required.");
    if (!text) return error(400, "Body is required.");
    if (title.length > MAX_TITLE_LENGTH) return error(400, `Title must be <= ${MAX_TITLE_LENGTH} characters.`);
    if (text.length > MAX_BODY_LENGTH) return error(400, `Body must be <= ${MAX_BODY_LENGTH} characters.`);

    const level = normalizeLevel(body.level);
    const isActive = body.is_active === false || body.is_active === 0 ? 0 : 1;
    const startsAt = toIsoOrNull(body.starts_at);
    const expiresAt = toIsoOrNull(body.expires_at);
    const now = nowIso();

    const result = await db
      .prepare(
        `INSERT INTO announcements (title, body, level, is_active, starts_at, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(title, text, level, isActive, startsAt, expiresAt, now, now)
      .run();

    return json({ ok: true, id: result.meta?.last_row_id ?? null });
  } catch (err) {
    return error(500, "Failed to create announcement.", err instanceof Error ? err.message : null);
  }
}
