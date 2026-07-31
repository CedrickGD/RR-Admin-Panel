import { Fragment, useEffect, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { UserActivityPayload } from "../types/telemetry";
import { fetchUserActivity } from "../utils/api";
import { formatDuration, formatNumber } from "../utils/format";

type ActivityRange = "today" | "7d" | "30d" | "all";

const RANGE_OPTIONS: Array<{ key: ActivityRange; label: string }> = [
  { key: "today", label: "Day" },
  { key: "7d", label: "Week" },
  { key: "30d", label: "Month" },
  { key: "all", label: "Lifetime" },
];

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface UserActivityPanelProps {
  identity: string;
}

function formatAxisSeconds(value: number): string {
  if (value <= 0) return "0";
  if (value >= 3600) return `${Math.round(value / 3600)}h`;
  return `${Math.max(1, Math.round(value / 60))}m`;
}

function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** Tooltip for duration series — recharts hands us raw seconds. */
function DurationTooltip({
  active,
  label,
  payload,
}: {
  active?: boolean;
  label?: string | number;
  payload?: Array<{ value?: number | string }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const seconds = Number(payload[0]?.value ?? 0);
  return (
    <div className="user-activity-tooltip">
      <span className="user-activity-tooltip-label">{String(label ?? "")}</span>
      <span className="user-activity-tooltip-value">{seconds > 0 ? formatDuration(seconds) : "offline"}</span>
    </div>
  );
}

/** Per-user behaviour analytics: online time series + weekly peak-hours punchcard. */
export function UserActivityPanel({ identity }: UserActivityPanelProps) {
  const [range, setRange] = useState<ActivityRange>("7d");
  const [activity, setActivity] = useState<UserActivityPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    void fetchUserActivity(identity, range)
      .then((result) => {
        if (requestSeq.current !== seq) return;
        if (result.ok && result.activity) {
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
  }, [identity, range]);

  const punchcardPeak = activity
    ? Math.max(1, ...activity.hourOfWeek.flatMap((row) => row))
    : 1;

  let mostActiveLabel = "—";
  if (activity && activity.totalSeconds > 0) {
    let bestWeekday = 0;
    let bestHour = 0;
    let bestSeconds = 0;
    activity.hourOfWeek.forEach((row, weekday) => {
      row.forEach((seconds, hour) => {
        if (seconds > bestSeconds) {
          bestSeconds = seconds;
          bestWeekday = weekday;
          bestHour = hour;
        }
      });
    });
    mostActiveLabel = `${WEEKDAY_LABELS[bestWeekday]} · ${formatHourLabel(bestHour)}`;
  }

  const hourlyData = activity
    ? activity.hourOfDay.map((seconds, hour) => ({ label: formatHourLabel(hour), seconds }))
    : [];
  const dailyData = activity
    ? activity.days.map((day) => ({ label: day.date, seconds: day.seconds }))
    : [];

  const stats: Array<{ label: string; value: string }> = activity
    ? [
        { label: "Online", value: activity.totalSeconds > 0 ? formatDuration(activity.totalSeconds) : "0m" },
        { label: "Sessions", value: formatNumber(activity.sessionCount) },
        {
          label: "Avg Session",
          value: activity.averageSessionSeconds > 0 ? formatDuration(activity.averageSessionSeconds) : "—",
        },
        { label: "Peak", value: mostActiveLabel },
        { label: "Timezone", value: activity.timezone },
      ]
    : [];

  return (
    <div className="user-activity">
      <div className="user-activity-head">
        <p className="label-sm" style={{ marginBottom: 0 }}>Activity</p>
        <div className="seg-control">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`seg-btn${range === option.key ? " active" : ""}`}
              onClick={() => setRange(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="user-activity-loading">
          <div className="skeleton" style={{ height: 12, width: 220 }} />
          <div className="skeleton" style={{ height: 96 }} />
        </div>
      ) : error ? (
        <p className="user-activity-note">{error}</p>
      ) : activity?.legacyOnly ? (
        <p className="user-activity-note">
          Legacy client — this user only reports install-scoped heartbeats, so no per-session history exists.
        </p>
      ) : activity && activity.totalSeconds === 0 ? (
        <p className="user-activity-note">No recorded activity in this range.</p>
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

          <div className="user-activity-chart">
            <ResponsiveContainer width="100%" height={140}>
              {range === "today" ? (
                <BarChart data={hourlyData} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "var(--chart-axis-soft)", fontSize: 10 }}
                    minTickGap={24}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "var(--chart-axis-soft)", fontSize: 10 }}
                    tickFormatter={formatAxisSeconds}
                  />
                  <Tooltip
                    isAnimationActive={false}
                    cursor={{ fill: "rgba(255,255,255,0.04)" }}
                    content={<DurationTooltip />}
                  />
                  <Bar
                    dataKey="seconds"
                    name="Online"
                    fill="var(--chart-users)"
                    radius={[3, 3, 0, 0]}
                    isAnimationActive={false}
                  />
                </BarChart>
              ) : (
                <AreaChart data={dailyData} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="userActivityFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-users)" stopOpacity={0.32} />
                      <stop offset="100%" stopColor="var(--chart-users)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "var(--chart-axis-soft)", fontSize: 10 }}
                    tickFormatter={(value: string) => value.slice(5)}
                    minTickGap={28}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "var(--chart-axis-soft)", fontSize: 10 }}
                    tickFormatter={formatAxisSeconds}
                  />
                  <Tooltip
                    isAnimationActive={false}
                    cursor={{ stroke: "var(--chart-axis-soft)", strokeDasharray: "3 3" }}
                    content={<DurationTooltip />}
                  />
                  <Area
                    type="monotone"
                    dataKey="seconds"
                    name="Online"
                    stroke="var(--chart-users)"
                    strokeWidth={2}
                    fill="url(#userActivityFill)"
                    dot={false}
                    activeDot={{ r: 3 }}
                    isAnimationActive={false}
                  />
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>

          <p className="label-sm" style={{ margin: "12px 0 6px" }}>
            Peak Times <span className="user-activity-tz">local time · {activity.timezone}</span>
          </p>
          <div className="user-activity-punchcard" role="img" aria-label="Online time by weekday and hour">
            <span />
            {Array.from({ length: 24 }, (_, hour) => (
              <span key={`h-${hour}`} className="user-activity-punchcard-hour">
                {hour % 6 === 0 ? String(hour).padStart(2, "0") : ""}
              </span>
            ))}
            {activity.hourOfWeek.map((row, weekday) => (
              <Fragment key={WEEKDAY_LABELS[weekday]}>
                <span className="user-activity-punchcard-day">{WEEKDAY_LABELS[weekday]}</span>
                {row.map((seconds, hour) => (
                  <span
                    key={`${weekday}-${hour}`}
                    className="user-activity-punchcard-cell"
                    title={`${WEEKDAY_LABELS[weekday]} ${formatHourLabel(hour)} — ${seconds > 0 ? formatDuration(seconds) : "offline"}`}
                    style={{
                      background:
                        seconds > 0
                          ? `hsl(var(--ah) var(--as) var(--al) / ${(0.1 + 0.75 * (seconds / punchcardPeak)).toFixed(3)})`
                          : "rgba(255,255,255,0.04)",
                    }}
                  />
                ))}
              </Fragment>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
