import { Select } from "./ds/Select";
import { useEffect, useMemo, useRef, useState } from "react";
import type { UserActivityDay, UserActivityPayload } from "../types/telemetry";
import { buildActivityTimelineRows, type ActivityTimelineSegment } from "../utils/activityTimeline";
import { fetchUserActivity } from "../utils/api";
import { formatDuration, formatNumber } from "../utils/format";
import { paginate } from "../utils/pagination";
import { TablePagination } from "./ds/TablePagination";

type ActivityRange = "today" | "7d" | "30d" | "all";

const RANGE_OPTIONS: Array<{ key: ActivityRange; label: string }> = [
  { key: "today", label: "Day" },
  { key: "7d", label: "Week" },
  { key: "30d", label: "Month" },
  { key: "all", label: "Lifetime" },
];
const TIMELINE_PAGE_SIZE = 30;
const HOUR_TICKS = Array.from({ length: 13 }, (_, index) => index * 2);
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 16;
const activityCache = new Map<string, { payload: UserActivityPayload; cachedAt: number }>();

function readCachedActivity(key: string): UserActivityPayload | null {
  const cached = activityCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt >= CACHE_TTL_MS) {
    activityCache.delete(key);
    return null;
  }

  // Refresh the insertion order so frequently viewed users remain in the LRU cache.
  activityCache.delete(key);
  activityCache.set(key, cached);
  return cached.payload;
}

function cacheActivity(key: string, payload: UserActivityPayload): void {
  activityCache.delete(key);
  activityCache.set(key, { payload, cachedAt: Date.now() });
  while (activityCache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = activityCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    activityCache.delete(oldestKey);
  }
}

interface UserActivityPanelProps {
  identity: string;
}

interface SelectedSegment extends ActivityTimelineSegment {
  date: string;
}

