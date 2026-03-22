import type { AppSessionRecord, SummaryPayload } from "../types/telemetry";
import { formatCountryLabel, getMacroRegion, resolveCountry } from "./geography";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SESSION_START = "session_start";
const SESSION_END = "session_end";
const APP_ERROR = "app_error";

export interface TrafficTimelinePoint {
  label: string;
  shortLabel: string;
  started: number;
  ended: number;
  errors: number;
  activity: number;
  users: number;
}

export interface BreakdownPoint {
  label: string;
  value: number;
}

export interface GeoBreakdownPoint extends BreakdownPoint {
  code: string | null;
  region: string;
  share: number;
  active: number;
  errors: number;
  flag: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface HeatmapPoint extends GeoBreakdownPoint {
  intensity: number;
}

export interface HeatmapSessionPoint {
  key: string;
  marketKey: string;
  label: string;
  region: string;
  flag: string | null;
  latitude: number;
  longitude: number;
  anchorLatitude: number;
  anchorLongitude: number;
  marketValue: number;
  marketErrors: number;
  errors: number;
  intensity: number;
  locationLabel: string;
  userLabel: string | null;
  geoSource: string | null;
  geoSignalSource: string | null;
  accuracyMeters: number | null;
  precise: boolean;
}

export interface TimezoneActivityPoint {
  hour: number;
  label: string;
  activity: number;
  started: number;
  errors: number;
}

export interface DailyUserTimelinePoint {
  isoDate: string;
  label: string;
  shortLabel: string;
  users: number;
}

export interface VersionBreakdownPoint extends BreakdownPoint {
  source: string;
  version: string;
  share: number;
  activeUsers: number;
  sessionCount: number;
  totalErrors: number;
  lastSeenAt: string | null;
  isCurrent: boolean;
}

export const CURRENT_RAZORREAPER_VERSION = "1.4.1";

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function startOfHour(value: number): number {
  const date = new Date(value);
  date.setMinutes(0, 0, 0);
  return date.getTime();
}

function startOfUtcDay(value: number): number {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function buildUtcDayLabel(timestamp: number) {
  const date = new Date(timestamp);

  return {
    label: date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }),
    shortLabel: date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }),
  };
}

function getSessionIdentity(session: AppSessionRecord): string {
  const userLabel = session.userLabel?.trim().toLowerCase();

  if (userLabel) {
    return `user:${userLabel}`;
  }

  return `install:${session.installId.trim().toLowerCase()}`;
}

function getVersionLabel(session: AppSessionRecord): string {
  return session.appVersion?.trim() || "Unknown";
}

function getSessionSource(session: AppSessionRecord): string {
  return session.source?.trim() || "razorreaper";
}

function getUserSourceIdentity(session: AppSessionRecord): string {
  return `${getSessionIdentity(session)}::${getSessionSource(session).trim().toLowerCase()}`;
}

function isRazorReaperSource(source: string): boolean {
  return source.trim().toLowerCase().includes("razorreaper");
}

function parseTimestamp(value: string | null | undefined): number {
  const timestamp = Date.parse(value ?? "");

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getSessionRecency(session: AppSessionRecord): number {
  return Math.max(
    parseTimestamp(session.lastSeenAt),
    parseTimestamp(session.endedAt),
    parseTimestamp(session.startedAt),
  );
}

function getDashboardSessions(summary: SummaryPayload): AppSessionRecord[] {
  return summary.activeSessions.length > 0 ? summary.activeSessions : summary.recentSessions;
}

function getHistoricalSessions(summary: SummaryPayload): AppSessionRecord[] {
  const sessions = new Map<string, AppSessionRecord>();

  for (const session of summary.recentSessions) {
    sessions.set(session.id, session);
  }

  for (const session of summary.activeSessions) {
    sessions.set(session.id, session);
  }

  return Array.from(sessions.values());
}

function buildTimelineLabel(timestamp: number, timeZone?: string) {
  const date = new Date(timestamp);

  return {
    label: date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    }),
    shortLabel: date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    }),
  };
}

function sortBreakdown<T extends BreakdownPoint>(left: T, right: T): number {
  if (right.value !== left.value) {
    return right.value - left.value;
  }

  if (left.label === "Unknown") {
    return 1;
  }

  if (right.label === "Unknown") {
    return -1;
  }

  return left.label.localeCompare(right.label);
}

