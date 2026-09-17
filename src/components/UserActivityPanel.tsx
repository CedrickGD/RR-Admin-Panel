import { Select } from "./ds/Select";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { UserActivityDay, UserActivityPayload } from "../types/telemetry";
import {
  activityAxisTicks,
  activityGridStep,
  activitySegmentLabelFits,
  activitySegmentPlacement,
  buildActivityTimelineRows,
  formatActivityDate,
  type ActivityTimelineSegment,
} from "../utils/activityTimeline";
import { fetchUserActivity } from "../utils/api";
import { formatDuration, formatNumber } from "../utils/format";
import { paginate } from "../utils/pagination";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { TablePagination } from "./ds/TablePagination";

type ActivityRange = "today" | "7d" | "30d" | "all";

const RANGE_OPTIONS: Array<{ key: ActivityRange; label: string }> = [
  { key: "today", label: "Day" },
  { key: "7d", label: "Week" },
  { key: "30d", label: "Month" },
  { key: "all", label: "Lifetime" },
];
const TIMELINE_PAGE_SIZE = 30;
/* Below this content width the date column drops to "Thu 17" so the 24-hour
   track keeps the room; a 390px phone lands at ~250px, a tablet well above. */
const COMPACT_TIMELINE_PX = 520;
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

/** "20:00:00", or "20:00" where the selection box is too narrow for seconds. */
function selectionClock(value: string, timezone: string, compact: boolean): string {
  const clock = formatClock(value, timezone);
  return compact ? clock.slice(0, 5) : clock;
}

function segmentLabel(segment: SelectedSegment, timezone: string): string {
  const prefix = segment.approximateEnd ? "≈ " : "";
  return `${formatActivityDate(segment.date)} · ${formatClock(segment.startedAt, timezone)}–${prefix}${formatClock(segment.endedAt, timezone)} · ${formatDuration(segment.durationSeconds)} · ${timezone}`;
}

interface MeasuredWidths {
  /** Content width of the timeline box, or null until it has been laid out. */
  timeline: number | null;
  /** Width of the hour track (the axis shares its grid column), or null. */
  track: number | null;
}

/**
 * The timeline used to be drawn at a fixed 760px and scrolled on anything
 * narrower, which on a phone showed 00:00–02:00 of every day. It scales to
 * its container now, and the container is measured rather than assumed: a
 * ResizeObserver on the box and on the axis feeds the tick set, the date
 * format and the bar labels, and follows every later resize (drawer, rotate).
 * Sizes are read in a layout effect so the first paint already has them.
 */
