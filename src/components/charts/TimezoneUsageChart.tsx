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
  chartHeight = 180,
}: TimezoneUsageChartProps) {
  const gradientId = useMemo(() => `tz-fill-${Math.random().toString(36).slice(2, 9)}`, []);
  const totalActivity = data.reduce((sum, point) => sum + point.activity, 0);
  const totalErrors = data.reduce((sum, point) => sum + point.errors, 0);
  const peakHour = data.reduce(
    (peak, point) => (point.activity > peak.activity ? point : peak),
    data[0] ?? { activity: 0, label: "--:--" },
  );

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
            <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 6" vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              interval={3}
              tickMargin={7}
              tick={{ fill: "var(--chart-axis)", fontSize: 10.5 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={34}
              allowDecimals={false}
              tickMargin={4}
              tick={{ fill: "var(--chart-axis-soft)", fontSize: 10.5 }}
              tickFormatter={(value: number) => formatNumber(value)}
            />
            <Tooltip
              cursor={{ stroke: "rgba(255,255,255,0.12)", strokeWidth: 1 }}
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
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="errors"
              name="Errors"
              stroke="var(--chart-errors)"
              strokeWidth={1.8}
              strokeDasharray="5 3"
              dot={false}
              activeDot={{ r: 3.5, fill: "var(--chart-errors)", strokeWidth: 0 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}