function addShares<T extends BreakdownPoint>(points: T[]): Array<T & { share: number }> {
  const total = points.reduce((sum, point) => sum + point.value, 0);

  return points.map((point) => ({
    ...point,
    share: total > 0 ? point.value / total : 0,
  }));
}

function buildCountryAggregationFromSessions(sessions: AppSessionRecord[]): GeoBreakdownPoint[] {
  const counts = new Map<string, GeoBreakdownPoint>();

  for (const session of sessions) {
    const country = resolveCountry(session.clientCountry);
    const label = country?.label ?? formatCountryLabel(session.clientCountry);
    const key = country?.code ?? `raw:${label.toLowerCase()}`;
    const current = counts.get(key) ?? {
      code: country?.code ?? null,
      label,
      value: 0,
      region: country ? getMacroRegion(country) : "Unknown",
      share: 0,
      active: 0,
      errors: 0,
      flag: country?.flag ?? null,
      latitude: country?.latitude ?? null,
      longitude: country?.longitude ?? null,
    };

    current.value += 1;
    current.active += session.isActive ? 1 : 0;
    current.errors += session.errorCount;
    counts.set(key, current);
  }

  return Array.from(counts.values()).sort(sortBreakdown);
}

function buildCountryAggregation(summary: SummaryPayload): GeoBreakdownPoint[] {
  return buildCountryAggregationFromSessions(getDashboardSessions(summary));
}

export function buildTrafficTimeline(
  summary: SummaryPayload,
  hours = 24,
  timeZone?: string,
): TrafficTimelinePoint[] {
  const end = startOfHour(Date.now());
  const start = end - (hours - 1) * HOUR_MS;

  const points = Array.from({ length: hours }, (_, index) => {
    const timestamp = start + index * HOUR_MS;
    const labels = buildTimelineLabel(timestamp, timeZone);

    return {
      label: labels.label,
      shortLabel: labels.shortLabel,
      started: 0,
      ended: 0,
      errors: 0,
      activity: 0,
      users: 0,
    };
  });

  // Count events per hour bucket
  for (const event of summary.recentEvents) {
    const timestamp = Date.parse(event.timestamp);
    if (!Number.isFinite(timestamp) || timestamp < start || timestamp > end + HOUR_MS) {
      continue;
    }

    const bucketIndex = Math.floor((timestamp - start) / HOUR_MS);
    const point = points[Math.min(points.length - 1, Math.max(0, bucketIndex))];
    point.activity += 1;

    if (event.service === SESSION_START) {
      point.started += 1;
    }

    if (event.service === SESSION_END) {
      point.ended += 1;
    }

    if (event.service === APP_ERROR) {
      point.errors += 1;
    }
  }

  // Count unique users active per hour bucket from sessions
  const userSets = points.map(() => new Set<string>());
  const allSessions = getHistoricalSessions(summary);

  for (const session of allSessions) {
    const sessionStart = parseTimestamp(session.startedAt);
    if (!Number.isFinite(sessionStart)) continue;

    const sessionEnd = parseTimestamp(session.endedAt ?? session.lastSeenAt ?? session.startedAt);
    const effectiveEnd = Number.isFinite(sessionEnd) && sessionEnd >= sessionStart ? sessionEnd : sessionStart;
    const identity = getSessionIdentity(session);

    // For each hour bucket, check if this session overlaps
    const firstBucket = Math.max(0, Math.floor((Math.min(sessionStart, effectiveEnd) - start) / HOUR_MS));
    const lastBucket = Math.min(points.length - 1, Math.floor((Math.max(sessionStart, effectiveEnd) - start) / HOUR_MS));

    for (let i = firstBucket; i <= lastBucket; i++) {
      if (i >= 0 && i < userSets.length) {
        userSets[i].add(identity);
      }
    }
  }

  for (let i = 0; i < points.length; i++) {
    points[i].users = userSets[i].size;
  }

  return points;
}