function useMeasuredWidths(enabled: boolean) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const axisRef = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState<MeasuredWidths>({ timeline: null, track: null });
  useLayoutEffect(() => {
    const timeline = timelineRef.current;
    const axis = axisRef.current;
    if (!enabled || !timeline || !axis || typeof ResizeObserver === "undefined") return;
    // jsdom and a display:none ancestor both report 0 — that is "unmeasured", not "narrow".
    const px = (width: number) => (width > 0 ? Math.round(width) : null);
    const apply = (next: MeasuredWidths) =>
      setWidths((prev) =>
        prev.timeline === next.timeline && prev.track === next.track ? prev : next,
      );
    const current = { current: { timeline: null, track: null } as MeasuredWidths };
    const observer = new ResizeObserver((entries) => {
      const next = { ...current.current };
      for (const entry of entries) {
        if (entry.target === timeline) next.timeline = px(entry.contentRect.width);
        else if (entry.target === axis) next.track = px(entry.contentRect.width);
      }
      current.current = next;
      apply(next);
    });
    observer.observe(timeline);
    observer.observe(axis);
    // Content box, like the observer's contentRect: the box's 8px paddings are not track.
    const style = getComputedStyle(timeline);
    current.current = {
      timeline: px(
        timeline.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      ),
      track: px(axis.getBoundingClientRect().width),
    };
    apply(current.current);
    return () => observer.disconnect();
  }, [enabled]);
  return { timelineRef, axisRef, widths };
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
  // A screen with no hover (a phone, a tablet) gets told to tap, not to hover.
  const touch = useMediaQuery("(hover: none)");

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

  const showTimeline = Boolean(
    !loading && !error && activity && !activity.legacyOnly && activity.totalSeconds > 0,
  );
  const { timelineRef, axisRef, widths } = useMeasuredWidths(showTimeline);
  const compact = widths.timeline !== null && widths.timeline < COMPACT_TIMELINE_PX;
  const ticks = useMemo(() => activityAxisTicks(widths.track), [widths.track]);
  const timelineStyle = { "--activity-grid-step": activityGridStep(ticks) } as CSSProperties;

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
            ? formatActivityDate(localDateKey(activity.firstSeen, activity.timezone))
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
          Legacy client — this customer only reports install-scoped heartbeats, so no per-session
          history exists.
        </p>
      ) : activity && activity.totalSeconds === 0 ? (
        <p className="user-activity-note">No recorded app-online activity in this range.</p>
      ) : activity ? (
        <>
          <dl className="user-activity-stats">
            {stats.map((entry) => (
              <div key={entry.label} className="user-activity-stat">
                <dt className="user-activity-stat-label">{entry.label}</dt>
                <dd className="user-activity-stat-value">{entry.value}</dd>
              </div>
            ))}
          </dl>

          <div className="user-activity-selection" role="status" aria-live="polite">
            {selectedSegment ? (
              <>
                {/* The compact box has ~250px: the date goes short like the row
                    dates (the full one on the title) and the clocks drop their
                    seconds, so "Wed 16 · 20:00–≈ 20:55 · 55m 0s" stays one line
                    instead of pushing the timeline down by a line on every tap. */}
                <strong title={compact ? formatActivityDate(selectedSegment.date) : undefined}>
                  {formatActivityDate(selectedSegment.date, compact)}
                </strong>
                <span>
                  {selectionClock(selectedSegment.startedAt, activity.timezone, compact)}–
                  {selectedSegment.approximateEnd ? "≈ " : ""}
                  {selectionClock(selectedSegment.endedAt, activity.timezone, compact)} ·{" "}
                  {formatDuration(selectedSegment.durationSeconds)}
                </span>
              </>
            ) : (
              <span>
                {touch
                  ? "Tap a segment for its exact start and end time."
                  : "Hover or select a segment for its exact start and end time."}
              </span>
            )}
          </div>

          <div className="user-activity-timeline-scroll">
            <div
              ref={timelineRef}
              className={`user-activity-timeline${compact ? " is-compact" : ""}`}
              style={timelineStyle}
            >
              <div className="user-activity-timeline-axis-row" aria-hidden="true">
                <span>Date</span>
                <div ref={axisRef} className="user-activity-timeline-axis">
                  {ticks.map((tick) => (
                    <span key={tick.hour} style={{ left: `${(tick.hour / 24) * 100}%` }}>
                      {tick.label}
                    </span>
                  ))}
                </div>
                <span>Online</span>
              </div>

              {visibleRows.map((row) => (
                <div key={row.date} className="user-activity-timeline-row">
                  <span
                    className="user-activity-timeline-date"
                    title={compact ? formatActivityDate(row.date) : undefined}
                  >
                    {formatActivityDate(row.date, compact)}
                  </span>
                  <div
                    className="user-activity-timeline-track"
                    aria-label={`${formatActivityDate(row.date)} app-online intervals`}
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
                            style={activitySegmentPlacement(segment)}
                            title={label}
                            aria-label={label}
                            onMouseEnter={() => setSelectedSegment(selected)}
                            onFocus={() => setSelectedSegment(selected)}
                            onClick={() => setSelectedSegment(selected)}
                          >
                            {activitySegmentLabelFits(segment.widthPercent, widths.track)
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
              This customer exceeds the 20,000-session safety window. The newest intervals are
              shown; older exact intervals are not included.
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