function formatDateKey(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function localDateKey(value: string, timezone: string): string {
  const values: Record<string, string> = {};
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  for (const part of formatter.formatToParts(new Date(value))) {
    values[part.type] = part.value;
  }
  return `${values.year}-${values.month}-${values.day}`;
}

function formatClock(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function segmentLabel(segment: SelectedSegment, timezone: string): string {
  const prefix = segment.approximateEnd ? "≈ " : "";
  return `${formatDateKey(segment.date)} · ${formatClock(segment.startedAt, timezone)}–${prefix}${formatClock(segment.endedAt, timezone)} · ${formatDuration(segment.durationSeconds)} · ${timezone}`;
}

/** Exact, lightweight date-row timeline for one user's recorded app-online time. */
export function UserActivityPanel({ identity }: UserActivityPanelProps) {
  const [range, setRange] = useState<ActivityRange>("7d");
  const [activity, setActivity] = useState<UserActivityPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timelinePage, setTimelinePage] = useState(1);
  const [selectedSegment, setSelectedSegment] = useState<SelectedSegment | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    const cacheKey = `${identity}\u0000${range}`;
    const cached = readCachedActivity(cacheKey);
    if (cached) {
      setActivity(cached);
      setLoading(false);
      setError(null);
      return;
    }

    const seq = ++requestSeq.current;
    setActivity(null);
    setLoading(true);
    setError(null);
    void fetchUserActivity(identity, range)
      .then((result) => {
        if (requestSeq.current !== seq) return;
        if (result.ok && result.activity) {
          cacheActivity(cacheKey, result.activity);
          setActivity(result.activity);
        } else {
          setError(`Could not load activity (HTTP ${result.status}).`);
        }
      })
      .catch(() => {
        if (requestSeq.current === seq) setError("Could not load activity.");
      })
      .finally(() => {
        if (requestSeq.current === seq) setLoading(false);
      });

    return () => {
      if (requestSeq.current === seq) requestSeq.current += 1;
    };
  }, [identity, range]);

  const orderedDays = useMemo<UserActivityDay[]>(
    () => (activity ? [...activity.days].reverse() : []),
    [activity],
  );
  const dayPage = useMemo(
    () => paginate(orderedDays, timelinePage, TIMELINE_PAGE_SIZE),
    [orderedDays, timelinePage],
  );
  const visibleRows = useMemo(
    () =>
      activity
        ? buildActivityTimelineRows(dayPage.items, activity.intervals ?? [], activity.timezone)
        : [],
    [activity, dayPage.items],
  );

  useEffect(() => {
    if (dayPage.page !== timelinePage) setTimelinePage(dayPage.page);
  }, [dayPage.page, timelinePage]);

  function selectRange(nextRange: ActivityRange) {
    setRange(nextRange);
    setTimelinePage(1);
    setSelectedSegment(null);
  }

  function changeTimelinePage(page: number) {
    setTimelinePage(page);
    setSelectedSegment(null);
  }

  const stats: Array<{ label: string; value: string }> = activity
    ? [
        {
          label: "Recorded online",
          value: activity.totalSeconds > 0 ? formatDuration(activity.totalSeconds) : "0m",
        },
        { label: "Sessions", value: formatNumber(activity.sessionCount) },
        {
          label: "Avg session",
          value:
            activity.averageSessionSeconds > 0
              ? formatDuration(activity.averageSessionSeconds)
              : "—",
        },
        {
          label: "First seen",
          value: activity.firstSeen
            ? formatDateKey(localDateKey(activity.firstSeen, activity.timezone))
            : "—",
        },
        { label: "Timezone", value: activity.timezone },
      ]
    : [];

  return (
    <div className="user-activity">
      <div className="user-activity-head">
        <div>
          <p className="label-sm" style={{ marginBottom: 2 }}>
            App online timeline
          </p>
          <p className="user-activity-subtitle">
            Exact dates and local clock times from recorded sessions
          </p>
        </div>
        <Select
          aria-label="Time window"
          value={range}
          onValueChange={(value) => {
            const selected = RANGE_OPTIONS.find((option) => String(option.key) === value);
            if (selected) selectRange(selected.key);
          }}
        >
          {RANGE_OPTIONS.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>

      {loading ? (
        <div className="user-activity-loading">
          <div className="skeleton" style={{ height: 12, width: 220 }} />
          <div className="skeleton" style={{ height: 140 }} />
        </div>
      ) : error ? (
        <p className="user-activity-note">{error}</p>
      ) : activity?.legacyOnly ? (
        <p className="user-activity-note">
          Legacy client — this user only reports install-scoped heartbeats, so no per-session
          history exists.
        </p>
      ) : activity && activity.totalSeconds === 0 ? (
        <p className="user-activity-note">No recorded app-online activity in this range.</p>
      ) : activity ? (
        <>
          <div className="user-activity-stats">
            {stats.map((entry) => (
              <div key={entry.label} className="user-activity-stat">
                <span className="user-activity-stat-label">{entry.label}</span>
                <span className="user-activity-stat-value">{entry.value}</span>
              </div>
            ))}
          </div>

          <div className="user-activity-selection" role="status" aria-live="polite">
            {selectedSegment ? (
              <>
                <strong>{formatDateKey(selectedSegment.date)}</strong>
                <span>
                  {formatClock(selectedSegment.startedAt, activity.timezone)}–
                  {selectedSegment.approximateEnd ? "≈ " : ""}
                  {formatClock(selectedSegment.endedAt, activity.timezone)} ·{" "}
                  {formatDuration(selectedSegment.durationSeconds)}
                </span>
              </>
            ) : (
              <span>Hover, focus, or select a segment to read its exact start and end time.</span>
            )}
          </div>

          <div className="user-activity-timeline-scroll">
            <div className="user-activity-timeline">
              <div className="user-activity-timeline-axis-row" aria-hidden="true">
                <span>Date</span>
                <div className="user-activity-timeline-axis">
                  {HOUR_TICKS.map((hour) => (
                    <span key={hour} style={{ left: `${(hour / 24) * 100}%` }}>
                      {String(hour).padStart(2, "0")}:00
                    </span>
                  ))}
                </div>
                <span>Online</span>
              </div>

              {visibleRows.map((row) => (
                <div key={row.date} className="user-activity-timeline-row">
                  <span className="user-activity-timeline-date">{formatDateKey(row.date)}</span>
                  <div
                    className="user-activity-timeline-track"
                    aria-label={`${formatDateKey(row.date)} app-online intervals`}
                  >
                    {row.segments.length === 0 ? (
                      <span className="user-activity-timeline-offline">offline</span>
                    ) : (
                      row.segments.map((segment) => {
                        const selected = {
                          ...segment,
                          date: row.date,
                        } satisfies SelectedSegment;
                        const label = segmentLabel(selected, activity.timezone);
                        return (
                          <button
                            key={segment.id}
                            type="button"
                            className={`user-activity-timeline-segment${segment.approximateEnd ? " is-approximate" : ""}`}
                            style={{
                              left: `${segment.leftPercent}%`,
                              width: `${segment.widthPercent}%`,
                            }}
                            title={label}
                            aria-label={label}
                            onMouseEnter={() => setSelectedSegment(selected)}
                            onFocus={() => setSelectedSegment(selected)}
                            onClick={() => setSelectedSegment(selected)}
                          >
                            {segment.widthPercent >= 9
                              ? formatClock(segment.startedAt, activity.timezone).slice(0, 5)
                              : null}
                          </button>
                        );
                      })
                    )}
                  </div>
                  <span className="user-activity-timeline-total">
                    {row.seconds > 0 ? formatDuration(row.seconds) : "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="user-activity-legend">
            <span>
              <i className="user-activity-legend-swatch" /> confirmed end
            </span>
            <span>
              <i className="user-activity-legend-swatch is-approximate" /> ≈ last heartbeat; end
              time is approximate
            </span>
            <span>Local time · {activity.timezone}</span>
          </div>

          {!activity.intervalsComplete ? (
            <p className="user-activity-warning">
              This user exceeds the 20,000-session safety window. The newest intervals are shown;
              older exact intervals are not included.
            </p>
          ) : null}

          <TablePagination
            page={dayPage.page}
            pageCount={dayPage.pageCount}
            start={dayPage.start}
            end={dayPage.end}
            total={dayPage.total}
            itemLabel="days"
            onPageChange={changeTimelinePage}
          />
        </>
      ) : null}
    </div>
  );
}