export function buildCountryBreakdown(
  summary: SummaryPayload,
  limit = 6,
  collapseOther = false,
): GeoBreakdownPoint[] {
  const countries = buildCountryAggregation(summary);

  if (collapseOther && countries.length > limit) {
    const visible = countries.slice(0, limit);
    const others = countries.slice(limit).reduce<GeoBreakdownPoint>(
      (accumulator, point) => {
        accumulator.value += point.value;
        accumulator.active += point.active;
        accumulator.errors += point.errors;
        return accumulator;
      },
      {
        code: null,
        label: "Other",
        value: 0,
        region: "Mixed",
        share: 0,
        active: 0,
        errors: 0,
        flag: null,
        latitude: null,
        longitude: null,
      },
    );

    return addShares(others.value > 0 ? [...visible, others] : visible);
  }

  return addShares(countries.slice(0, limit));
}

export function buildRegionBreakdown(summary: SummaryPayload): GeoBreakdownPoint[] {
  const counts = new Map<string, GeoBreakdownPoint>();

  for (const point of buildCountryAggregation(summary)) {
    const current = counts.get(point.region) ?? {
      code: null,
      label: point.region,
      value: 0,
      region: point.region,
      share: 0,
      active: 0,
      errors: 0,
      flag: null,
      latitude: null,
      longitude: null,
    };

    current.value += point.value;
    current.active += point.active;
    current.errors += point.errors;
    counts.set(point.region, current);
  }

  return addShares(Array.from(counts.values()).sort(sortBreakdown));
}

export function buildHeatmapPoints(summary: SummaryPayload): HeatmapPoint[] {
  const points = buildCountryAggregationFromSessions(summary.activeSessions).filter(
    (point) =>
      Number.isFinite(point.latitude ?? Number.NaN) &&
      Number.isFinite(point.longitude ?? Number.NaN),
  );
  const peak = Math.max(1, ...points.map((point) => point.value));

  return points.map((point) => ({
    ...point,
    intensity: point.value / peak,
  }));
}

function stableHash(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function clampLatitude(value: number): number {
  return Math.max(-85, Math.min(85, value));
}

function normalizeLongitude(value: number): number {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return normalized === -180 ? 180 : normalized;
}

function offsetCoordinates(
  latitude: number,
  longitude: number,
  distanceKm: number,
  bearing: number,
): { latitude: number; longitude: number } {
  const latitudeOffset = (distanceKm / 110.574) * Math.cos(bearing);
  const longitudeOffset =
    (distanceKm / (111.32 * Math.max(0.28, Math.cos((latitude * Math.PI) / 180)))) *
    Math.sin(bearing);

  return {
    latitude: clampLatitude(latitude + latitudeOffset),
    longitude: normalizeLongitude(longitude + longitudeOffset),
  };
}

function buildSessionSpreadPoint(
  latitude: number,
  longitude: number,
  seed: string,
  index: number,
  total: number,
): { latitude: number; longitude: number } {
  if (total <= 1) {
    return { latitude, longitude };
  }

  const maxSpreadKm = Math.min(88, 12 + Math.sqrt(total) * 8);
  const ring = Math.floor(index / 6);
  const radialBias = 8 + (ring * 9);
  const distanceKm = Math.min(maxSpreadKm, radialBias + (stableHash(`${seed}:radius`) % 9));
  const angle =
    ((stableHash(`${seed}:angle`) % 360) * Math.PI) / 180 +
    (index * GOLDEN_ANGLE);

  return offsetCoordinates(latitude, longitude, distanceKm, angle);
}

export function buildHeatmapSessionPoints(summary: SummaryPayload): HeatmapSessionPoint[] {
  const markets = buildHeatmapPoints(summary);
  const marketLookup = new Map<string, HeatmapPoint>();
  const groupedSessions = new Map<string, AppSessionRecord[]>();

  for (const market of markets) {
    marketLookup.set(market.code ?? market.label, market);
  }

  for (const session of summary.activeSessions) {
    const country = resolveCountry(session.clientCountry);
    const key = country?.code ?? null;

    if (!key) {
      continue;
    }

    const market = marketLookup.get(key);

    if (!market) {
      continue;
    }

    const sessions = groupedSessions.get(key) ?? [];
    sessions.push(session);
    groupedSessions.set(key, sessions);
  }

  const sessionPoints: HeatmapSessionPoint[] = [];

  for (const market of markets) {
    const marketKey = market.code ?? market.label;
    const sessions = [...(groupedSessions.get(marketKey) ?? [])].sort(
      (left, right) =>
        Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt) ||
        left.id.localeCompare(right.id),
    );

    for (let index = 0; index < sessions.length; index += 1) {
      const session = sessions[index];
      const exactLatitude = session.clientLatitude;
      const exactLongitude = session.clientLongitude;
      const hasExactCoordinates =
        Number.isFinite(exactLatitude ?? Number.NaN) &&
        Number.isFinite(exactLongitude ?? Number.NaN);
      const geoSource = session.clientGeoSource ?? null;
      const geoSignalSource = session.clientGeoSignalSource ?? null;
      const accuracyMeters = Number.isFinite(session.clientAccuracyMeters ?? Number.NaN)
        ? Number(session.clientAccuracyMeters)
        : null;
      const preciseCoordinates =
        hasExactCoordinates &&
        (
          (((geoSource?.startsWith("device")) ?? false) && geoSignalSource !== "ip") ||
          (accuracyMeters !== null && accuracyMeters <= 250)
        );
      const coordinates = hasExactCoordinates
        ? {
            latitude: clampLatitude(Number(exactLatitude)),
            longitude: normalizeLongitude(Number(exactLongitude)),
          }
        : buildSessionSpreadPoint(
            Number(market.latitude),
            Number(market.longitude),
            `${session.id}:${session.installId}:${session.clientIp ?? "na"}`,
            index,
            sessions.length,
          );
      const locationParts = [session.clientCity, session.clientRegion].filter(
        (value): value is string => Boolean(value?.trim()),
      );

      sessionPoints.push({
        key: session.id,
        marketKey,
        label: market.label,
        region: market.region,
        flag: market.flag,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        anchorLatitude: Number(market.latitude),
        anchorLongitude: Number(market.longitude),
        marketValue: market.value,
        marketErrors: market.errors,
        errors: session.errorCount,
        intensity: market.intensity,
        locationLabel: locationParts.length > 0 ? locationParts.join(", ") : market.label,
        userLabel: session.userLabel,
        geoSource,
        geoSignalSource,
        accuracyMeters,
        precise: preciseCoordinates,
      });
    }
  }

  return sessionPoints.sort(
    (left, right) =>
      right.marketValue - left.marketValue ||
      left.label.localeCompare(right.label) ||
      left.key.localeCompare(right.key),
  );
}

