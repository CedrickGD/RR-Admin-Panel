import { ensureAnnouncementsSchema, type AnnouncementRow } from "../../_lib/content";
import { error, json, nowIso } from "../../_lib/http";
import { internalError } from "../../_lib/responses";
import { enforceRateLimit } from "../../_lib/ratelimit";
import type { RuntimeEnv } from "../../_lib/types";
import { versionInRange } from "../../../shared/releases-contract";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

/** The public row: what a banner needs. The targeting bounds are the panel's business, not a client's. */
type PublicAnnouncement = Pick<
  AnnouncementRow,
  "id" | "title" | "body" | "level" | "starts_at" | "expires_at" | "created_at"
>;
type TargetedRow = PublicAnnouncement & Pick<AnnouncementRow, "min_version" | "max_version">;

/**
 * Public, unauthenticated endpoint the desktop app polls for the announcements to show in its
 * Home banner — same access model as /api/license/*. Returns only rows that are active and within
 * their optional [starts_at, expires_at] display window right now. Critical announcements sort
 * first, then most recent.
 *
 * `?v=1.5.3` additionally applies the version range (design §10): `AnnouncementService` appends the
 * running `AppVersionInfo.VersionString`, the same 3-part number an operator types into a bound.
 * `versionInRange` also orders the 4-part shape (`update.xml` carries "1.5.3.0"), so a client that
 * sends one is not mis-sorted. **No `v` means everything matches**, which is what every build up to
 * 1.5.3 sends, so nothing regresses for the installs that predate the parameter; the filter is the
 * mechanism for reaching them, not a gate that hides announcements from them.
 *
 * The range is applied here rather than in SQL because SQLite compares "1.10.0" < "1.9.0" as text,
 * and the row count this walks is the handful of live announcements.
 */
export async function onRequestGet(context: HandlerContext): Promise<Response> {
  const limited = enforceRateLimit(context.request, {
    route: "announcements/active",
    limit: 60,
    windowSeconds: 60,
  });
  if (limited) return limited;

  const db = context.env.DB;
  if (!db) return error(500, "Database not available");

  try {
    await ensureAnnouncementsSchema(context.env);

    const now = nowIso();
    const { results } = await db
      .prepare(
        `SELECT id, title, body, level, starts_at, expires_at, min_version, max_version, created_at
         FROM announcements
         WHERE is_active = 1
           AND (starts_at IS NULL OR starts_at <= ?)
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY
           CASE level WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
           created_at DESC`,
      )
      .bind(now, now)
      .all<TargetedRow>();

    const version = new URL(context.request.url).searchParams.get("v")?.trim() || null;
    const announcements: PublicAnnouncement[] = [];
    for (const row of results) {
      const range = { minVersion: row.min_version ?? null, maxVersion: row.max_version ?? null };
      if (!versionInRange(version, range)) continue;
      const { min_version: _min, max_version: _max, ...visible } = row;
      announcements.push(visible);
    }

    return json({ ok: true, announcements });
  } catch (err) {
    return internalError(context.request, "Unable to complete the request.", err);
  }
}
