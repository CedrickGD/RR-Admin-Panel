/**
 * Compact chart legend — swatch + series name, one inline row.
 *
 * No chart in the console carried a legend, so the Overview activity chart
 * plotted three series (active users, new sessions, errors) with nothing to
 * name them. Sized for a panel header next to the MetaRow rather than for
 * recharts' own <Legend>, which reserves plot height and centres itself.
 *
 * Colors come from the chart tokens (--chart-users / --chart-sessions /
 * --chart-errors) or from useChartColors, so the legend always matches the
 * plot; `dashed` marks a forecast/projected series (Traffic).
 */
export interface ChartLegendItem {
  /** Sentence case, matching the series `name` given to recharts. */
  label: string;
  /** Any CSS color — pass the same value the series is drawn with. */
  color: string;
  /** Dashed swatch for projected/forecast series. */
  dashed?: boolean;
}

export interface ChartLegendProps {
  items: ChartLegendItem[];
  className?: string;
}

export function ChartLegend({ items, className = "" }: ChartLegendProps) {
  if (items.length === 0) return null;
  return (
    <ul className={`chart-legend${className ? ` ${className}` : ""}`}>
      {items.map((item) => (
        <li className="chart-legend-item" key={item.label}>
          <span
            className={`chart-legend-swatch${item.dashed ? " chart-legend-swatch-dashed" : ""}`}
            style={
              item.dashed
                ? {
                    backgroundImage: `repeating-linear-gradient(90deg, ${item.color} 0 4px, transparent 4px 7px)`,
                  }
                : { background: item.color }
            }
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