export function buildDurationBreakdown(sessions: AppSessionRecord[]): BreakdownPoint[] {
  const buckets = [
    { label: "< 5m", min: 0, max: 5 * 60 },
    { label: "5-15m", min: 5 * 60, max: 15 * 60 },
    { label: "15-30m", min: 15 * 60, max: 30 * 60 },
    { label: "30-60m", min: 30 * 60, max: 60 * 60 },
    { label: "60m+", min: 60 * 60, max: Number.POSITIVE_INFINITY },
  ];

  const values = buckets.map((bucket) => ({ label: bucket.label, value: 0 }));

  for (const session of sessions) {
    const duration = session.durationSeconds;

    if (duration === null || !Number.isFinite(duration)) {
      continue;
    }

    const target = buckets.findIndex(
      (bucket) => duration >= bucket.min && duration < bucket.max,
    );

    if (target >= 0) {
      values[target].value += 1;
    }
  }

  return values;
}

export function buildVersionBreakdown(summary: SummaryPayload, currentVersion = CURRENT_RAZORREAPER_VERSION): VersionBreakdownPoint[] {
  const source = getHistoricalSessions(summary);
  const latestUserSources = new Map<string, AppSessionRecord>();
  const counts = new Map<string, VersionBreakdownPoint>();

  for (const session of source) {
    const releaseSource = getSessionSource(session);
    const version = getVersionLabel(session);
    const key = `${releaseSource.trim().toLowerCase()}::${version.trim().toLowerCase()}`;
    const current = counts.get(key) ?? {
      label: version,
      source: releaseSource,
      version,
      value: 0,
      share: 0,
      activeUsers: 0,
      sessionCount: 0,
      totalErrors: 0,
      lastSeenAt: null,
      isCurrent: isRazorReaperSource(releaseSource) && version === currentVersion,
    };

    current.sessionCount += 1;
    current.totalErrors += session.errorCount;

    if (getSessionRecency(session) >= parseTimestamp(current.lastSeenAt)) {
      current.lastSeenAt = session.lastSeenAt;
    }

    counts.set(key, current);

    const identity = getUserSourceIdentity(session);
    const previous = latestUserSources.get(identity);

    if (!previous || getSessionRecency(session) >= getSessionRecency(previous)) {
      latestUserSources.set(identity, session);
    }
  }

  for (const session of latestUserSources.values()) {
    const releaseSource = getSessionSource(session);
    const version = getVersionLabel(session);
    const key = `${releaseSource.trim().toLowerCase()}::${version.trim().toLowerCase()}`;
    const current = counts.get(key) ?? {
      label: version,
      source: releaseSource,
      version,
      value: 0,
      share: 0,
      activeUsers: 0,
      sessionCount: 0,
      totalErrors: 0,
      lastSeenAt: null,
      isCurrent: isRazorReaperSource(releaseSource) && version === currentVersion,
    };

    current.value += 1;
    current.activeUsers += session.isActive ? 1 : 0;

    if (getSessionRecency(session) >= parseTimestamp(current.lastSeenAt)) {
      current.lastSeenAt = session.lastSeenAt;
    }

    counts.set(key, current);
  }

  const totalUsers = latestUserSources.size;
  const points = Array.from(counts.values()).filter((point) => point.value > 0);
  const sourceCount = new Set(points.map((point) => point.source.trim().toLowerCase())).size;

  return points
    .map((point) => ({
      ...point,
      label: sourceCount > 1 ? `${point.source} ${point.version}` : point.version,
      share: totalUsers > 0 ? point.value / totalUsers : 0,
    }))
    .sort(sortBreakdown);
}

