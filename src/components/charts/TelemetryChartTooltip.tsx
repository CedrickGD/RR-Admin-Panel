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
  /** Render a summed total row beneath entries (only shown when 2+ numeric entries). */
  showTotal?: boolean;
  /** Label for the total row. Defaults to "Total". */
  totalLabel?: string;
  /** Custom value formatter applied to every entry (and the total). */
  valueFormatter?: (value: number | string) => string;
}

function defaultFormatValue(value: number | string | undefined): string {
  if (typeof value === "number") {
    return formatNumber(value);
  }

  return value == null ? "0" : String(value);
}

/** Per-series glow dot — color comes from the recharts payload (chart tokens). */
function GlowDot({ color }: { color?: string }) {
  const resolved = color ?? "var(--text-3)";
  return (
    <span
      aria-hidden
      className="chart-tip-dot"
      style={{
        background: resolved,
        boxShadow: `0 0 5px color-mix(in srgb, ${resolved} 50%, transparent)`,
      }}
    />
  );
}

/**
 * DS chart tooltip card (.chart-tip): dark frosted floating surface, uppercase
 * mono micro time label, Space Grotesk values, per-series glow dots.
 * Styling lives in the design system stylesheet — this stays markup-only.
 */
export function TelemetryChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  showTotal = false,
  totalLabel = "Total",
  valueFormatter,
}: TelemetryChartTooltipProps) {
  const rows = payload?.filter((entry) => entry.value !== undefined) ?? [];

  if (!active || rows.length === 0) {
    return null;
  }

  const formatValue = valueFormatter ?? defaultFormatValue;
  const numericValues = rows
    .map((entry) => entry.value)
    .filter((value): value is number => typeof value === "number");
  const shouldShowTotal = showTotal && numericValues.length >= 2;
  const total = numericValues.reduce((sum, value) => sum + value, 0);

  return (
    <div className="chart-tip">
      {label ? <p className="chart-tip-label">{labelFormatter ? labelFormatter(label) : label}</p> : null}

      {rows.map((entry, index) => (
        <div className="chart-tip-row" key={`${entry.name ?? "row"}-${index}`}>
          <span className="chart-tip-name">
            <GlowDot color={entry.color} />
            {entry.name ?? "Value"}
          </span>
          <span className="chart-tip-val">{formatValue(entry.value ?? 0)}</span>
        </div>
      ))}

      {shouldShowTotal ? (
        <div className="chart-tip-row chart-tip-total">
          <span className="chart-tip-name">{totalLabel}</span>
          <span className="chart-tip-val">{formatValue(total)}</span>
        </div>
      ) : null}
    </div>
  );
}
