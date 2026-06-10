import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Sector, type SectorProps } from "recharts";
import { formatNumber } from "../../utils/format";

export interface DonutDatum {
  label: string;
  value: number;
  share: number;
  color: string;
  note?: string;
  flag?: string | null;
}

interface GeoDonutChartProps {
  data: DonutDatum[];
  totalLabel: string;
  metricLabel: string;
  emptyLabel?: string;
}

const SEGMENT_CORNER_RADIUS = 5;

export function GeoDonutChart({
  data,
  totalLabel,
  metricLabel,
  emptyLabel = "No geographic data is loaded yet.",
}: GeoDonutChartProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const resolvedIndex = activeIndex < data.length ? activeIndex : 0;
  const activeItem = data[resolvedIndex] ?? null;
  const total = data.reduce((sum, item) => sum + item.value, 0);

  if (data.length === 0) {
    return <div className="empty-panel small">{emptyLabel}</div>;
  }

  return (
    <div className="donut-panel">
      <div className="donut-chart-frame">
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            {/* Tooltip disabled — info shown in center label instead */}
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius="78%"
              outerRadius="86%"
              paddingAngle={2.5}
              cornerRadius={SEGMENT_CORNER_RADIUS}
              activeIndex={resolvedIndex}
              onMouseEnter={(_, index) => setActiveIndex(index)}
              activeShape={(props: SectorProps) => {
                const color = data[resolvedIndex]?.color;
                return (
                  <Sector
                    {...props}
                    innerRadius={Math.max(Number(props.innerRadius ?? 0) - 1.5, 0)}
                    outerRadius={Number(props.outerRadius ?? 0) + 3}
                    cornerRadius={SEGMENT_CORNER_RADIUS}
                    style={{
                      filter: color
                        ? `drop-shadow(0 0 5px color-mix(in srgb, ${color} 55%, transparent))`
                        : undefined,
                    }}
                  />
                );
              }}
              animationDuration={550}
              animationEasing="ease-out"
            >
              {data.map((entry, index) => (
                <Cell
                  key={`${entry.label}-${index}`}
                  fill={entry.color}
                  fillOpacity={index === resolvedIndex ? 1 : 0.78}
                  stroke="none"
                  style={{
                    cursor: "pointer",
                    transition: "fill-opacity 0.2s ease",
                    outline: "none",
                  }}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        <div className="donut-chart-center">
          <span className="donut-chart-overline">{totalLabel}</span>
          <strong style={{ fontVariantNumeric: "tabular-nums" }}>
            {formatNumber(activeItem?.value ?? total)}
          </strong>
          <p>{activeItem ? `${activeItem.flag ? `${activeItem.flag} ` : ""}${activeItem.label}` : totalLabel}</p>
          <small>
            {activeItem
              ? `${(activeItem.share * 100).toFixed(1)}% of ${metricLabel.toLowerCase()}`
              : `${formatNumber(total)} total`}
          </small>
        </div>
      </div>

      <div className="donut-legend" role="list" aria-label={totalLabel}>
        {data.map((entry, index) => (
          <button
            key={`${entry.label}-legend-${index}`}
            type="button"
            className={`donut-legend-item ${resolvedIndex === index ? "donut-legend-item-active" : ""}`}
            onMouseEnter={() => setActiveIndex(index)}
            onFocus={() => setActiveIndex(index)}
          >
            <span className="donut-legend-copy">
              <span className="donut-legend-label">
                <span
                  className="donut-legend-dot"
                  style={{
                    backgroundColor: entry.color,
                    boxShadow: `0 0 0 2px color-mix(in srgb, ${entry.color} 20%, transparent), 0 0 6px color-mix(in srgb, ${entry.color} 38%, transparent)`,
                  }}
                />
                {entry.flag ? `${entry.flag} ${entry.label}` : entry.label}
              </span>
              <span className="donut-legend-note">
                {entry.note ?? `${(entry.share * 100).toFixed(1)}% · ${metricLabel}`}
              </span>
            </span>
            <span className="donut-legend-value" style={{ fontVariantNumeric: "tabular-nums" }}>
              {formatNumber(entry.value)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
