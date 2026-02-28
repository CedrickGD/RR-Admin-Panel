import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { PieSlice } from "../types/telemetry";
import { CHART_COLORS } from "../utils/telemetry";

interface DonutChartProps {
  data: PieSlice[];
  title: string;
  subtitle?: string;
  centerLabel?: string;
  centerValue?: string | number;
  height?: number;
  innerRadius?: number;
  outerRadius?: number;
}

export function DonutChart({
  data,
  title,
  subtitle,
  centerLabel,
  centerValue,
  height = 220,
  innerRadius = 58,
  outerRadius = 82,
}: DonutChartProps) {
  return (
    <div className="card p-5">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle ? (
          <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
            {subtitle}
          </p>
        ) : null}
      </div>

      <div className="relative" style={{ height }}>
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={innerRadius}
                outerRadius={outerRadius}
                paddingAngle={3}
                dataKey="value"
                stroke="none"
              >
                {data.map((_, i) => (
                  <Cell
                    key={`cell-${i}`}
                    fill={CHART_COLORS[i % CHART_COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  borderRadius: "10px",
                  border: "1px solid hsl(var(--border))",
                  color: "hsl(var(--foreground))",
                  fontSize: "12px",
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-[hsl(var(--muted-foreground))]">
            No data available
          </div>
        )}

        {centerValue !== undefined ? (
          <div className="donut-center">
            <span className="text-2xl font-bold font-[JetBrains_Mono,monospace]">
              {centerValue}
            </span>
            {centerLabel ? (
              <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                {centerLabel}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Legend */}
      {data.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          {data.slice(0, 6).map((slice, i) => (
            <div
              key={slice.name}
              className="flex items-center justify-between text-xs"
            >
              <span className="flex items-center gap-2 text-[hsl(var(--muted-foreground))] min-w-0">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                />
                <span className="truncate">{slice.name}</span>
              </span>
              <span className="font-[JetBrains_Mono,monospace] font-medium ml-2">
                {slice.value}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
