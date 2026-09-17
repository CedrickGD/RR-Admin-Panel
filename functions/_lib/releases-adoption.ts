/**
 * "How many installs are on this version" — the one number the Releases KPI row shows and the one
 * a `make-current` confirm has to print before an operator moves customers backwards (§6).
 *
 * It is a single query over `app_sessions`, and it counts **installs, not sessions**: an install's
 * newest session in the window decides which version it is on, the same `ROW_NUMBER() OVER
 * (PARTITION BY identity ORDER BY last_seen_at DESC)` shape `functions/_lib/stats.ts` already uses
 * for its version distribution. Both spellings of an identity (`hwid`, else `install_id`) collapse
 * to one row, exactly as everywhere else in the panel.
 *
 * Versions are compared as the 3-part number, because a session may report `1.5.3` or `1.5.3.0`
 * depending on how old the client is, and both are the same release.
 */
import type { D1Database } from "./types";
import { versionForTag, type AdoptionSnapshot } from "../../shared/releases-contract";

/** The window an install has to have been seen in to count. Long enough to survive a quiet week. */
export const ADOPTION_WINDOW_DAYS = 30;

const IDENTITY_SQL = "COALESCE(hwid, install_id)";
const VERSION_SQL = "COALESCE(display_version, 'unknown')";

export interface AdoptionOptions {
  windowDays?: number;
  /** Epoch ms the window is measured back from. */
  nowMs?: number;
}

interface VersionCountRow {
  version: string;
  installs: number | string | null;
}

function count(value: number | string | null): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Installs on `version` against installs on anything, in the window. `version` may be a tag, a
 * 3-part or a 4-part number; it is normalised the same way the rows are.
 */
export async function adoptionForVersion(
  db: D1Database,
  version: string,
  options: AdoptionOptions = {},
): Promise<AdoptionSnapshot> {
  const windowDays = Math.max(1, options.windowDays ?? ADOPTION_WINDOW_DAYS);
  const nowMs = options.nowMs ?? Date.now();
  const cutoff = new Date(nowMs - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const wanted = versionForTag(version);

  const { results } = await db
    .prepare(
      `WITH ranked AS (
           SELECT ${IDENTITY_SQL} AS identity, ${VERSION_SQL} AS version,
             ROW_NUMBER() OVER (PARTITION BY ${IDENTITY_SQL} ORDER BY last_seen_at DESC) AS rn
           FROM app_sessions
           WHERE last_seen_at >= ?
         )
         SELECT version, COUNT(*) AS installs FROM ranked WHERE rn = 1 GROUP BY version`,
    )
    .bind(cutoff)
    .all<VersionCountRow>();

  let installs = 0;
  let totalInstalls = 0;
  for (const row of results) {
    const rowCount = count(row.installs);
    totalInstalls += rowCount;
    if (versionForTag(row.version ?? "") === wanted) installs += rowCount;
  }

  return {
    version: wanted,
    installs,
    totalInstalls,
    share: totalInstalls > 0 ? installs / totalInstalls : 0,
    windowDays,
  };
}
