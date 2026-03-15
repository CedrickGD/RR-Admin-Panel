import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ThemeMode } from "../../types/telemetry";
import type { TimezoneActivityPoint } from "../../utils/dashboardInsights";
import { formatNumber } from "../../utils/format";
import { TelemetryChartTooltip } from "./TelemetryChartTooltip";

interface TimezoneUsageChartProps {
  title: string;
  subtitle: string;
  data: TimezoneActivityPoint[];
  accentColor: string;
  theme: ThemeMode;
}

function withAlpha(hex: string, alpha: number): string {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);

  if (!match) {
    return hex;
  }

  const [, r, g, b] = match;
  return `rgba(${Number.parseInt(r, 16)}, ${Number.parseInt(g, 16)}, ${Number.parseInt(b, 16)}, ${alpha})`;
}

export function TimezoneUsageChart({
  title,
  subtitle,
  data,
  accentColor,
  theme,
}: TimezoneUsageChartProps) {
  const totalActivity = data.reduce((sum, point) => sum + point.activity, 0);
  const totalErrors = data.reduce((sum, point) => sum + point.errors, 0);
  const peakHour = data.reduce(
    (peak, point) => (point.activity > peak.activity ? point : peak),
    data[0] ?? { activity: 0, label: "--:--" },
  );
  const palette =
    theme === "dark"
      ? {
          grid: "rgba(255,255,255,0.08)",
          axis: "rgba(255,255,255,0.58)",
          axisSoft: "rgba(255,255,255,0.38)",
          error: "rgba(251,113,133,0.94)",
        }
      : {
          grid: "rgba(19,37,57,0.1)",
          axis: "rgba(19,37,57,0.7)",
          axisSoft: "rgba(19,37,57,0.42)",
          error: "rgba(225,29,72,0.9)",
        };

  return (
    <article className="timezone-card">
      <div className="timezone-card-top">
        <div>
          <p className="timezone-card-title">{title}</p>
          <p className="timezone-card-subtitle">{subtitle}</p>
        </div>

        <div className="timezone-card-metrics">
          <div>
            <span>Events</span>
            <strong>{formatNumber(totalActivity)}</strong>
          </div>
          <div>
            <span>Peak</span>
            <strong>{peakHour.label}</strong>
          </div>
          <div>
            <span>Errors</span>
            <strong>{formatNumber(totalErrors)}</strong>
          </div>
        </div>
      </div>

      <div className="timezone-card-shell">
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={data} margin={{ top: 12, right: 10, left: -24, bottom: 0 }}>
            <CartesianGrid stroke={palette.grid} vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              interval={3}
              tick={{ fill: palette.axis, fontSize: 11 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={32}
              tick={{ fill: palette.axisSoft, fontSize: 11 }}
            />
            <Tooltip
              cursor={false}
              content={({ active, payload, label }) => (
                <TelemetryChartTooltip
                  active={active}
                  label={label ? `Hour ${label}` : undefined}
                  payload={
                    payload?.map((entry) => ({
                      name: String(entry.name ?? "Value"),
                      value: typeof entry.value === "number" ? entry.value : Number(entry.value ?? 0),
                      color: entry.color,
                    })) ?? []
                  }
                />
              )}
            />
            <Area
              type="monotone"
              dataKey="activity"
              name="Events"
              stroke={accentColor}
              strokeWidth={2.2}
              fill={withAlpha(accentColor, 0.18)}
              activeDot={{ r: 4, fill: accentColor, strokeWidth: 0 }}
            />
            <Line
              type="monotone"
              dataKey="errors"
              name="Errors"
              stroke={palette.error}
              strokeWidth={1.8}
              dot={false}
              activeDot={{ r: 3.5, fill: palette.error, strokeWidth: 0 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}
