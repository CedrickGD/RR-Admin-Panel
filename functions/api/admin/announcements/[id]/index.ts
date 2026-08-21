import { requireDashboardAccess } from "../../../../_lib/admin";
import {
  ensureAnnouncementsSchema,
  toIsoOrNull,
  type AnnouncementLevel,
  type AnnouncementRow,
} from "../../../../_lib/content";
import { decodeKeyParam, error, json, nowIso, readJsonBody } from "../../../../_lib/http";
import type { RuntimeEnv } from "../../../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
  params: {
    id: string;
  };
};

const LEVELS: AnnouncementLevel[] = ["info", "warning", "critical"];
const MAX_TITLE_LENGTH = 200;
const MAX_BODY_LENGTH = 4000;

function parseId(raw: string | undefined | null): number | null {
  const id = Number.parseInt(decodeKeyParam(raw), 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function onRequestPut(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");

    await ensureAnnouncementsSchema(context.env);

    const id = parseId(context.params.id);
    if (id === null) return error(400, "A valid announcement id is required.");

    const existing = await db
      .prepare(`SELECT * FROM announcements WHERE id = ?`)
      .bind(id)
      .first<AnnouncementRow>();
    if (!existing) return error(404, "Announcement not found.");

    const body = await readJsonBody<{
      title?: string;
      body?: string;
      level?: string;
      is_active?: boolean | number;
      starts_at?: string | null;
      expires_at?: string | null;
    }>(context.request);

    // Partial update: only overwrite fields the caller actually sent (a bare active toggle
    // shouldn't require re-sending title/body).
    const title = body.title !== undefined ? body.title.trim() : existing.title;
    const text = body.body !== undefined ? body.body.trim() : existing.body;
    if (!title) return error(400, "Title is required.");
    if (!text) return error(400, "Body is required.");
    if (title.length > MAX_TITLE_LENGTH)
      return error(400, `Title must be <= ${MAX_TITLE_LENGTH} characters.`);
    if (text.length > MAX_BODY_LENGTH)
      return error(400, `Body must be <= ${MAX_BODY_LENGTH} characters.`);

    const level =
      body.level !== undefined && LEVELS.includes(body.level as AnnouncementLevel)
        ? (body.level as AnnouncementLevel)
        : existing.level;
    const isActive =
      body.is_active !== undefined
        ? body.is_active === false || body.is_active === 0
          ? 0
          : 1
        : existing.is_active;
    const startsAt =
      body.starts_at !== undefined ? toIsoOrNull(body.starts_at) : existing.starts_at;
    const expiresAt =
      body.expires_at !== undefined ? toIsoOrNull(body.expires_at) : existing.expires_at;

    await db
      .prepare(
        `UPDATE announcements
         SET title = ?, body = ?, level = ?, is_active = ?, starts_at = ?, expires_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(title, text, level, isActive, startsAt, expiresAt, nowIso(), id)
      .run();

    return json({ ok: true });
  } catch (err) {
    return error(500, "Failed to update announcement.", err instanceof Error ? err.message : null);
  }
}

export async function onRequestDelete(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");

    await ensureAnnouncementsSchema(context.env);

    const id = parseId(context.params.id);
    if (id === null) return error(400, "A valid announcement id is required.");

    const result = await db.prepare(`DELETE FROM announcements WHERE id = ?`).bind(id).run();
    if (!result.meta?.changes) {
      return error(404, "Announcement not found — nothing was deleted.");
    }

    return json({ ok: true, message: "Announcement deleted." });
  } catch (err) {
    return error(500, "Failed to delete announcement.", err instanceof Error ? err.message : null);
  }
}
