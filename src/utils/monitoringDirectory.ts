import type { AppSessionRecord, UserRollupRecord } from "../types/telemetry";

export const LIVE_WINDOW_MS = 6 * 60 * 1000;
export function isSessionLive(session: AppSessionRecord, now: number) {
  const seen = Date.parse(session.lastSeenAt);
  return (
    session.isActive && !session.endedAt && Number.isFinite(seen) && now - seen <= LIVE_WINDOW_MS
  );
}
export function sessionIdentity(session: AppSessionRecord) {
  return (session.hwid?.trim() || session.installId).toLowerCase();
}
export function sessionSeconds(session: AppSessionRecord) {
  if (session.durationSeconds !== null && Number.isFinite(session.durationSeconds))
    return Math.max(0, session.durationSeconds);
  const span = Date.parse(session.endedAt ?? session.lastSeenAt) - Date.parse(session.startedAt);
  return Number.isFinite(span) ? Math.max(0, span / 1000) : 0;
}
export function latestSessions(sessions: readonly AppSessionRecord[]) {
  const rows = new Map<string, AppSessionRecord>();
  for (const session of sessions) {
    const key = sessionIdentity(session),
      previous = rows.get(key);
    if (!previous || Date.parse(session.lastSeenAt) > Date.parse(previous.lastSeenAt))
      rows.set(key, session);
  }
  return rows;
}

/** Keep the lifetime directory, enrich it with fresh sessions, and include newly seen devices. */
export function buildMonitoringDirectory(
  users: readonly UserRollupRecord[],
  sessions: readonly AppSessionRecord[],
  now: number,
): UserRollupRecord[] {
  const recent = latestSessions(sessions);
  const rows = new Map<string, UserRollupRecord>();
  for (const user of users) {
    const key = user.identity.trim().toLowerCase();
    const previous = rows.get(key);
    if (!previous || Date.parse(user.lastSeen) > Date.parse(previous.lastSeen)) rows.set(key, user);
  }
  for (const [key, session] of recent) {
    const user =
      rows.get(key) ?? [...rows.values()].find((u) => u.hwid?.trim().toLowerCase() === key);
    if (user) {
      const fresher = Date.parse(session.lastSeenAt) >= Date.parse(user.lastSeen);
      rows.set(user.identity.trim().toLowerCase(), {
        ...user,
        isActive: isSessionLive(session, now),
        ...(fresher
          ? {
              lastSeen: session.lastSeenAt,
              userLabel: session.userLabel || user.userLabel,
              displayVersion: session.displayVersion || session.appVersion || user.displayVersion,
              appVersion: session.appVersion || user.appVersion,
              discordUser: session.discordUser || user.discordUser,
              rpcEnabled: session.rpcEnabled ?? user.rpcEnabled,
              lastEvent: session.lastEvent,
            }
          : {}),
      });
    } else {
      rows.set(key, {
        identity: key,
        hwid: session.hwid ?? null,
        userLabel: session.userLabel,
        firstSeen: session.startedAt,
        lastSeen: session.lastSeenAt,
        sessions: sessions.filter((s) => sessionIdentity(s) === key && !s.id.startsWith("install:"))
          .length,
        totalDurationSeconds: sessions
          .filter((s) => sessionIdentity(s) === key)
          .reduce((sum, s) => sum + sessionSeconds(s), 0),
        errors: session.errorCount,
        isActive: isSessionLive(session, now),
        appVersion: session.appVersion,
        displayVersion: session.displayVersion ?? null,
        platform: session.platform,
        osVersion: session.osVersion ?? null,
        deviceModel: session.deviceModel ?? null,
        country: session.clientCountry,
        city: session.clientCity ?? null,
        timezone: session.clientTimezone ?? null,
        rpcEnabled: session.rpcEnabled ?? null,
        discordUser: session.discordUser ?? null,
        latitude: session.clientLatitude ?? null,
        longitude: session.clientLongitude ?? null,
        lastStatus: session.lastStatus,
        lastEvent: session.lastEvent,
        features: {},
        recentErrors: [],
      });
    }
  }
  return [...rows.values()].map((user) => ({
    ...user,
    isActive: user.isActive && now - Date.parse(user.lastSeen) <= LIVE_WINDOW_MS,
  }));
}

/** Newest numerical versions first; legacy/unknown releases follow real versions. */
export function compareVersionsNewestFirst(left: string, right: string) {
  const leftNumeric = /^v?\d/i.test(left),
    rightNumeric = /^v?\d/i.test(right);
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return right.localeCompare(left, undefined, { numeric: true, sensitivity: "base" });
}
