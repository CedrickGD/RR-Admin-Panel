import { formatNumber } from "../../utils/format";

interface TooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
}

interface TelemetryChartTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  labelFormatter?: (label?: string) => string;
}

function formatTooltipValue(value: number | string | undefined): string {
  if (typeof value === "number") {
    return formatNumber(value);
  }

  return value == null ? "0" : String(value);
}

export function TelemetryChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
}: TelemetryChartTooltipProps) {
  const rows = payload?.filter((entry) => entry.value !== undefined) ?? [];

  if (!active || rows.length === 0) {
    return null;
  }

  return (
    <div className="chart-tooltip">
      {label ? (
        <p className="chart-tooltip-label">
          {labelFormatter ? labelFormatter(label) : label}
        </p>
      ) : null}

      <div className="chart-tooltip-grid">
        {rows.map((entry, index) => (
          <div
            key={`${entry.name ?? "row"}-${index}`}
            className="chart-tooltip-row"
          >
            <span className="chart-tooltip-key">
              <span
                className="chart-tooltip-dot"
                style={{ backgroundColor: entry.color ?? "rgba(255,255,255,0.72)" }}
              />
              {entry.name ?? "Value"}
            </span>
            <strong>{formatTooltipValue(entry.value)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