export function buildTimezoneActivity(
  summary: SummaryPayload,
  timeZone: string,
): TimezoneActivityPoint[] {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  });
  const cutoff = Date.now() - 24 * HOUR_MS;
  const points = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}:00`,
    activity: 0,
    started: 0,
    errors: 0,
  }));

  for (const event of summary.recentEvents) {
    const timestamp = Date.parse(event.timestamp);

    if (!Number.isFinite(timestamp) || timestamp < cutoff) {
      continue;
    }

    const hour = Number.parseInt(formatter.format(timestamp), 10);

    if (!Number.isFinite(hour) || hour < 0 || hour >= points.length) {
      continue;
    }

    const point = points[hour];
    point.activity += 1;

    if (event.service === SESSION_START) {
      point.started += 1;
    }

    if (event.service === APP_ERROR) {
      point.errors += 1;
    }
  }

  return points;
}

export function buildDailyUserTimeline(
  summary: SummaryPayload,
  days = 30,
): DailyUserTimelinePoint[] {
  const dayCount = Math.max(1, days);
  const end = startOfUtcDay(Date.now());
  const start = end - ((dayCount - 1) * DAY_MS);
  const points = Array.from({ length: dayCount }, (_, index) => {
    const timestamp = start + (index * DAY_MS);
    const labels = buildUtcDayLabel(timestamp);

    return {
      isoDate: new Date(timestamp).toISOString().slice(0, 10),
      label: labels.label,
      shortLabel: labels.shortLabel,
      users: 0,
    };
  });
  const usersByDay = points.map(() => new Set<string>());

  for (const session of getHistoricalSessions(summary)) {
    const startedAt = Date.parse(session.startedAt);
    const endedAt = Date.parse(session.endedAt ?? session.lastSeenAt ?? session.startedAt);

    if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) {
      continue;
    }

    const rangeStart = startOfUtcDay(Math.min(startedAt, endedAt));
    const rangeEnd = startOfUtcDay(Math.max(startedAt, endedAt));

    if (rangeEnd < start || rangeStart > end) {
      continue;
    }

    const identity = getSessionIdentity(session);
    const clampedStart = Math.max(rangeStart, start);
    const clampedEnd = Math.min(rangeEnd, end);

    for (let day = clampedStart; day <= clampedEnd; day += DAY_MS) {
      const index = Math.round((day - start) / DAY_MS);

      if (index >= 0 && index < usersByDay.length) {
        usersByDay[index].add(identity);
      }
    }
  }

  return points.map((point, index) => ({
    ...point,
    users: usersByDay[index].size,
  }));
}
