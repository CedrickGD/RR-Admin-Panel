import { useMemo } from "react";
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
  chartHeight?: number;
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
  chartHeight = 180,
}: TimezoneUsageChartProps) {
  const gradientId = useMemo(() => `tz-fill-${Math.random().toString(36).slice(2, 9)}`, []);
  const totalActivity = data.reduce((sum, point) => sum + point.activity, 0);
  const totalErrors = data.reduce((sum, point) => sum + point.errors, 0);
  const peakHour = data.reduce(
    (peak, point) => (point.activity > peak.activity ? point : peak),
    data[0] ?? { activity: 0, label: "--:--" },
  );
  const palette =
    theme === "dark"
      ? {
          grid: "rgba(255,255,255,0.07)",
          axis: "rgba(255,255,255,0.56)",
          axisSoft: "rgba(255,255,255,0.38)",
          cursor: "rgba(255,255,255,0.18)",
          error: "hsl(4 60% 64% / 0.88)",
        }
      : {
          grid: "rgba(24,43,66,0.1)",
          axis: "rgba(24,43,66,0.66)",
          axisSoft: "rgba(24,43,66,0.42)",
          cursor: "rgba(24,43,66,0.24)",
          error: "hsl(4 50% 52% / 0.8)",
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
        <ResponsiveContainer width="100%" height={chartHeight}>
          <AreaChart data={data} margin={{ top: 12, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accentColor} stopOpacity={0.34} />
                <stop offset="62%" stopColor={accentColor} stopOpacity={0.1} />
                <stop offset="100%" stopColor={accentColor} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={palette.grid} vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              interval={3}
              tickMargin={7}
              tick={{ fill: palette.axis, fontSize: 10.5 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={34}
              allowDecimals={false}
              tickMargin={4}
              tick={{ fill: palette.axisSoft, fontSize: 10.5 }}
              tickFormatter={(value: number) => formatNumber(value)}
            />
            <Tooltip
              cursor={{ stroke: palette.cursor, strokeWidth: 1, strokeDasharray: "3 3" }}
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
              fill={`url(#${gradientId})`}
              dot={false}
              activeDot={{
                r: 4,
                fill: accentColor,
                stroke: withAlpha(accentColor, 0.28),
                strokeWidth: 5,
              }}
              animationDuration={650}
              animationEasing="ease-out"
            />
            <Line
              type="monotone"
              dataKey="errors"
              name="Errors"
              stroke={palette.error}
              strokeWidth={1.8}
              strokeDasharray="5 3"
              dot={false}
              activeDot={{ r: 3.5, fill: palette.error, strokeWidth: 0 }}
              animationDuration={650}
              animationEasing="ease-out"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}
