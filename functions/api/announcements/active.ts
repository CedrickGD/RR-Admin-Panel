import { ensureAnnouncementsSchema, type AnnouncementRow } from "../../_lib/content";
import { error, json, nowIso } from "../../_lib/http";
import type { RuntimeEnv } from "../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

/**
 * Public, unauthenticated endpoint the desktop app polls for the announcements to show in its
 * Home banner — same access model as /api/license/*. Returns only rows that are active and within
 * their optional [starts_at, expires_at] display window right now. Critical announcements sort
 * first, then most recent.
 */
export async function onRequestGet(context: HandlerContext): Promise<Response> {
  const db = context.env.DB;
  if (!db) return error(500, "Database not available");

  try {
    await ensureAnnouncementsSchema(context.env);

    const now = nowIso();
    const { results } = await db
      .prepare(
        `SELECT id, title, body, level, starts_at, expires_at, created_at
         FROM announcements
         WHERE is_active = 1
           AND (starts_at IS NULL OR starts_at <= ?)
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY
           CASE level WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
           created_at DESC`
      )
      .bind(now, now)
      .all<Pick<AnnouncementRow, "id" | "title" | "body" | "level" | "starts_at" | "expires_at" | "created_at">>();

    return json({ ok: true, announcements: results });
  } catch (err) {
    return error(500, "Failed to load announcements.", err instanceof Error ? err.message : null);
  }
}
