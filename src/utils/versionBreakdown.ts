import type { VersionCurrentPoint } from "../types/telemetry";

export interface RankedVersionPoint extends VersionCurrentPoint {
  /** 0–1, of the sum of the rows returned here — not of the lifetime user total. */
  share: number;
}

/**
 * Top `limit` versions by user count, with `share` computed against the sum
 * of the rows actually returned. The Overview "Active customers" drill-down
 * only shows the top few versions, so sharing against the full lifetime
 * total would leave the bars short of 100% (and misleadingly so once a
 * "Legacy" bucket absorbs everything before 1.4).
 */
export function topVersionsByUsers(
  versions: VersionCurrentPoint[],
  limit = 5,
): RankedVersionPoint[] {
  const shown = [...versions].sort((a, b) => b.users - a.users).slice(0, limit);
  const shownTotal = Math.max(
    1,
    shown.reduce((acc, v) => acc + v.users, 0),
  );
  return shown.map((v) => ({ ...v, share: v.users / shownTotal }));
}
