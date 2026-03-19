import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Sector, Tooltip, type SectorProps } from "recharts";
import { formatNumber } from "../../utils/format";
import { TelemetryChartTooltip } from "./TelemetryChartTooltip";

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

  // Generate unique filter IDs for glow effects
  const filterId = useMemo(() => `donut-glow-${Math.random().toString(36).slice(2, 8)}`, []);

  if (data.length === 0) {
    return <div className="empty-panel small">{emptyLabel}</div>;
  }

  return (
    <div className="donut-panel">
      <div className="donut-chart-frame">
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <defs>
              {data.map((entry, index) => (
                <filter key={`${filterId}-${index}`} id={`${filterId}-${index}`} x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur in="SourceGraphic" stdDeviation={index === resolvedIndex ? 4 : 2} result="blur" />
                  <feFlood floodColor={entry.color} floodOpacity={index === resolvedIndex ? 0.5 : 0.25} />
                  <feComposite in2="blur" operator="in" />
                  <feMerge>
                    <feMergeNode />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              ))}
            </defs>
            <Tooltip
              content={({ active, payload }) => {
                const entry = payload?.[0]?.payload as DonutDatum | undefined;

                if (!entry) {
                  return null;
                }

                return (
                  <TelemetryChartTooltip
                    active={active}
                    label={`${entry.flag ? `${entry.flag} ` : ""}${entry.label}`}
                    payload={[
                      { name: metricLabel, value: entry.value, color: entry.color },
                      {
                        name: "Share",
                        value: `${(entry.share * 100).toFixed(1)}%`,
                        color: entry.color,
                      },
                    ]}
                  />
                );
              }}
            />
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius="58%"
              outerRadius="84%"
              paddingAngle={3}
              activeIndex={resolvedIndex}
              onMouseEnter={(_, index) => setActiveIndex(index)}
              activeShape={(props: SectorProps) => (
                <Sector
                  {...props}
                  outerRadius={Number(props.outerRadius ?? 0) + 8}
                  style={{ filter: `drop-shadow(0 0 8px ${data[resolvedIndex]?.color ?? "#fff"})` }}
                />
              )}
              animationDuration={500}
              animationEasing="ease-out"
            >
              {data.map((entry, index) => (
                <Cell
                  key={`${entry.label}-${index}`}
                  fill={entry.color}
                  fillOpacity={index === resolvedIndex ? 1 : 0.82}
                  stroke={index === resolvedIndex ? entry.color : "rgba(255,255,255,0.12)"}
                  strokeWidth={index === resolvedIndex ? 2 : 1}
                  style={{
                    filter: index === resolvedIndex
                      ? `drop-shadow(0 0 6px ${entry.color})`
                      : `drop-shadow(0 0 3px ${entry.color}40)`,
                    transition: "filter 0.2s ease",
                  }}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        <div className="donut-chart-center">
          <span className="donut-chart-overline">{totalLabel}</span>
          <strong>{formatNumber(activeItem?.value ?? total)}</strong>
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
                    boxShadow: `0 0 6px ${entry.color}`,
                  }}
                />
                {entry.flag ? `${entry.flag} ${entry.label}` : entry.label}
              </span>
              <span className="donut-legend-note">{entry.note ?? metricLabel}</span>
            </span>
            <span className="donut-legend-value">{formatNumber(entry.value)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
